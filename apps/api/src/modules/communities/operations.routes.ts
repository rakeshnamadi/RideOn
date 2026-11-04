import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { auth, authenticate } from '../../middleware/auth.js';
import { communityId, requireCommunity } from '../../middleware/community-scope.js';
import { emitToCommunity } from '../../sockets/index.js';
import { conflict, notFound, unprocessable } from '../../utils/errors.js';
import { created, ok, pageMeta, pagination, parse, param } from '../../utils/http.js';
import { audit } from '../audit/audit.service.js';
import { findActiveRule } from '../fares/fare.service.js';
import { backfillRoutePaths, refreshRoutePath } from './route-path.js';
import { Lat, Lng } from '../geo/geo.routes.js';
import { notify } from '../notifications/notification.service.js';

/** Mounted at /communities/:communityId — every query below is scoped by that ID. */
export const communityOpsRoutes = Router({ mergeParams: true });
communityOpsRoutes.use(authenticate);

// ─────────── Membership applications ───────────

communityOpsRoutes.get('/memberships', requireCommunity('community.members.manage'), async (req, res) => {
  const q = parse(z.object({ status: z.enum(['APPLIED', 'APPROVED', 'REJECTED', 'SUSPENDED', 'LEFT']).optional() }), req.query);
  const items = await prisma.communityMembership.findMany({
    where: { communityId: communityId(req), ...(q.status ? { status: q.status } : {}) },
    include: {
      driver: {
        select: {
          id: true,
          licenseNumber: true,
          licenseExpiry: true,
          verificationStatus: true,
          status: true,
          ratingSum: true,
          ratingCount: true,
          user: { select: { name: true, phone: true } },
          documents: { select: { id: true, type: true, status: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  ok(res, items);
});

communityOpsRoutes.post('/memberships/:membershipId/decision', requireCommunity('community.members.manage'), async (req, res) => {
  const cid = communityId(req);
  const body = parse(z.object({ decision: z.enum(['APPROVE', 'REJECT', 'SUSPEND', 'REINSTATE']), note: z.string().trim().max(1000).optional() }), req.body);
  const m = await prisma.communityMembership.findFirst({ where: { id: param(req, 'membershipId'), communityId: cid }, include: { driver: true } });
  if (!m) throw notFound('Membership');
  const allowed: Record<string, string[]> = { APPROVE: ['APPLIED'], REJECT: ['APPLIED'], SUSPEND: ['APPROVED'], REINSTATE: ['SUSPENDED'] };
  if (!allowed[body.decision]!.includes(m.status)) throw conflict(`Cannot ${body.decision.toLowerCase()} a membership that is ${m.status}`);
  if (['SUSPEND', 'REJECT'].includes(body.decision) && !body.note) throw unprocessable('A reason is required', 'REASON_REQUIRED');
  const status = ({ APPROVE: 'APPROVED', REJECT: 'REJECTED', SUSPEND: 'SUSPENDED', REINSTATE: 'APPROVED' } as const)[body.decision];
  const updated = await prisma.communityMembership.update({
    where: { id: m.id },
    data: { status, decisionNote: body.note, decidedById: auth(req).userId, decidedAt: new Date() },
  });
  if (status === 'SUSPENDED') {
    await prisma.driverAvailability.updateMany({ where: { driverId: m.driverId, communityId: cid, status: 'ONLINE' }, data: { status: 'OFFLINE', standId: null, queuedAt: null } });
  }
  await audit({ action: `membership.${body.decision.toLowerCase()}`, entityType: 'CommunityMembership', entityId: m.id, communityId: cid, before: { status: m.status }, after: { status, note: body.note } }, { ctx: req.auth, req });
  await notify(m.driver.userId, {
    type: 'MEMBERSHIP_DECISION',
    title: `Community membership ${status.toLowerCase()}`,
    body: body.note ?? `Your membership status is now ${status.toLowerCase()}.`,
    link: '/driver/profile',
  });
  ok(res, updated);
});

// ─────────── Drivers & documents ───────────

communityOpsRoutes.get('/drivers', requireCommunity('community.drivers.manage'), async (req, res) => {
  const cid = communityId(req);
  const members = await prisma.communityMembership.findMany({
    where: { communityId: cid, status: { in: ['APPROVED', 'SUSPENDED'] } },
    select: {
      status: true,
      driver: {
        select: {
          id: true,
          licenseNumber: true,
          licenseExpiry: true,
          verificationStatus: true,
          status: true,
          ratingSum: true,
          ratingCount: true,
          user: { select: { name: true, phone: true } },
          availability: { select: { status: true, communityId: true } },
          vehicleAssignments: { where: { active: true, vehicle: { communityId: cid } }, select: { vehicle: { select: { id: true, registrationNumber: true, status: true, seatCapacity: true } } } },
        },
      },
    },
  });
  ok(res, members.map((m) => ({ membershipStatus: m.status, ...m.driver })));
});

communityOpsRoutes.post('/documents/:documentId/review', requireCommunity('community.drivers.manage'), async (req, res) => {
  const cid = communityId(req);
  const body = parse(z.object({ status: z.enum(['APPROVED', 'REJECTED']), note: z.string().trim().max(500).optional() }), req.body);
  // The document's driver must have applied to / belong to *this* community.
  const doc = await prisma.driverDocument.findFirst({
    where: { id: param(req, 'documentId'), driver: { memberships: { some: { communityId: cid } } } },
    include: { driver: { select: { userId: true } } },
  });
  if (!doc) throw notFound('Document');
  const updated = await prisma.driverDocument.update({
    where: { id: doc.id },
    data: { status: body.status, reviewNote: body.note, reviewedById: auth(req).userId, reviewedAt: new Date() },
    select: { id: true, type: true, status: true, reviewNote: true },
  });
  await audit({ action: 'driver.document_reviewed', entityType: 'DriverDocument', entityId: doc.id, communityId: cid, before: { status: doc.status }, after: body }, { ctx: req.auth, req });
  await notify(doc.driver.userId, { type: 'DOCUMENT_REVIEW', title: `Document ${body.status.toLowerCase()}`, body: `${doc.type.replace(/_/g, ' ')}: ${body.note ?? body.status.toLowerCase()}`, link: '/driver/profile' });
  ok(res, updated);
});

// ─────────── Vehicles ───────────

communityOpsRoutes.get('/vehicles', requireCommunity('community.vehicles.manage'), async (req, res) => {
  const q = parse(z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'INACTIVE']).optional() }), req.query);
  ok(
    res,
    await prisma.vehicle.findMany({
      where: { communityId: communityId(req), ...(q.status ? { status: q.status } : {}) },
      include: { assignments: { where: { active: true }, select: { driver: { select: { id: true, user: { select: { name: true } } } } } } },
      orderBy: { createdAt: 'desc' },
    }),
  );
});

communityOpsRoutes.post('/vehicles/:vehicleId/decision', requireCommunity('community.vehicles.manage'), async (req, res) => {
  const cid = communityId(req);
  const body = parse(
    z.object({
      decision: z.enum(['APPROVE', 'REJECT', 'DEACTIVATE']),
      // Auto-rickshaw permits in India typically allow 3 passengers; some shared permits allow more.
      seatCapacity: z.number().int().min(1).max(6).optional(),
      note: z.string().trim().max(500).optional(),
    }),
    req.body,
  );
  const v = await prisma.vehicle.findFirst({ where: { id: param(req, 'vehicleId'), communityId: cid }, include: { assignments: { where: { active: true }, include: { driver: true } } } });
  if (!v) throw notFound('Vehicle');
  if (body.decision === 'APPROVE' && !body.seatCapacity) throw unprocessable('Set the permitted seat capacity when approving', 'CAPACITY_REQUIRED');
  const status = ({ APPROVE: 'APPROVED', REJECT: 'REJECTED', DEACTIVATE: 'INACTIVE' } as const)[body.decision];
  const updated = await prisma.vehicle.update({
    where: { id: v.id },
    data: { status, reviewNote: body.note, approvedById: auth(req).userId, ...(body.seatCapacity ? { seatCapacity: body.seatCapacity } : {}) },
  });
  await audit({ action: `vehicle.${body.decision.toLowerCase()}`, entityType: 'Vehicle', entityId: v.id, communityId: cid, before: { status: v.status, seatCapacity: v.seatCapacity }, after: { status, seatCapacity: updated.seatCapacity, note: body.note } }, { ctx: req.auth, req });
  await notify(v.assignments.map((a) => a.driver.userId), { type: 'VEHICLE_DECISION', title: `Vehicle ${v.registrationNumber} ${status.toLowerCase()}`, body: body.note ?? '', link: '/driver/profile' });
  ok(res, updated);
});

// ─────────── Live driver availability & stand queue ───────────

communityOpsRoutes.get('/queue', requireCommunity('community.queue.manage'), async (req, res) => {
  const cid = communityId(req);
  const [drivers, stands] = await Promise.all([
    prisma.driverAvailability.findMany({
      where: { communityId: cid, status: { in: ['ONLINE', 'ON_TRIP'] } },
      select: {
        status: true,
        standId: true,
        queuedAt: true,
        updatedAt: true,
        driver: { select: { id: true, user: { select: { name: true } }, location: { select: { lat: true, lng: true, updatedAt: true } }, vehicleAssignments: { where: { active: true, vehicle: { communityId: cid } }, select: { vehicle: { select: { registrationNumber: true } } } } } },
      },
      orderBy: [{ standId: 'asc' }, { queuedAt: 'asc' }],
    }),
    prisma.pickupPoint.findMany({ where: { communityId: cid, isStand: true, active: true }, select: { id: true, name: true, lat: true, lng: true } }),
  ]);
  ok(res, { drivers, stands });
});

communityOpsRoutes.post('/queue/:driverId/remove', requireCommunity('community.queue.manage'), async (req, res) => {
  const cid = communityId(req);
  const body = parse(z.object({ reason: z.string().trim().min(3).max(300) }), req.body);
  const result = await prisma.driverAvailability.updateMany({ where: { driverId: param(req, 'driverId'), communityId: cid, standId: { not: null } }, data: { standId: null, queuedAt: null } });
  if (result.count === 0) throw notFound('Queued driver');
  await audit({ action: 'queue.driver_removed', entityType: 'Driver', entityId: param(req, 'driverId'), communityId: cid, after: body }, { ctx: req.auth, req });
  emitToCommunity(cid, 'queue:updated', { driverId: param(req, 'driverId') });
  ok(res, { removed: true });
});

// ─────────── Pickup points & auto stands ───────────

const PickupPointSchema = z.object({
  name: z.string().trim().min(2).max(150),
  description: z.string().trim().max(500).nullable().optional(),
  lat: Lat,
  lng: Lng,
  isStand: z.boolean().default(false),
  active: z.boolean().default(true),
});

communityOpsRoutes.get('/pickup-points', requireCommunity('community.view'), async (req, res) => {
  ok(res, await prisma.pickupPoint.findMany({ where: { communityId: communityId(req) }, orderBy: { name: 'asc' } }));
});

communityOpsRoutes.post('/pickup-points', requireCommunity('community.routes.manage'), async (req, res) => {
  const cid = communityId(req);
  const point = await prisma.pickupPoint.create({ data: { ...parse(PickupPointSchema, req.body), communityId: cid } });
  await audit({ action: 'pickup_point.created', entityType: 'PickupPoint', entityId: point.id, communityId: cid, after: point }, { ctx: req.auth, req });
  created(res, point);
});

communityOpsRoutes.patch('/pickup-points/:pointId', requireCommunity('community.routes.manage'), async (req, res) => {
  const cid = communityId(req);
  const data = parse(PickupPointSchema.partial(), req.body);
  const existing = await prisma.pickupPoint.findFirst({ where: { id: param(req, 'pointId'), communityId: cid } });
  if (!existing) throw notFound('Pickup point');
  const point = await prisma.pickupPoint.update({ where: { id: existing.id }, data });
  await audit({ action: 'pickup_point.updated', entityType: 'PickupPoint', entityId: point.id, communityId: cid, before: existing, after: data }, { ctx: req.auth, req });
  ok(res, point);
});

/** Delete a pickup/drop point. Points still used as route stops must be removed from those routes first. */
communityOpsRoutes.delete('/pickup-points/:pointId', requireCommunity('community.routes.manage'), async (req, res) => {
  const cid = communityId(req);
  const existing = await prisma.pickupPoint.findFirst({ where: { id: param(req, 'pointId'), communityId: cid } });
  if (!existing) throw notFound('Pickup point');
  const routes = await prisma.routeStop.findMany({ where: { pickupPointId: existing.id }, select: { route: { select: { code: true } } } });
  if (routes.length) throw conflict(`Used by route ${routes.map((r) => r.route.code).join(', ')}. Remove it from those routes first, or disable it.`, 'IN_USE');
  await prisma.$transaction([
    prisma.driverAvailability.updateMany({ where: { standId: existing.id }, data: { standId: null, queuedAt: null } }),
    prisma.pickupPoint.delete({ where: { id: existing.id } }),
  ]);
  await audit({ action: 'pickup_point.deleted', entityType: 'PickupPoint', entityId: existing.id, communityId: cid, before: existing }, { ctx: req.auth, req });
  ok(res, { deleted: true });
});

// ─────────── Shared routes, stops and schedules ───────────

const RouteSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/, 'Use 2–20 letters, digits or dashes'),
  name: z.string().trim().min(3).max(150),
  description: z.string().trim().max(1000).nullable().optional(),
  maxSeats: z.number().int().min(1).max(6),
  bookingCutoffMinutes: z.number().int().min(0).max(240).default(5),
  cancellationCutoffMinutes: z.number().int().min(0).max(1440).default(15),
  boardingRules: z.string().trim().max(1000).nullable().optional(),
  stops: z
    .array(z.object({ pickupPointId: z.string().max(40), offsetMinutes: z.number().int().min(0).max(600) }))
    .min(2, 'A route needs at least two stops')
    .max(30),
});

