import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { auth, authenticate, optionalAuth, requirePermission } from '../../middleware/auth.js';
import { communitiesWithPermission } from '../auth/auth-context.js';
import { forbidden } from '../../utils/errors.js';
import { IdParam, created, ok, parse, param } from '../../utils/http.js';
import { Lat, Lng } from '../geo/geo.routes.js';
import { requireDriver } from '../drivers/driver.service.js';
import {
  assignDriver,
  cancelDeparture,
  ensureTripInstances,
  holdSeats,
  manifest,
  passengerAction,
  recordTripEvent,
  searchDepartures,
  updateTripStatus,
} from './shared-trip.service.js';

export const sharedTripRoutes = Router();

/** Public: browse upcoming departures and live seat availability. */
sharedTripRoutes.get('/search', optionalAuth, async (req, res) => {
  const q = parse(
    z.object({
      communityId: z.string().max(40).optional(),
      routeId: z.string().max(40).optional(),
      fromPointId: z.string().max(40).optional(),
      toPointId: z.string().max(40).optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
    req.query,
  );
  ok(res, await searchDepartures(q));
});

sharedTripRoutes.use(authenticate);

sharedTripRoutes.post('/:id/reservations', requirePermission('booking.create'), async (req, res) => {
  const { id } = parse(IdParam, req.params);
  const body = parse(
    z.object({
      pickupStopId: z.string().max(40),
      dropStopId: z.string().max(40),
      seats: z.number().int().min(1).max(4),
      idempotencyKey: z.string().trim().min(8).max(64).regex(/^[\w-]+$/),
      paymentMethod: z.enum(['CASH', 'MOCK_ONLINE', 'ONLINE']).default('CASH'),
    }),
    req.body,
  );
  const { booking, replayed } = await holdSeats(auth(req), { ...body, tripInstanceId: id }, req);
  return replayed ? ok(res, booking, { replayed: true }) : created(res, booking);
});

// ─────────── Driver ───────────

sharedTripRoutes.get('/driver/mine', async (req, res) => {
  const driverId = requireDriver(auth(req));
  await ensureTripInstances();
  const trips = await prisma.sharedTripInstance.findMany({
    where: { driverId, status: { in: ['SCHEDULED', 'BOARDING', 'IN_PROGRESS'] } },
    include: { route: { select: { code: true, name: true } } },
    orderBy: { departureAt: 'asc' },
    take: 20,
  });
  ok(res, trips);
});

/** Unassigned departures in the driver's approved communities that they could claim. */
sharedTripRoutes.get('/driver/available', async (req, res) => {
  const driverId = requireDriver(auth(req));
  const memberships = await prisma.communityMembership.findMany({ where: { driverId, status: 'APPROVED' }, select: { communityId: true } });
  await ensureTripInstances();
  const trips = await prisma.sharedTripInstance.findMany({
    where: { driverId: null, status: 'SCHEDULED', communityId: { in: memberships.map((m) => m.communityId) }, departureAt: { gt: new Date() } },
    include: { route: { select: { code: true, name: true } } },
    orderBy: { departureAt: 'asc' },
    take: 30,
  });
  ok(res, trips);
});

sharedTripRoutes.post('/:id/claim', async (req, res) => {
  const ctx = auth(req);
  const { id } = parse(IdParam, req.params);
  ok(res, await assignDriver(ctx, id, requireDriver(ctx), 'CLAIM', req));
});

sharedTripRoutes.get('/:id/manifest', async (req, res) => {
  const { id } = parse(IdParam, req.params);
  ok(res, await manifest(auth(req), id));
});

sharedTripRoutes.post('/:id/status', async (req, res) => {
  const { id } = parse(IdParam, req.params);
  const { action } = parse(z.object({ action: z.enum(['BOARDING', 'START', 'COMPLETE']) }), req.body);
  await updateTripStatus(auth(req), id, action, req);
  ok(res, { updated: true });
});

sharedTripRoutes.post('/:id/bookings/:bookingId/:action', async (req, res) => {
  const { id } = parse(IdParam, req.params);
  const params = parse(z.object({ bookingId: z.string().max(40), action: z.enum(['board', 'drop', 'no-show']) }), req.params);
  const { pin } = parse(z.object({ pin: z.string().regex(/^\d{4}$/).optional() }), req.body ?? {});
  const action = ({ board: 'BOARD', drop: 'DROP', 'no-show': 'NO_SHOW' } as const)[params.action];
  await passengerAction(auth(req), id, params.bookingId, action, pin);
  ok(res, { updated: true });
});

sharedTripRoutes.post('/:id/events', async (req, res) => {
  const { id } = parse(IdParam, req.params);
  const body = parse(z.object({ type: z.enum(['ROUTE_DEVIATION', 'DELAY', 'BREAKDOWN']), note: z.string().trim().min(3).max(1000), lat: Lat.optional(), lng: Lng.optional() }), req.body);
  created(res, await recordTripEvent(auth(req), id, body));
});

// ─────────── Community admin ───────────

sharedTripRoutes.get('/community/:communityId', async (req, res) => {
  const ctx = auth(req);
  const allowed = communitiesWithPermission(ctx, 'community.bookings.view');
  if (allowed && !allowed.includes(param(req, 'communityId'))) throw forbidden();
  await ensureTripInstances();
  const trips = await prisma.sharedTripInstance.findMany({
    where: { communityId: param(req, 'communityId'), departureAt: { gt: new Date(Date.now() - 12 * 3_600_000) } },
    include: { route: { select: { code: true, name: true } }, driver: { select: { id: true, user: { select: { name: true } } } }, vehicle: { select: { registrationNumber: true } } },
    orderBy: { departureAt: 'asc' },
    take: 100,
  });
  ok(res, trips);
});

sharedTripRoutes.post('/:id/assign', async (req, res) => {
  const { id } = parse(IdParam, req.params);
  const { driverId } = parse(z.object({ driverId: z.string().max(40) }), req.body);
  ok(res, await assignDriver(auth(req), id, driverId, 'ADMIN', req));
});

sharedTripRoutes.post('/:id/cancel', async (req, res) => {
  const { id } = parse(IdParam, req.params);
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
  ok(res, await cancelDeparture(auth(req), id, reason, req));
});
