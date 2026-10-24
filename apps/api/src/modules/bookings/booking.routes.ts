import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { auth, authenticate, requirePermission } from '../../middleware/auth.js';
import { forbidden, notFound } from '../../utils/errors.js';
import { IdParam, created, ok, pageMeta, pagination, parse } from '../../utils/http.js';
import { hasCommunityPermission, isSuperAdmin, type AuthContext } from '../auth/auth-context.js';
import { publicDriverView } from '../drivers/driver.service.js';
import { Lat, Lng } from '../geo/geo.routes.js';
import {
  acceptOffer,
  cancelBooking,
  completeTrip,
  createRegularBooking,
  createShareLink,
  markArrived,
  markNoShow,
  raiseSos,
  rejectOffer,
  startTrip,
} from './booking.service.js';
import { confirmHold } from '../shared-trips/shared-trip.service.js';

export const bookingRoutes = Router();
bookingRoutes.use(authenticate);

const IdempotencyKey = z.string().trim().min(8).max(64).regex(/^[\w-]+$/);

bookingRoutes.post('/', requirePermission('booking.create'), async (req, res) => {
  const body = parse(
    z.object({
      quoteId: z.string().max(40),
      idempotencyKey: IdempotencyKey,
      pickupAddress: z.string().trim().max(300).optional(),
      dropAddress: z.string().trim().max(300).optional(),
      paymentMethod: z.enum(['CASH', 'MOCK_ONLINE', 'ONLINE']).default('CASH'),
    }),
    req.body,
  );
  const { booking, replayed } = await createRegularBooking(auth(req), body, req);
  return replayed ? ok(res, booking, { replayed: true }) : created(res, booking);
});

bookingRoutes.get('/', async (req, res) => {
  const ctx = auth(req);
  const { page, pageSize, skip, take } = pagination(req);
  const where = { passengerId: ctx.userId };
  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: {
        id: true, reference: true, type: true, status: true, paymentStatus: true, paymentMethod: true, seatCount: true,
        pickupAddress: true, dropAddress: true, quotedFarePaise: true, finalFarePaise: true, createdAt: true,
        tripInstance: { select: { departureAt: true, route: { select: { code: true, name: true } } } },
        community: { select: { name: true } },
      },
    }),
    prisma.booking.count({ where }),
  ]);
  ok(res, items, pageMeta(page, pageSize, total));
});

function viewerRole(ctx: AuthContext, b: { passengerId: string; driverId: string | null; communityId: string }) {
  if (b.passengerId === ctx.userId) return 'PASSENGER' as const;
  if (ctx.driverId && b.driverId === ctx.driverId) return 'DRIVER' as const;
  if (isSuperAdmin(ctx) || hasCommunityPermission(ctx, b.communityId, 'community.bookings.view')) return 'ADMIN' as const;
  return null;
}

/** Object-level authorisation: the passenger, the assigned driver, or authorised staff only. */
bookingRoutes.get('/:id', async (req, res) => {
  const ctx = auth(req);
  const { id } = parse(IdParam, req.params);
  const b = await prisma.booking.findUnique({
    where: { id },
    include: {
      community: { select: { id: true, name: true, contactPhone: true } },
      driver: { select: { id: true, ratingSum: true, ratingCount: true, user: { select: { name: true } } } },
      vehicle: { select: { registrationNumber: true, make: true, model: true, color: true } },
      statusHistory: { orderBy: { createdAt: 'asc' }, select: { fromStatus: true, toStatus: true, actorType: true, reason: true, createdAt: true } },
      seats: { select: { seatNumber: true, status: true } },
      tripInstance: { select: { id: true, departureAt: true, status: true, route: { select: { code: true, name: true, cancellationCutoffMinutes: true } } } },
      pickupStop: { select: { sequence: true, pickupPoint: { select: { name: true, lat: true, lng: true } } } },
      dropStop: { select: { sequence: true, pickupPoint: { select: { name: true, lat: true, lng: true } } } },
      payments: { select: { id: true, amountPaise: true, method: true, provider: true, status: true, createdAt: true, refunds: { select: { amountPaise: true, status: true, reason: true } } } },
      rating: { select: { raterId: true, score: true, comment: true } },
      fareRule: { select: { version: true, effectiveFrom: true } },
    },
  });
  if (!b) throw notFound('Booking');
  const role = viewerRole(ctx, b);
  if (!role) throw forbidden();
  const quote = await prisma.fareQuote.findUnique({ where: { id: b.quoteId }, select: { breakdown: true, distanceSource: true } });
  ok(res, {
    ...b,
    viewerRole: role,
    // The start PIN is shown only to the passenger who must share it in person.
    startPin: role === 'PASSENGER' ? b.startPin : undefined,
    shareToken: role === 'PASSENGER' ? b.shareToken : undefined,
    driver: b.driver ? publicDriverView(b.driver) : null,
    fareBreakdown: quote?.breakdown ?? null,
    distanceSource: quote?.distanceSource ?? null,
  });
});