/** Validate that stops belong to this community, are unique, and offsets increase. */
async function validateStops(cid: string, stops: { pickupPointId: string; offsetMinutes: number }[]) {
  const ids = stops.map((s) => s.pickupPointId);
  if (new Set(ids).size !== ids.length) throw unprocessable('A pickup point can appear only once on a route', 'DUPLICATE_STOP');
  const found = await prisma.pickupPoint.count({ where: { id: { in: ids }, communityId: cid, active: true } });
  if (found !== ids.length) throw unprocessable('Every stop must be an active pickup point of this community', 'INVALID_STOP');
  for (let i = 1; i < stops.length; i++) {
    if (stops[i]!.offsetMinutes <= stops[i - 1]!.offsetMinutes) throw unprocessable('Stop times must increase along the route', 'STOP_ORDER');
  }
  if (stops[0]!.offsetMinutes !== 0) throw unprocessable('The first stop must be at departure time (offset 0)', 'STOP_ORDER');
}

/** Largest approved vehicle capacity in the community: route seat counts can never exceed it. */
async function maxApprovedCapacity(cid: string) {
  const agg = await prisma.vehicle.aggregate({ where: { communityId: cid, status: 'APPROVED' }, _max: { seatCapacity: true } });
  return agg._max.seatCapacity ?? 3;
}

