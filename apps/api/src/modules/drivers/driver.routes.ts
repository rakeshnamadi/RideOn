import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { auth, authenticate } from '../../middleware/auth.js';
import { documentUpload, readPrivateFile, safeFilename, storePrivateFile } from '../../services/uploads.js';
import { badRequest, conflict, notFound, unprocessable } from '../../utils/errors.js';
import { haversineMeters } from '../../utils/geo.js';
import { IdParam, created, ok, pageMeta, pagination, parse } from '../../utils/http.js';
import { audit } from '../audit/audit.service.js';
import { communityAdminUserIds, notify } from '../notifications/notification.service.js';
import { Lat, Lng } from '../geo/geo.routes.js';
import { assertCanViewDriverPrivate, getEligibility, requireDriver } from './driver.service.js';
import { emitToCommunity, emitToUser } from '../../sockets/index.js';

export const driverRoutes = Router();
driverRoutes.use(authenticate);

const LicenseSchema = z.object({
  licenseNumber: z.string().trim().toUpperCase().regex(/^[A-Z]{2}[0-9A-Z -]{8,18}$/, 'Enter a valid Indian driving licence number'),
  licenseExpiry: z.coerce.date().refine((d) => d > new Date(), 'Licence must not be expired'),
});

/** Register the caller as a driver. Adds the DRIVER role to the account. */
driverRoutes.post('/me', async (req, res) => {
  const ctx = auth(req);
  if (ctx.driverId) throw conflict('Driver profile already exists');
  const body = parse(LicenseSchema, req.body);
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'DRIVER' } });
  const driver = await prisma.$transaction(async (tx) => {
    await tx.userRole.upsert({ where: { userId_roleId: { userId: ctx.userId, roleId: role.id } }, create: { userId: ctx.userId, roleId: role.id }, update: {} });
    const d = await tx.driver.create({ data: { userId: ctx.userId, ...body } });
    await tx.driverAvailability.create({ data: { driverId: d.id } });
    return d;
  });
  await audit({ action: 'driver.registered', entityType: 'Driver', entityId: driver.id }, { ctx, req });
  created(res, driver);
});

driverRoutes.get('/me', async (req, res) => {
  const driverId = requireDriver(auth(req));
  const driver = await prisma.driver.findUniqueOrThrow({
    where: { id: driverId },
    include: {
      user: { select: { name: true, phone: true } },
      documents: { orderBy: { createdAt: 'desc' }, select: { id: true, type: true, originalName: true, status: true, reviewNote: true, createdAt: true, expiresAt: true } },
      memberships: { include: { community: { select: { id: true, name: true, status: true } } } },
      vehicleAssignments: { where: { active: true }, include: { vehicle: true } },
      availability: { include: { stand: { select: { id: true, name: true } } } },
    },
  });
  const eligibility = await Promise.all(
    driver.memberships
      .filter((m) => m.status === 'APPROVED')
      .map(async (m) => ({ communityId: m.communityId, communityName: m.community.name, ...(await getEligibility(driverId, m.communityId)) })),
  );
  ok(res, { ...driver, eligibility });
});

driverRoutes.patch('/me', async (req, res) => {
  const ctx = auth(req);
  const driverId = requireDriver(ctx);
  const body = parse(LicenseSchema.partial(), req.body);
  // Any licence change requires re-verification.
  const driver = await prisma.driver.update({
    where: { id: driverId },
    data: { ...body, ...(Object.keys(body).length ? { verificationStatus: 'PENDING', verifiedAt: null, verifiedById: null } : {}) },
  });
  await audit({ action: 'driver.license_updated', entityType: 'Driver', entityId: driverId, after: body }, { ctx, req });
  ok(res, driver);
});

// ─────────── Documents ───────────