/** Assigned driver's last location — only to the passenger, only while the trip is active. */
bookingRoutes.get('/:id/driver-location', async (req, res) => {
  const ctx = auth(req);
  const { id } = parse(IdParam, req.params);
  const b = await prisma.booking.findUnique({ where: { id }, select: { passengerId: true, driverId: true, status: true } });
  if (!b || b.passengerId !== ctx.userId) throw notFound('Booking');
  if (!b.driverId || !['ACCEPTED', 'ARRIVING', 'IN_PROGRESS'].includes(b.status)) return ok(res, null);
  ok(res, await prisma.driverLocation.findUnique({ where: { driverId: b.driverId }, select: { lat: true, lng: true, heading: true, updatedAt: true } }));
});

bookingRoutes.post('/:id/cancel', async (req, res) => {
  const { id } = parse(IdParam, req.params);
  const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
  ok(res, await cancelBooking(auth(req), id, reason, req));
});

bookingRoutes.post('/:id/confirm', async (req, res) => {
  const { id } = parse(IdParam, req.params);
  ok(res, await confirmHold(auth(req), id));
});

// Driver actions on regular trips
bookingRoutes.post('/:id/accept', async (req, res) => {
  const { id } = parse(IdParam, req.params);
  ok(res, await acceptOffer(auth(req), id, req));
});

bookingRoutes.post('/:id/reject', async (req, res) => {
  const { id } = parse(IdParam, req.params);
  await rejectOffer(auth(req), id);
  ok(res, { rejected: true });
});

bookingRoutes.post('/:id/arrived', async (req, res) => {
  const { id } = parse(IdParam, req.params);
  await markArrived(auth(req), id);
  ok(res, { status: 'ARRIVING' });
});

bookingRoutes.post('/:id/start', async (req, res) => {
  const { id } = parse(IdParam, req.params);
  const { pin } = parse(z.object({ pin: z.string().regex(/^\d{4}$/, 'Enter the 4-digit PIN') }), req.body);
  await startTrip(auth(req), id, pin);
  ok(res, { status: 'IN_PROGRESS' });
});

bookingRoutes.post('/:id/complete', async (req, res) => {
  const { id } = parse(IdParam, req.params);
  await completeTrip(auth(req), id);
  ok(res, { status: 'COMPLETED' });
});

bookingRoutes.post('/:id/no-show', async (req, res) => {
  const { id } = parse(IdParam, req.params);
  await markNoShow(auth(req), id);
  ok(res, { status: 'NO_SHOW' });
});

// Safety
bookingRoutes.post('/:id/share', async (req, res) => {
  const { id } = parse(IdParam, req.params);
  ok(res, await createShareLink(auth(req), id));
});

bookingRoutes.post('/:id/sos', async (req, res) => {
  const { id } = parse(IdParam, req.params);
  const body = parse(z.object({ lat: Lat.optional(), lng: Lng.optional(), note: z.string().trim().max(1000).optional() }), req.body);
  created(res, await raiseSos(auth(req), id, body));
});