communityOpsRoutes.get('/routes', requireCommunity('community.view'), async (req, res) => {
  const routes = await prisma.sharedRoute.findMany({
      where: { communityId: communityId(req) },
      include: {
        stops: { orderBy: { sequence: 'asc' }, include: { pickupPoint: { select: { id: true, name: true, lat: true, lng: true } } } },
        schedules: { orderBy: { departureTime: 'asc' } },
      },
      orderBy: { code: 'asc' },
    });
  backfillRoutePaths(routes);
  ok(res, routes);
});

communityOpsRoutes.post('/routes', requireCommunity('community.routes.manage'), async (req, res) => {
  const cid = communityId(req);
  const body = parse(RouteSchema, req.body);
  await validateStops(cid, body.stops);
  const cap = await maxApprovedCapacity(cid);
  if (body.maxSeats > cap) throw unprocessable(`Route seats cannot exceed the largest approved vehicle capacity (${cap})`, 'CAPACITY_EXCEEDED');
  const { stops, ...route } = body;
  const createdRoute = await prisma.sharedRoute.create({
    data: { ...route, communityId: cid, stops: { create: stops.map((s, i) => ({ ...s, sequence: i + 1 })) } },
    include: { stops: { orderBy: { sequence: 'asc' } } },
  });
  await audit({ action: 'route.created', entityType: 'SharedRoute', entityId: createdRoute.id, communityId: cid, after: body }, { ctx: req.auth, req });
  void refreshRoutePath(createdRoute.id); // road path is drawn once the routing provider answers
  created(res, createdRoute);
});