driverRoutes.post('/me/documents', documentUpload.single('file'), async (req, res) => {
  const ctx = auth(req);
  const driverId = requireDriver(ctx);
  const body = parse(
    z.object({
      type: z.enum(['DRIVING_LICENSE', 'VEHICLE_RC', 'PERMIT', 'INSURANCE', 'ID_PROOF', 'PHOTO']),
      expiresAt: z.coerce.date().optional(),
    }),
    req.body,
  );
  if (!req.file) throw badRequest('Attach a file in the "file" field');
  const { storageKey, mimeType } = await storePrivateFile(req.file.buffer);
  const doc = await prisma.driverDocument.create({
    data: { driverId, type: body.type, storageKey, originalName: safeFilename(req.file.originalname), mimeType, sizeBytes: req.file.size, expiresAt: body.expiresAt },
    select: { id: true, type: true, status: true, originalName: true, createdAt: true },
  });
  // Submitting documents moves a pending driver into review.
  await prisma.driver.updateMany({ where: { id: driverId, verificationStatus: { in: ['PENDING', 'REJECTED'] } }, data: { verificationStatus: 'UNDER_REVIEW' } });
  await audit({ action: 'driver.document_uploaded', entityType: 'DriverDocument', entityId: doc.id, after: { type: body.type } }, { ctx, req });
  created(res, doc);
});

