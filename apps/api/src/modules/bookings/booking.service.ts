import type { Booking, BookingStatus, PaymentMethod } from '@prisma/client';
import type { Request } from 'express';
import { prisma, withTransaction, type Tx } from '../../db.js';
import { logger } from '../../config/logger.js';
import { emitToCommunity, emitToUser } from '../../sockets/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../utils/errors.js';
import { haversineMeters } from '../../utils/geo.js';
import { pin4, reference, randomToken } from '../../utils/ids.js';
import { addMinutes } from '../../utils/time.js';
import { audit } from '../audit/audit.service.js';
import { isSuperAdmin, hasCommunityPermission, type AuthContext } from '../auth/auth-context.js';
import { getEligibility } from '../drivers/driver.service.js';
import { calculateWaitingCharge } from '../fares/fare-engine.js';
import { getPolicy } from '../fares/governance.service.js';
import { communityAdminUserIds, notify, superAdminUserIds } from '../notifications/notification.service.js';
import { recordFeeSplit, refundPayment } from '../payments/payment.service.js';
import { onlineProvider } from '../payments/providers.js';
import { cancellationFee } from './cancellation.js';
import { ACTIVE_REGULAR_STATUSES, assertTransition, type Actor } from './state-machine.js';

export const OFFER_BATCH_SIZE = 3;
export const MAX_DISPATCH_RADIUS_M = 6_000;
export const LOCATION_FRESHNESS_MS = 5 * 60_000;
export const NO_SHOW_WAIT_SECONDS = 5 * 60;

export async function recordStatus(
  tx: Tx,
  booking: Pick<Booking, 'id' | 'status'>,
  to: BookingStatus,
  actorType: Actor,
  actorId: string | null,
  reason?: string,
) {
  await tx.bookingStatusHistory.create({
    data: { bookingId: booking.id, fromStatus: booking.status, toStatus: to, actorType, actorId, reason },
  });
}

/**
 * Optimistic, conditional state change: succeeds only if the booking is still in `from`.
 * Concurrent actors (two drivers accepting, a passenger cancelling while a driver accepts)
 * cannot both win — the loser gets a 409.
 */
async function transition(
  tx: Tx,
  booking: Booking,
  to: BookingStatus,
  actor: Actor,
  actorId: string | null,
  data: Partial<Omit<Booking, 'id'>> = {},
  reason?: string,
) {
  assertTransition(booking.type, booking.status, to, actor);
  const result = await tx.booking.updateMany({
    where: { id: booking.id, status: booking.status, version: booking.version },
    data: { ...data, status: to, version: { increment: 1 } },
  });
  if (result.count === 0) throw conflict('This booking was updated by someone else. Refresh and try again.', 'STALE_BOOKING');
  await recordStatus(tx, booking, to, actor, actorId, reason);
}

function pushBookingUpdate(b: Pick<Booking, 'id' | 'passengerId' | 'communityId' | 'status'>, driverUserId?: string | null) {
  const payload = { bookingId: b.id, status: b.status };
  emitToUser(b.passengerId, 'booking:updated', payload);
  if (driverUserId) emitToUser(driverUserId, 'booking:updated', payload);
  emitToCommunity(b.communityId, 'booking:updated', payload);
}

// ───────────────────────────── Creation ─────────────────────────────

export interface CreateRegularBookingInput {
  quoteId: string;
  idempotencyKey: string;
  pickupAddress?: string;
  dropAddress?: string;
  paymentMethod: PaymentMethod;
}