communityOpsRoutes.patch('/routes/:routeId', requireCommunity('community.routes.manage'), async (req, res) => {
  const cid = communityId(req);
  const body = parse(RouteSchema.partial().extend({ status: z.enum(['DRAFT', 'ACTIVE', 'SUSPENDED']).optional() }), req.body);
  const existing = await prisma.sharedRoute.findFirst({ where: { id: param(req, 'routeId'), communityId: cid }, include: { stops: true } });
  if (!existing) throw notFound('Route');
  if (body.maxSeats && body.maxSeats > (await maxApprovedCapacity(cid))) throw unprocessable('Route seats cannot exceed approved vehicle capacity', 'CAPACITY_EXCEEDED');
  if (body.status === 'ACTIVE') {
    if (!(await findActiveRule(cid, 'SHARED', existing.id))) throw unprocessable('Publish an approved fare for this route before activating it', 'NO_FARE_RULE');
  }
  const { stops, ...data } = body;
  const updated = await prisma.$transaction(async (tx) => {
    if (stops) {
      await validateStops(cid, stops);
      const booked = await tx.booking.count({ where: { tripInstance: { routeId: existing.id }, status: { in: ['REQUESTED', 'CONFIRMED', 'IN_PROGRESS'] } } });
      if (booked > 0) throw conflict('Stops cannot change while passengers hold bookings on this route', 'ROUTE_IN_USE');
      await tx.routeStop.deleteMany({ where: { routeId: existing.id } });
      await tx.routeStop.createMany({ data: stops.map((s, i) => ({ ...s, routeId: existing.id, sequence: i + 1 })) });
    }
    return tx.sharedRoute.update({ where: { id: existing.id }, data, include: { stops: { orderBy: { sequence: 'asc' } }, schedules: true } });
  });
  await audit({ action: 'route.updated', entityType: 'SharedRoute', entityId: existing.id, communityId: cid, before: { status: existing.status, maxSeats: existing.maxSeats }, after: body }, { ctx: req.auth, req });
  if (stops) void refreshRoutePath(existing.id);
  ok(res, updated);
});