/** Stream a private document. Authorisation is checked per document, per caller. */
driverRoutes.get('/documents/:id/file', async (req, res) => {
  const ctx = auth(req);
  const { id } = parse(IdParam, req.params);
  const doc = await prisma.driverDocument.findUnique({ where: { id } });
  if (!doc) throw notFound('Document');
  await assertCanViewDriverPrivate(ctx, doc.driverId);
  const file = await readPrivateFile(doc.storageKey);
  await audit({ action: 'driver.document_viewed', entityType: 'DriverDocument', entityId: doc.id }, { ctx, req });
  res.setHeader('Content-Type', doc.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${doc.originalName}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(file);
});

// ─────────── Community membership ───────────

driverRoutes.post('/me/memberships', async (req, res) => {
  const ctx = auth(req);
  const driverId = requireDriver(ctx);
  const body = parse(z.object({ communityId: z.string().max(40), note: z.string().trim().max(1000).optional() }), req.body);
  const community = await prisma.community.findFirst({ where: { id: body.communityId, status: 'ACTIVE' } });
  if (!community) throw notFound('Community');
  const existing = await prisma.communityMembership.findUnique({ where: { communityId_driverId: { communityId: body.communityId, driverId } } });
  if (existing && !['REJECTED', 'LEFT'].includes(existing.status)) throw conflict(`Membership is already ${existing.status.toLowerCase()}`);
  const membership = await prisma.communityMembership.upsert({
    where: { communityId_driverId: { communityId: body.communityId, driverId } },
    create: { communityId: body.communityId, driverId, applicationNote: body.note },
    update: { status: 'APPLIED', applicationNote: body.note, decidedAt: null, decidedById: null, decisionNote: null },
  });
  await audit({ action: 'membership.applied', entityType: 'CommunityMembership', entityId: membership.id, communityId: body.communityId }, { ctx, req });
  await notify(await communityAdminUserIds(body.communityId), {
    type: 'MEMBERSHIP_APPLICATION',
    title: 'New driver application',
    body: `${ctx.name} applied to join ${community.name}.`,
    link: `/community/${body.communityId}/members`,
  });
  created(res, membership);
});

driverRoutes.post('/me/memberships/:id/leave', async (req, res) => {
  const ctx = auth(req);
  const driverId = requireDriver(ctx);
  const { id } = parse(IdParam, req.params);
  const m = await prisma.communityMembership.findFirst({ where: { id, driverId } });
  if (!m) throw notFound('Membership');
  await prisma.communityMembership.update({ where: { id }, data: { status: 'LEFT' } });
  await prisma.driverAvailability.updateMany({ where: { driverId, communityId: m.communityId, status: 'ONLINE' }, data: { status: 'OFFLINE', standId: null, queuedAt: null } });
  await audit({ action: 'membership.left', entityType: 'CommunityMembership', entityId: id, communityId: m.communityId }, { ctx, req });
  ok(res, { left: true });
});

// ─────────── Vehicles ───────────

const VehicleSchema = z.object({
  communityId: z.string().max(40),
  registrationNumber: z.string().trim().toUpperCase().regex(/^[A-Z]{2}[ -]?\d{1,2}[ -]?[A-Z]{0,3}[ -]?\d{1,4}$/, 'Enter a valid registration number').transform((r) => r.replace(/[ -]/g, '')),
  make: z.string().trim().min(2).max(60),
  model: z.string().trim().min(1).max(60),
  color: z.string().trim().max(30).optional(),
  year: z.number().int().min(1990).max(new Date().getFullYear() + 1).optional(),
  fuelType: z.enum(['CNG', 'LPG', 'PETROL', 'DIESEL', 'ELECTRIC']).optional(),
  permitNumber: z.string().trim().max(60).optional(),
  permitExpiry: z.coerce.date().optional(),
  insuranceExpiry: z.coerce.date().optional(),
});

/** Drivers register vehicles; seat capacity is set by the community on approval and cannot be edited by the driver. */
driverRoutes.post('/me/vehicles', async (req, res) => {
  const ctx = auth(req);
  const driverId = requireDriver(ctx);
  const body = parse(VehicleSchema, req.body);
  const membership = await prisma.communityMembership.findUnique({ where: { communityId_driverId: { communityId: body.communityId, driverId } } });
  if (!membership || !['APPLIED', 'APPROVED'].includes(membership.status)) {
    throw unprocessable('Apply to the community before registering a vehicle with it', 'MEMBERSHIP_REQUIRED');
  }
  const vehicle = await prisma.$transaction(async (tx) => {
    await tx.driverVehicleAssignment.updateMany({ where: { driverId, active: true, vehicle: { communityId: body.communityId } }, data: { active: false, unassignedAt: new Date() } });
    const v = await tx.vehicle.create({ data: { ...body, status: 'PENDING' } });
    await tx.driverVehicleAssignment.create({ data: { driverId, vehicleId: v.id } });
    return v;
  });
  await audit({ action: 'vehicle.registered', entityType: 'Vehicle', entityId: vehicle.id, communityId: body.communityId, after: { registrationNumber: vehicle.registrationNumber } }, { ctx, req });
  await notify(await communityAdminUserIds(body.communityId), { type: 'VEHICLE_REVIEW', title: 'Vehicle awaiting approval', body: vehicle.registrationNumber, link: `/community/${body.communityId}/vehicles` });
  created(res, vehicle);
});

driverRoutes.get('/me/eligibility', async (req, res) => {
  const driverId = requireDriver(auth(req));
  const { communityId } = parse(z.object({ communityId: z.string().max(40) }), req.query);
  ok(res, await getEligibility(driverId, communityId));
});

// ─────────── Availability, stand queue and location ───────────

driverRoutes.post('/me/availability', async (req, res) => {
  const ctx = auth(req);
  const driverId = requireDriver(ctx);
  const body = parse(
    z.discriminatedUnion('status', [
      z.object({ status: z.literal('ONLINE'), communityId: z.string().max(40), standId: z.string().max(40).nullable().optional(), lat: Lat, lng: Lng }),
      z.object({ status: z.literal('OFFLINE') }),
    ]),
    req.body,
  );
  const current = await prisma.driverAvailability.upsert({ where: { driverId }, create: { driverId }, update: {} });
  if (current.status === 'ON_TRIP') throw conflict('Finish your current trip before changing availability', 'ON_TRIP');

  if (body.status === 'OFFLINE') {
    await prisma.$transaction([
      prisma.driverAvailability.update({ where: { driverId }, data: { status: 'OFFLINE', standId: null, queuedAt: null } }),
      // Location is only kept while online: delete it immediately.
      prisma.driverLocation.deleteMany({ where: { driverId } }),
      prisma.bookingAssignment.updateMany({ where: { driverId, status: 'OFFERED' }, data: { status: 'WITHDRAWN', respondedAt: new Date() } }),
    ]);
    if (current.communityId) emitToCommunity(current.communityId, 'queue:updated', { driverId });
    return ok(res, { status: 'OFFLINE' });
  }

  const eligibility = await getEligibility(driverId, body.communityId);
  if (!eligibility.eligible) throw unprocessable('You cannot go online yet', 'NOT_ELIGIBLE', eligibility.reasons);
  let standId: string | null = null;
  if (body.standId) {
    const stand = await prisma.pickupPoint.findFirst({ where: { id: body.standId, communityId: body.communityId, isStand: true, active: true } });
    if (!stand) throw notFound('Auto stand');
    if (haversineMeters(stand, body) > 300) throw unprocessable('You must be at the stand (within 300 m) to join its queue', 'NOT_AT_STAND');
    standId = stand.id;
  }
  await prisma.$transaction([
    prisma.driverAvailability.update({
      where: { driverId },
      data: { status: 'ONLINE', communityId: body.communityId, standId, queuedAt: standId ? (current.standId === standId ? current.queuedAt : new Date()) : null },
    }),
    prisma.driverLocation.upsert({ where: { driverId }, create: { driverId, lat: body.lat, lng: body.lng }, update: { lat: body.lat, lng: body.lng } }),
  ]);
  emitToCommunity(body.communityId, 'queue:updated', { driverId });
  ok(res, { status: 'ONLINE', communityId: body.communityId, standId, vehicle: eligibility.vehicle });
});

driverRoutes.post('/me/location', async (req, res) => {
  const driverId = requireDriver(auth(req));
  const body = parse(z.object({ lat: Lat, lng: Lng, heading: z.number().min(0).max(360).optional(), accuracyM: z.number().min(0).max(10_000).optional() }), req.body);
  const availability = await prisma.driverAvailability.findUnique({ where: { driverId } });
  // Never track drivers who are offline.
  if (!availability || availability.status === 'OFFLINE') throw conflict('Location is only shared while you are online', 'OFFLINE');
  await prisma.driverLocation.upsert({ where: { driverId }, create: { driverId, ...body }, update: body });
  if (availability.status === 'ON_TRIP') {
    const active = await prisma.booking.findFirst({ where: { driverId, status: { in: ['ACCEPTED', 'ARRIVING', 'IN_PROGRESS'] } }, select: { id: true, passengerId: true } });
    if (active) {
      emitToUser(active.passengerId, 'driver:location', { bookingId: active.id, lat: body.lat, lng: body.lng, heading: body.heading ?? null, at: new Date() });
    }
  }
  ok(res, { recorded: true });
});

// ─────────── Offers, trips and earnings ───────────

driverRoutes.get('/me/offers', async (req, res) => {
  const driverId = requireDriver(auth(req));
  const offers = await prisma.bookingAssignment.findMany({
    where: { driverId, status: 'OFFERED', expiresAt: { gt: new Date() }, booking: { status: 'REQUESTED' } },
    select: {
      id: true,
      expiresAt: true,
      distanceMeters: true,
      booking: {
        select: {
          id: true,
          reference: true,
          pickupLat: true,
          pickupLng: true,
          pickupAddress: true,
          dropLat: true,
          dropLng: true,
          dropAddress: true,
          distanceMeters: true,
          quotedFarePaise: true,
          paymentMethod: true,
        },
      },
    },
    orderBy: { offeredAt: 'desc' },
  });
  ok(res, offers);
});

driverRoutes.get('/me/active', async (req, res) => {
  const driverId = requireDriver(auth(req));
  const booking = await prisma.booking.findFirst({
    where: { driverId, type: 'REGULAR', status: { in: ['ACCEPTED', 'ARRIVING', 'IN_PROGRESS'] } },
    include: { passenger: { select: { name: true } } },
  });
  ok(res, booking ? { ...booking, startPin: undefined, passenger: { firstName: booking.passenger.name.split(' ')[0] } } : null);
});

driverRoutes.get('/me/trips', async (req, res) => {
  const driverId = requireDriver(auth(req));
  const { page, pageSize, skip, take } = pagination(req);
  const where = { driverId };
  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: { id: true, reference: true, type: true, status: true, pickupAddress: true, dropAddress: true, quotedFarePaise: true, finalFarePaise: true, driverEarningsPaise: true, platformFeePaise: true, communityFeePaise: true, paymentStatus: true, paymentMethod: true, createdAt: true, completedAt: true, seatCount: true },
    }),
    prisma.booking.count({ where }),
  ]);
  ok(res, items, pageMeta(page, pageSize, total));
});