export async function createRegularBooking(ctx: AuthContext, input: CreateRegularBookingInput, req?: Request) {
  // Idempotency: a retried request with the same key returns the original booking.
  const existing = await prisma.booking.findUnique({
    where: { passengerId_idempotencyKey: { passengerId: ctx.userId, idempotencyKey: input.idempotencyKey } },
  });
  if (existing) return { booking: existing, replayed: true };

  if (input.paymentMethod === 'ONLINE') throw unprocessable('Online payment provider is not configured', 'PAYMENT_METHOD_UNAVAILABLE');
  if (input.paymentMethod === 'MOCK_ONLINE' && onlineProvider()?.name !== 'mock') {
    throw unprocessable('Mock payments are only available in development', 'PAYMENT_METHOD_UNAVAILABLE');
  }

  const booking = await withTransaction(async (tx) => {
    const quote = await tx.fareQuote.findUnique({ where: { id: input.quoteId } });
    if (!quote || quote.passengerId !== ctx.userId || quote.serviceType !== 'REGULAR') throw notFound('Quote');
    if (quote.usedAt) throw conflict('This quote has already been used', 'QUOTE_USED');
    if (quote.expiresAt < new Date()) throw unprocessable('This fare quote has expired. Please get a new quote.', 'QUOTE_EXPIRED');

    const active = await tx.booking.findFirst({
      where: { passengerId: ctx.userId, type: 'REGULAR', status: { in: ACTIVE_REGULAR_STATUSES } },
      select: { reference: true },
    });
    if (active) throw conflict(`You already have an active booking (${active.reference})`, 'ACTIVE_BOOKING_EXISTS');

    // Mark the quote used atomically — a concurrent second request fails here.
    const used = await tx.fareQuote.updateMany({ where: { id: quote.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count === 0) throw conflict('This quote has already been used', 'QUOTE_USED');

    const policy = await getPolicy(quote.communityId, tx);
    const b = await tx.booking.create({
      data: {
        reference: reference('RO'),
        type: 'REGULAR',
        passengerId: ctx.userId,
        communityId: quote.communityId,
        fareRuleId: quote.fareRuleId,
        quoteId: quote.id,
        idempotencyKey: input.idempotencyKey,
        pickupLat: quote.pickupLat,
        pickupLng: quote.pickupLng,
        pickupAddress: input.pickupAddress,
        dropLat: quote.dropLat,
        dropLng: quote.dropLng,
        dropAddress: input.dropAddress,
        distanceMeters: quote.distanceMeters,
        durationSeconds: quote.durationSeconds,
        quotedFarePaise: quote.farePaise,
        paymentMethod: input.paymentMethod,
        startPin: pin4(),
        requestExpiresAt: new Date(Date.now() + policy.bookingRequestTimeoutSec * 1000),
      },
    });
    await recordStatus(tx, { id: b.id, status: 'REQUESTED' }, 'REQUESTED', 'PASSENGER', ctx.userId, 'Booking created');
    await audit({ action: 'booking.created', entityType: 'Booking', entityId: b.id, communityId: b.communityId, after: { reference: b.reference, farePaise: b.quotedFarePaise } }, { ctx, req }, tx);
    return b;
  }).catch(async (err) => {
    // Lost an idempotency race: return the winner's booking.
    if ((err as { code?: string }).code === 'P2002') {
      const winner = await prisma.booking.findUnique({ where: { passengerId_idempotencyKey: { passengerId: ctx.userId, idempotencyKey: input.idempotencyKey } } });
      if (winner) return winner;
    }
    throw err;
  });

  await dispatchNextRound(booking.id);
  const fresh = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
  return { booking: fresh, replayed: false };
}

// ───────────────────────────── Dispatch ─────────────────────────────

/**
 * Offer the booking to the next batch of nearest eligible drivers. Drivers queued at a
 * nearby auto stand are offered first, in queue order (first come, first served).
 * If nobody is eligible and no offers are outstanding, the booking ends as NO_DRIVER_AVAILABLE.
 */
export async function dispatchNextRound(bookingId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.status !== 'REQUESTED' || booking.type !== 'REGULAR') return;

  const outstanding = await prisma.bookingAssignment.count({ where: { bookingId, status: 'OFFERED', expiresAt: { gt: new Date() } } });
  if (outstanding > 0) return;

  const alreadyOffered = (await prisma.bookingAssignment.findMany({ where: { bookingId }, select: { driverId: true } })).map((a) => a.driverId);
  const candidates = await prisma.driverAvailability.findMany({
    where: {
      communityId: booking.communityId,
      status: 'ONLINE',
      driverId: { notIn: alreadyOffered },
      driver: {
        status: 'ACTIVE',
        verificationStatus: 'VERIFIED',
        memberships: { some: { communityId: booking.communityId, status: 'APPROVED' } },
        location: { updatedAt: { gt: new Date(Date.now() - LOCATION_FRESHNESS_MS) } },
      },
    },
    include: { driver: { include: { location: true, user: { select: { id: true } } } }, stand: true },
  });
  const pickup = { lat: booking.pickupLat, lng: booking.pickupLng };
  const ranked = candidates
    .map((c) => ({
      c,
      distance: haversineMeters(pickup, c.driver.location!),
      standDistance: c.stand ? haversineMeters(pickup, c.stand) : Infinity,
    }))
    .filter((x) => x.distance <= MAX_DISPATCH_RADIUS_M)
    .sort((a, b) => {
      const aStand = a.standDistance <= 500 ? 0 : 1;
      const bStand = b.standDistance <= 500 ? 0 : 1;
      if (aStand !== bStand) return aStand - bStand;
      if (aStand === 0) return (a.c.queuedAt?.getTime() ?? 0) - (b.c.queuedAt?.getTime() ?? 0);
      return a.distance - b.distance;
    })
    .slice(0, OFFER_BATCH_SIZE);

  if (ranked.length === 0) {
    await withTransaction(async (tx) => {
      const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
      if (b.status !== 'REQUESTED') return;
      await transition(tx, b, 'NO_DRIVER_AVAILABLE', 'SYSTEM', null, {}, 'No eligible driver accepted the request');
    }).catch((err) => logger.warn({ err, bookingId }, 'Could not mark booking NO_DRIVER_AVAILABLE'));
    const fresh = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (fresh?.status === 'NO_DRIVER_AVAILABLE') {
      pushBookingUpdate(fresh);
      await notify(fresh.passengerId, { type: 'NO_DRIVER', title: 'No auto available', body: `Sorry — no driver is available for ${fresh.reference} right now. Please try again.`, link: `/app/bookings/${fresh.id}` });
    }
    return;
  }

  const policy = await getPolicy(booking.communityId);
  const expiresAt = new Date(Date.now() + policy.driverOfferTimeoutSec * 1000);
  const round = booking.offerRound + 1;
  await prisma.$transaction([
    prisma.bookingAssignment.createMany({
      data: ranked.map((r) => ({ bookingId, driverId: r.c.driverId, round, expiresAt, distanceMeters: Math.round(r.distance) })),
      skipDuplicates: true,
    }),
    prisma.booking.update({ where: { id: bookingId }, data: { offerRound: round } }),
  ]);
  for (const r of ranked) {
    emitToUser(r.c.driver.user.id, 'offer:new', { bookingId, expiresAt });
  }
}

/** Driver accepts an offer. Exactly one driver can win, and only if still eligible and free. */
export async function acceptOffer(ctx: AuthContext, bookingId: string, req?: Request) {
  const driverId = ctx.driverId;
  if (!driverId) throw forbidden('Driver profile required');
  const booking = await withTransaction(async (tx) => {
    const offer = await tx.bookingAssignment.findUnique({ where: { bookingId_driverId: { bookingId, driverId } } });
    if (!offer || offer.status !== 'OFFERED') throw notFound('Offer');
    if (offer.expiresAt < new Date()) throw conflict('This offer has expired', 'OFFER_EXPIRED');
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (b.status !== 'REQUESTED') throw conflict('This booking is no longer available', 'BOOKING_TAKEN');

    const eligibility = await getEligibility(driverId, b.communityId, tx);
    if (!eligibility.eligible || !eligibility.vehicle) throw unprocessable('You are not eligible to accept trips right now', 'NOT_ELIGIBLE', eligibility.reasons);

    // Claim the driver: ONLINE → ON_TRIP. Fails if they already took another trip.
    const claimed = await tx.driverAvailability.updateMany({ where: { driverId, status: 'ONLINE' }, data: { status: 'ON_TRIP', standId: null, queuedAt: null } });
    if (claimed.count === 0) throw conflict('You must be online and free to accept a trip', 'DRIVER_BUSY');

    await transition(tx, b, 'ACCEPTED', 'DRIVER', ctx.userId, { driverId, vehicleId: eligibility.vehicle.id, acceptedAt: new Date() });
    await tx.bookingAssignment.update({ where: { id: offer.id }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
    await tx.bookingAssignment.updateMany({ where: { bookingId, status: 'OFFERED', id: { not: offer.id } }, data: { status: 'WITHDRAWN', respondedAt: new Date() } });
    await audit({ action: 'booking.accepted', entityType: 'Booking', entityId: b.id, communityId: b.communityId }, { ctx, req }, tx);
    return tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
  });
  pushBookingUpdate(booking, ctx.userId);
  await notify(booking.passengerId, { type: 'DRIVER_ASSIGNED', title: 'Driver assigned', body: `Your auto for ${booking.reference} is on the way.`, link: `/app/bookings/${booking.id}` });
  return booking;
}

export async function rejectOffer(ctx: AuthContext, bookingId: string) {
  if (!ctx.driverId) throw forbidden('Driver profile required');
  const updated = await prisma.bookingAssignment.updateMany({
    where: { bookingId, driverId: ctx.driverId, status: 'OFFERED' },
    data: { status: 'REJECTED', respondedAt: new Date() },
  });
  if (updated.count === 0) throw notFound('Offer');
  await dispatchNextRound(bookingId);
}

// ───────────────────────────── Trip progress (driver) ─────────────────────────────

async function loadDriverBooking(ctx: AuthContext, bookingId: string, tx: Tx) {
  const b = await tx.booking.findUnique({ where: { id: bookingId } });
  if (!b) throw notFound('Booking');
  if (!ctx.driverId || b.driverId !== ctx.driverId) throw forbidden('This trip is not assigned to you');
  return b;
}

export async function markArrived(ctx: AuthContext, bookingId: string) {
  const b = await withTransaction(async (tx) => {
    const booking = await loadDriverBooking(ctx, bookingId, tx);
    await transition(tx, booking, 'ARRIVING', 'DRIVER', ctx.userId, { arrivedAt: new Date() });
    return { ...booking, status: 'ARRIVING' as const };
  });
  pushBookingUpdate(b, ctx.userId);
  await notify(b.passengerId, { type: 'DRIVER_ARRIVED', title: 'Your auto has arrived', body: `Share your start PIN with the driver to begin ${b.reference}.`, link: `/app/bookings/${b.id}` });
}

/** Start requires the passenger's 4-digit PIN, so a trip can't be started without them present. */
export async function startTrip(ctx: AuthContext, bookingId: string, pin: string) {
  const b = await withTransaction(async (tx) => {
    const booking = await loadDriverBooking(ctx, bookingId, tx);
    if (booking.status === 'ARRIVING' && booking.startPin !== pin) throw unprocessable('Incorrect start PIN', 'INVALID_PIN');
    const rule = await tx.fareRule.findUniqueOrThrow({ where: { id: booking.fareRuleId } });
    const waited = booking.arrivedAt ? (Date.now() - booking.arrivedAt.getTime()) / 1000 : 0;
    const waitingChargePaise = calculateWaitingCharge(rule, waited);
    await transition(tx, booking, 'IN_PROGRESS', 'DRIVER', ctx.userId, { startedAt: new Date(), waitingChargePaise });
    return { ...booking, status: 'IN_PROGRESS' as const };
  });
  pushBookingUpdate(b, ctx.userId);
}

export async function completeTrip(ctx: AuthContext, bookingId: string) {
  const b = await withTransaction(async (tx) => {
    const booking = await loadDriverBooking(ctx, bookingId, tx);
    if (booking.type !== 'REGULAR') throw unprocessable('Use the shared trip manifest to complete shared bookings');
    // Final fare = the fare the passenger accepted + waiting charges under the published rule.
    const finalFarePaise = booking.quotedFarePaise + booking.waitingChargePaise;
    await transition(tx, booking, 'COMPLETED', 'DRIVER', ctx.userId, { completedAt: new Date(), finalFarePaise, paymentStatus: 'PAYMENT_PENDING' });
    const split = await recordFeeSplit(tx, booking, finalFarePaise);
    await tx.booking.update({
      where: { id: booking.id },
      data: { platformFeePaise: split.platformFeePaise, communityFeePaise: split.communityFeePaise, driverEarningsPaise: split.driverNetPaise },
    });
    await tx.driverAvailability.updateMany({ where: { driverId: booking.driverId!, status: 'ON_TRIP' }, data: { status: 'ONLINE' } });
    await audit({ action: 'booking.completed', entityType: 'Booking', entityId: booking.id, communityId: booking.communityId, after: { finalFarePaise, ...split } }, { ctx }, tx);
    return { ...booking, status: 'COMPLETED' as const, finalFarePaise };
  });
  pushBookingUpdate(b, ctx.userId);
  await notify(b.passengerId, { type: 'TRIP_COMPLETED', title: 'Trip completed', body: `Fare for ${b.reference}: ₹${(b.finalFarePaise / 100).toFixed(0)}. Please rate your driver.`, link: `/app/bookings/${b.id}` });
}

export async function markNoShow(ctx: AuthContext, bookingId: string) {
  const b = await withTransaction(async (tx) => {
    const booking = await loadDriverBooking(ctx, bookingId, tx);
    if (booking.type !== 'REGULAR') throw unprocessable('Use the shared trip manifest for shared bookings');
    const waited = booking.arrivedAt ? (Date.now() - booking.arrivedAt.getTime()) / 1000 : 0;
    if (waited < NO_SHOW_WAIT_SECONDS) throw unprocessable(`Wait at least ${NO_SHOW_WAIT_SECONDS / 60} minutes after arriving before marking a no-show`, 'TOO_EARLY');
    const policy = await getPolicy(booking.communityId, tx);
    await transition(tx, booking, 'NO_SHOW', 'DRIVER', ctx.userId, { cancellationFeePaise: Math.min(policy.cancellationFeePaise, booking.quotedFarePaise), cancelledAt: new Date() }, 'Passenger did not arrive');
    await tx.driverAvailability.updateMany({ where: { driverId: booking.driverId!, status: 'ON_TRIP' }, data: { status: 'ONLINE' } });
    return { ...booking, status: 'NO_SHOW' as const };
  });
  pushBookingUpdate(b, ctx.userId);
  await notify(b.passengerId, { type: 'NO_SHOW', title: 'Marked as no-show', body: `The driver waited for ${b.reference} but could not find you.`, link: `/app/bookings/${b.id}` });
}

// ───────────────────────────── Cancellation (both booking types) ─────────────────────────────

export async function cancelBooking(ctx: AuthContext, bookingId: string, reason: string, req?: Request) {
  const result = await withTransaction(async (tx) => {
    const b = await tx.booking.findUnique({ where: { id: bookingId }, include: { tripInstance: { include: { route: true } }, driver: { select: { userId: true } } } });
    if (!b) throw notFound('Booking');
    let actor: Actor;
    if (b.passengerId === ctx.userId) actor = 'PASSENGER';
    else if (ctx.driverId && b.driverId === ctx.driverId && b.type === 'REGULAR') actor = 'DRIVER';
    else if (isSuperAdmin(ctx) || hasCommunityPermission(ctx, b.communityId, 'community.complaints.manage')) actor = 'ADMIN';
    else throw forbidden();

    const policy = await getPolicy(b.communityId, tx);
    const fee = cancellationFee(
      {
        type: b.type,
        status: b.status,
        actor,
        now: new Date(),
        fareP: b.quotedFarePaise,
        acceptedAt: b.acceptedAt,
        departureAt: b.tripInstance?.departureAt,
        sharedCancellationCutoffMinutes: b.tripInstance?.route.cancellationCutoffMinutes,
      },
      policy,
    );
    await transition(tx, b, 'CANCELLED', actor, ctx.userId, { cancelledAt: new Date(), cancelledById: ctx.userId, cancelReason: reason, cancellationFeePaise: fee.feePaise }, reason);
    await tx.bookingAssignment.updateMany({ where: { bookingId, status: 'OFFERED' }, data: { status: 'WITHDRAWN', respondedAt: new Date() } });
    if (b.driverId && b.type === 'REGULAR') {
      await tx.driverAvailability.updateMany({ where: { driverId: b.driverId, status: 'ON_TRIP' }, data: { status: 'ONLINE' } });
    }
    if (b.type === 'SHARED') await releaseSeats(tx, b.id, 'CANCELLED');

    // Prepaid online bookings are refunded automatically, minus any published cancellation fee.
    const paid = await tx.payment.findFirst({ where: { bookingId, status: 'SUCCEEDED', method: { not: 'CASH' } } });
    if (paid && paid.amountPaise - fee.feePaise > 0) {
      await refundPayment(paid.id, paid.amountPaise - fee.feePaise, `Cancellation: ${fee.reason}`, ctx.userId, tx);
    }
    await audit({ action: 'booking.cancelled', entityType: 'Booking', entityId: b.id, communityId: b.communityId, before: { status: b.status }, after: { actor, reason, feePaise: fee.feePaise } }, { ctx, req }, tx);
    return { booking: b, actor, fee };
  });

  const { booking: b, actor, fee } = result;
  pushBookingUpdate({ ...b, status: 'CANCELLED' }, b.driver?.userId);
  if (actor !== 'PASSENGER') {
    await notify(b.passengerId, { type: 'BOOKING_CANCELLED', title: 'Booking cancelled', body: `${b.reference} was cancelled: ${reason}`, link: `/app/bookings/${b.id}` });
  }
  if (b.driver && actor !== 'DRIVER') {
    await notify(b.driver.userId, { type: 'BOOKING_CANCELLED', title: 'Trip cancelled', body: `${b.reference} was cancelled by the ${actor.toLowerCase()}.`, link: '/driver' });
  }
  return { cancellationFeePaise: fee.feePaise, feeReason: fee.reason };
}

/** Release a booking's seats back to inventory. Must run inside the caller's transaction. */
export async function releaseSeats(tx: Tx, bookingId: string, status: 'CANCELLED' | 'EXPIRED' | 'NO_SHOW') {
  const seats = await tx.seatReservation.findMany({ where: { bookingId, status: { in: ['HELD', 'CONFIRMED'] } } });
  if (seats.length === 0) return 0;
  const tripId = seats[0]!.tripInstanceId;
  await tx.$queryRaw`SELECT id FROM shared_trip_instances WHERE id = ${tripId} FOR UPDATE`;
  await tx.seatReservation.updateMany({ where: { id: { in: seats.map((s) => s.id) } }, data: { status, activeSeatKey: null } });
  await tx.sharedTripInstance.update({ where: { id: tripId }, data: { seatsBooked: { decrement: seats.length } } });
  return seats.length;
}

// ───────────────────────────── Safety ─────────────────────────────

export async function createShareLink(ctx: AuthContext, bookingId: string) {
  const b = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!b) throw notFound('Booking');
  if (b.passengerId !== ctx.userId) throw forbidden();
  if (['COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_DRIVER_AVAILABLE', 'NO_SHOW'].includes(b.status)) {
    throw unprocessable('Only active trips can be shared', 'TRIP_NOT_ACTIVE');
  }
  const shareToken = b.shareToken && b.shareExpiresAt && b.shareExpiresAt > new Date() ? b.shareToken : randomToken(24);
  const shareExpiresAt = addMinutes(new Date(), 12 * 60);
  await prisma.booking.update({ where: { id: bookingId }, data: { shareToken, shareExpiresAt } });
  await prisma.tripEvent.create({ data: { bookingId, type: 'TRIP_SHARED', actorId: ctx.userId } });
  return { shareToken, shareExpiresAt, path: `/track/${shareToken}` };
}

/** SOS: records the event, opens an urgent safety ticket and alerts platform and community staff. */
export async function raiseSos(ctx: AuthContext, bookingId: string, input: { lat?: number; lng?: number; note?: string }) {
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, include: { driver: { select: { userId: true } } } });
  if (!b) throw notFound('Booking');
  const isParty = b.passengerId === ctx.userId || (ctx.driverId && b.driverId === ctx.driverId);
  if (!isParty) throw forbidden();
  const [event, ticket] = await prisma.$transaction([
    prisma.tripEvent.create({ data: { bookingId, type: 'SOS', note: input.note, lat: input.lat, lng: input.lng, actorId: ctx.userId } }),
    prisma.supportTicket.create({
      data: {
        reference: reference('SOS', 6),
        kind: 'SAFETY',
        priority: 'URGENT',
        userId: ctx.userId,
        communityId: b.communityId,
        bookingId,
        subject: `SOS on booking ${b.reference}`,
        description: input.note ?? 'Emergency assistance requested from the app.',
      },
    }),
  ]);
  const staff = [...(await superAdminUserIds()), ...(await communityAdminUserIds(b.communityId))];
  await notify(staff, { type: 'SOS', title: `SOS: ${b.reference}`, body: input.note ?? 'Emergency assistance requested', link: `/admin/support` });
  await audit({ action: 'safety.sos_raised', entityType: 'Booking', entityId: bookingId, communityId: b.communityId, after: { ticket: ticket.reference } }, { ctx });
  return { eventId: event.id, ticketReference: ticket.reference, emergencyNumber: '112' };
}