const ScheduleSchema = z.object({
  departureTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)'),
  daysOfWeek: z.number().int().min(1).max(127).default(127),
  seatCapacity: z.number().int().min(1).max(6),
  validFrom: z.coerce.date(),
  validTo: z.coerce.date().nullable().optional(),
  active: z.boolean().default(true),
});

communityOpsRoutes.post('/routes/:routeId/schedules', requireCommunity('community.routes.manage'), async (req, res) => {
  const cid = communityId(req);
  const body = parse(ScheduleSchema, req.body);
  const route = await prisma.sharedRoute.findFirst({ where: { id: param(req, 'routeId'), communityId: cid } });
  if (!route) throw notFound('Route');
  if (body.seatCapacity > route.maxSeats) throw unprocessable(`Departure capacity cannot exceed the route maximum (${route.maxSeats})`, 'CAPACITY_EXCEEDED');
  if (body.validTo && body.validTo <= body.validFrom) throw unprocessable('validTo must be after validFrom');
  const schedule = await prisma.routeSchedule.create({ data: { ...body, routeId: route.id } });
  await audit({ action: 'schedule.created', entityType: 'RouteSchedule', entityId: schedule.id, communityId: cid, after: body }, { ctx: req.auth, req });
  created(res, schedule);
});

communityOpsRoutes.patch('/routes/:routeId/schedules/:scheduleId', requireCommunity('community.routes.manage'), async (req, res) => {
  const cid = communityId(req);
  const body = parse(ScheduleSchema.partial(), req.body);
  const schedule = await prisma.routeSchedule.findFirst({ where: { id: param(req, 'scheduleId'), routeId: param(req, 'routeId'), route: { communityId: cid } }, include: { route: true } });
  if (!schedule) throw notFound('Schedule');
  if (body.seatCapacity && body.seatCapacity > schedule.route.maxSeats) throw unprocessable('Capacity exceeds route maximum', 'CAPACITY_EXCEEDED');
  const updated = await prisma.routeSchedule.update({ where: { id: schedule.id }, data: body });
  // Capacity changes apply only to future departures with no bookings above the new capacity.
  if (body.seatCapacity) {
    await prisma.sharedTripInstance.updateMany({
      where: { scheduleId: schedule.id, status: 'SCHEDULED', departureAt: { gt: new Date() }, seatsBooked: { lte: body.seatCapacity } },
      data: { capacity: body.seatCapacity },
    });
  }
  await audit({ action: 'schedule.updated', entityType: 'RouteSchedule', entityId: schedule.id, communityId: cid, before: schedule, after: body }, { ctx: req.auth, req });
  ok(res, updated);
});