/** Transparent earnings: gross fare, every deduction, and net, per day for the selected month. */
driverRoutes.get('/me/earnings', async (req, res) => {
  const driverId = requireDriver(auth(req));
  const q = parse(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }), req.query);
  const now = new Date();
  const [y, m] = (q.month ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`).split('-').map(Number) as [number, number];
  // IST month boundaries.
  const start = new Date(Date.UTC(y, m - 1, 1) - 330 * 60_000);
  const end = new Date(Date.UTC(y, m, 1) - 330 * 60_000);
  const records = await prisma.platformFeeRecord.findMany({
    where: { booking: { driverId }, createdAt: { gte: start, lt: end } },
    select: { farePaise: true, platformFeePaise: true, communityFeePaise: true, processingFeePaise: true, driverNetPaise: true, createdAt: true, booking: { select: { paymentMethod: true, paymentStatus: true } } },
  });
  const days = new Map<string, { date: string; trips: number; farePaise: number; platformFeePaise: number; communityFeePaise: number; driverNetPaise: number }>();
  const totals = { trips: 0, farePaise: 0, platformFeePaise: 0, communityFeePaise: 0, processingFeePaise: 0, driverNetPaise: 0, cashCollectedPaise: 0 };
  for (const r of records) {
    const date = new Date(r.createdAt.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    const d = days.get(date) ?? { date, trips: 0, farePaise: 0, platformFeePaise: 0, communityFeePaise: 0, driverNetPaise: 0 };
    d.trips++;
    d.farePaise += r.farePaise;
    d.platformFeePaise += r.platformFeePaise;
    d.communityFeePaise += r.communityFeePaise;
    d.driverNetPaise += r.driverNetPaise;
    days.set(date, d);
    totals.trips++;
    totals.farePaise += r.farePaise;
    totals.platformFeePaise += r.platformFeePaise;
    totals.communityFeePaise += r.communityFeePaise;
    totals.processingFeePaise += r.processingFeePaise;
    totals.driverNetPaise += r.driverNetPaise;
    if (r.booking.paymentMethod === 'CASH' && r.booking.paymentStatus === 'PAID') totals.cashCollectedPaise += r.farePaise;
  }
  ok(res, {
    month: `${y}-${String(m).padStart(2, '0')}`,
    totals,
    // Cash fares are collected by the driver, so platform/community fees on cash trips are owed back.
    feesOwedOnCashPaise: records
      .filter((r) => r.booking.paymentMethod === 'CASH')
      .reduce((s, r) => s + r.platformFeePaise + r.communityFeePaise, 0),
    days: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)),
  });
});

driverRoutes.get('/:id', async (req, res) => {
  const ctx = auth(req);
  const { id } = parse(IdParam, req.params);
  await assertCanViewDriverPrivate(ctx, id);
  const driver = await prisma.driver.findUnique({
    where: { id },
    include: {
      user: { select: { name: true, phone: true, status: true } },
      documents: { select: { id: true, type: true, status: true, originalName: true, reviewNote: true, createdAt: true, expiresAt: true } },
      memberships: { include: { community: { select: { id: true, name: true } } } },
      vehicleAssignments: { where: { active: true }, include: { vehicle: true } },
    },
  });
  if (!driver) throw notFound('Driver');
  ok(res, driver);
});