/** Delete a route that has never carried a booking; otherwise suspend it to keep the trip history. */
communityOpsRoutes.delete('/routes/:routeId', requireCommunity('community.routes.manage'), async (req, res) => {
  const cid = communityId(req);
  const existing = await prisma.sharedRoute.findFirst({ where: { id: param(req, 'routeId'), communityId: cid } });
  if (!existing) throw notFound('Route');
  const booked = await prisma.booking.count({ where: { tripInstance: { routeId: existing.id } } });
  if (booked) throw conflict('This route has bookings in its history. Suspend it instead of deleting.', 'HAS_HISTORY');
  await prisma.$transaction(async (tx) => {
    await tx.fareRule.updateMany({ where: { sharedRouteId: existing.id, effectiveTo: null }, data: { effectiveTo: new Date() } });
    await tx.sharedRoute.delete({ where: { id: existing.id } });
  });
  await audit({ action: 'route.deleted', entityType: 'SharedRoute', entityId: existing.id, communityId: cid, before: { code: existing.code, name: existing.name } }, { ctx: req.auth, req });
  ok(res, { deleted: true });
});

communityOpsRoutes.delete('/routes/:routeId/schedules/:scheduleId', requireCommunity('community.routes.manage'), async (req, res) => {
  const cid = communityId(req);
  const schedule = await prisma.routeSchedule.findFirst({ where: { id: param(req, 'scheduleId'), routeId: param(req, 'routeId'), route: { communityId: cid } } });
  if (!schedule) throw notFound('Schedule');
  const booked = await prisma.booking.count({ where: { tripInstance: { scheduleId: schedule.id } } });
  if (booked) throw conflict('Departures of this schedule have bookings. Pause the schedule instead.', 'HAS_HISTORY');
  await prisma.routeSchedule.delete({ where: { id: schedule.id } });
  await audit({ action: 'schedule.deleted', entityType: 'RouteSchedule', entityId: schedule.id, communityId: cid, before: schedule }, { ctx: req.auth, req });
  ok(res, { deleted: true });
});

// ─────────── Bookings & statistics ───────────

communityOpsRoutes.get('/bookings', requireCommunity('community.bookings.view'), async (req, res) => {
  const cid = communityId(req);
  const { page, pageSize, skip, take } = pagination(req);
  const q = parse(z.object({ status: z.string().max(30).optional(), type: z.enum(['REGULAR', 'SHARED']).optional() }), req.query);
  const where = { communityId: cid, ...(q.status ? { status: q.status as never } : {}), ...(q.type ? { type: q.type } : {}) };
  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: {
        id: true, reference: true, type: true, status: true, paymentStatus: true, paymentMethod: true, seatCount: true,
        pickupAddress: true, dropAddress: true, quotedFarePaise: true, finalFarePaise: true, cancellationFeePaise: true, createdAt: true, cancelReason: true,
        passenger: { select: { name: true } },
        driver: { select: { id: true, user: { select: { name: true } } } },
      },
    }),
    prisma.booking.count({ where }),
  ]);
  ok(res, items, pageMeta(page, pageSize, total));
});

communityOpsRoutes.get('/stats', requireCommunity('community.bookings.view'), async (req, res) => {
  const cid = communityId(req);
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [byStatus, byType, revenue, cancellations] = await Promise.all([
    prisma.booking.groupBy({ by: ['status'], where: { communityId: cid, createdAt: { gte: since } }, _count: true }),
    prisma.booking.groupBy({ by: ['type'], where: { communityId: cid, createdAt: { gte: since } }, _count: true }),
    prisma.platformFeeRecord.aggregate({ where: { communityId: cid, createdAt: { gte: since } }, _sum: { farePaise: true, platformFeePaise: true, communityFeePaise: true, driverNetPaise: true }, _count: true }),
    prisma.booking.groupBy({ by: ['cancelReason'], where: { communityId: cid, status: 'CANCELLED', createdAt: { gte: since } }, _count: true, orderBy: { _count: { cancelReason: 'desc' } }, take: 10 }),
  ]);
  ok(res, {
    periodDays: 30,
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
    byType: Object.fromEntries(byType.map((s) => [s.type, s._count])),
    completedTrips: revenue._count,
    revenue: revenue._sum,
    topCancellationReasons: cancellations.map((c) => ({ reason: c.cancelReason ?? 'Not specified', count: c._count })),
  });
});
