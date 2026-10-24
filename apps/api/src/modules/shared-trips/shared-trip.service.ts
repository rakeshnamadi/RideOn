import type { PaymentMethod, Prisma } from '@prisma/client';
import type { Request } from 'express';
import { prisma, withTransaction, type Tx } from '../../db.js';
import { emitToCommunity, emitToUser } from '../../sockets/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../utils/errors.js';
import { pin4, reference } from '../../utils/ids.js';
import { addDays, addMinutes, DEFAULT_TIMEZONE, localParts, zonedTimeToUtc } from '../../utils/time.js';
import { audit } from '../audit/audit.service.js';
import { assertCommunityPermission, type AuthContext } from '../auth/auth-context.js';
import { getEligibility } from '../drivers/driver.service.js';
import { priceSharedSeats, QUOTE_TTL_MINUTES } from '../fares/fare.service.js';
import { getPolicy } from '../fares/governance.service.js';
import { notify } from '../notifications/notification.service.js';
import { recordFeeSplit, refundPayment } from '../payments/payment.service.js';
import { onlineProvider } from '../payments/providers.js';
import { recordStatus, releaseSeats } from '../bookings/booking.service.js';
import { assertTransition } from '../bookings/state-machine.js';

export const TRIP_GENERATION_DAYS = 3;
export const MAX_SEATS_PER_BOOKING = 4;

/**
 * Materialise departures for the next few days from active schedules. Idempotent:
 * (scheduleId, departureAt) is unique, so concurrent runs cannot create duplicates.
 */
export async function ensureTripInstances(opts: { routeId?: string; days?: number } = {}) {
  const days = opts.days ?? TRIP_GENERATION_DAYS;
  const schedules = await prisma.routeSchedule.findMany({
    where: { active: true, route: { status: 'ACTIVE', ...(opts.routeId ? { id: opts.routeId } : {}), community: { status: 'ACTIVE' } } },
    include: { route: { select: { id: true, communityId: true, community: { select: { city: { select: { timezone: true } } } } } } },
  });
  const now = new Date();
  const rows: Prisma.SharedTripInstanceCreateManyInput[] = [];
  for (const s of schedules) {
    const tz = s.route.community.city.timezone ?? DEFAULT_TIMEZONE;
    for (let d = 0; d < days; d++) {
      const day = localParts(addDays(now, d), tz);
      if (!(s.daysOfWeek & (1 << day.weekday))) continue;
      const departureAt = zonedTimeToUtc(day.year, day.month, day.day, s.departureTime, tz);
      if (departureAt <= now) continue;
      if (departureAt < s.validFrom || (s.validTo && departureAt > s.validTo)) continue;
      rows.push({ routeId: s.routeId, scheduleId: s.id, communityId: s.route.communityId, departureAt, capacity: s.seatCapacity });
    }
  }
  if (rows.length) await prisma.sharedTripInstance.createMany({ data: rows, skipDuplicates: true });
  return rows.length;
}

export async function searchDepartures(q: { communityId?: string; routeId?: string; fromPointId?: string; toPointId?: string; date?: string }) {
  await ensureTripInstances({ routeId: q.routeId });
  const now = new Date();
  let from = now;
  let to = addDays(now, TRIP_GENERATION_DAYS);
  if (q.date) {
    const [y, m, d] = q.date.split('-').map(Number) as [number, number, number];
    from = new Date(Math.max(now.getTime(), zonedTimeToUtc(y, m, d, '00:00').getTime()));
    to = zonedTimeToUtc(y, m, d, '23:59');
  }
  const trips = await prisma.sharedTripInstance.findMany({
    where: {
      status: 'SCHEDULED',
      departureAt: { gt: from, lte: to },
      ...(q.routeId ? { routeId: q.routeId } : {}),
      ...(q.communityId ? { communityId: q.communityId } : {}),
      route: { status: 'ACTIVE' },
    },
    include: {
      route: { include: { stops: { orderBy: { sequence: 'asc' }, include: { pickupPoint: { select: { id: true, name: true, lat: true, lng: true } } } } } },
      vehicle: { select: { registrationNumber: true } },
    },
    orderBy: { departureAt: 'asc' },
    take: 100,
  });
  return trips
    .filter((t) => {
      const cutoff = addMinutes(t.departureAt, -t.route.bookingCutoffMinutes);
      if (cutoff <= now) return false;
      if (!q.fromPointId && !q.toPointId) return true;
      const fromStop = t.route.stops.find((s) => s.pickupPointId === q.fromPointId);
      const toStop = t.route.stops.find((s) => s.pickupPointId === q.toPointId);
      if (q.fromPointId && !fromStop) return false;
      if (q.toPointId && !toStop) return false;
      return !fromStop || !toStop || toStop.sequence > fromStop.sequence;
    })
    .map((t) => ({
      id: t.id,
      departureAt: t.departureAt,
      capacity: t.capacity,
      seatsAvailable: t.capacity - t.seatsBooked,
      bookingClosesAt: addMinutes(t.departureAt, -t.route.bookingCutoffMinutes),
      vehicle: t.vehicle,
      route: { id: t.route.id, code: t.route.code, name: t.route.name, cancellationCutoffMinutes: t.route.cancellationCutoffMinutes, boardingRules: t.route.boardingRules, stops: t.route.stops },
    }));
}

export interface HoldInput {
  tripInstanceId: string;
  pickupStopId: string;
  dropStopId: string;
  seats: number;
  idempotencyKey: string;
  paymentMethod: PaymentMethod;
}

/**
 * Atomically hold seats on a departure. The trip-instance row is locked with
 * SELECT … FOR UPDATE, so concurrent requests serialise on availability; the unique
 * activeSeatKey index is a second, independent guarantee that no seat is sold twice.
 */
export async function holdSeats(ctx: AuthContext, input: HoldInput, req?: Request) {
  const existing = await prisma.booking.findUnique({ where: { passengerId_idempotencyKey: { passengerId: ctx.userId, idempotencyKey: input.idempotencyKey } } });
  if (existing) return { booking: existing, replayed: true };
  if (input.seats < 1 || input.seats > MAX_SEATS_PER_BOOKING) throw unprocessable(`Book between 1 and ${MAX_SEATS_PER_BOOKING} seats`, 'INVALID_SEATS');
  if (input.paymentMethod === 'ONLINE' || (input.paymentMethod === 'MOCK_ONLINE' && onlineProvider()?.name !== 'mock')) {
    throw unprocessable('This payment method is not available', 'PAYMENT_METHOD_UNAVAILABLE');
  }

  const booking = await withTransaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM shared_trip_instances WHERE id = ${input.tripInstanceId} FOR UPDATE`;
    if (locked.length === 0) throw notFound('Departure');
    const trip = await tx.sharedTripInstance.findUniqueOrThrow({ where: { id: input.tripInstanceId }, include: { route: true } });
    if (trip.status !== 'SCHEDULED' || trip.route.status !== 'ACTIVE') throw unprocessable('This departure is not open for booking', 'DEPARTURE_CLOSED');
    if (addMinutes(trip.departureAt, -trip.route.bookingCutoffMinutes) <= new Date()) throw unprocessable('Booking for this departure has closed', 'BOOKING_CUTOFF');

    const duplicate = await tx.booking.findFirst({ where: { passengerId: ctx.userId, tripInstanceId: trip.id, status: { in: ['REQUESTED', 'CONFIRMED'] } }, select: { reference: true } });
    if (duplicate) throw conflict(`You already have a reservation on this departure (${duplicate.reference})`, 'DUPLICATE_RESERVATION');

    const available = trip.capacity - trip.seatsBooked;
    if (available < input.seats) throw conflict(available === 0 ? 'This departure is full' : `Only ${available} seat(s) left`, 'INSUFFICIENT_SEATS');

    const { pickup, drop, rule, fare } = await priceSharedSeats(trip.routeId, input.pickupStopId, input.dropStopId, input.seats, tx);
    const policy = await getPolicy(trip.communityId, tx);
    const holdExpiresAt = addMinutes(new Date(), policy.seatHoldMinutes);

    const taken = new Set(
      (await tx.seatReservation.findMany({ where: { tripInstanceId: trip.id, activeSeatKey: { not: null } }, select: { seatNumber: true } })).map((s) => s.seatNumber),
    );
    const seatNumbers: number[] = [];
    for (let n = 1; n <= trip.capacity && seatNumbers.length < input.seats; n++) if (!taken.has(n)) seatNumbers.push(n);
    if (seatNumbers.length < input.seats) throw conflict('Not enough seats available', 'INSUFFICIENT_SEATS');

    const pickupPoint = await tx.pickupPoint.findUniqueOrThrow({ where: { id: pickup.pickupPointId } });
    const dropPoint = await tx.pickupPoint.findUniqueOrThrow({ where: { id: drop.pickupPointId } });
    const quote = await tx.fareQuote.create({
      data: {
        passengerId: ctx.userId,
        communityId: trip.communityId,
        serviceType: 'SHARED',
        fareRuleId: rule.id,
        pickupLat: pickupPoint.lat,
        pickupLng: pickupPoint.lng,
        dropLat: dropPoint.lat,
        dropLng: dropPoint.lng,
        distanceMeters: 0,
        durationSeconds: (drop.offsetMinutes - pickup.offsetMinutes) * 60,
        distanceSource: 'route',
        seatCount: input.seats,
        tripInstanceId: trip.id,
        pickupStopId: pickup.id,
        dropStopId: drop.id,
        farePaise: fare.totalPaise,
        breakdown: fare.lines as unknown as Prisma.InputJsonValue,
        expiresAt: addMinutes(new Date(), QUOTE_TTL_MINUTES),
        usedAt: new Date(),
      },
    });
    const b = await tx.booking.create({
      data: {
        reference: reference('RS'),
        type: 'SHARED',
        passengerId: ctx.userId,
        communityId: trip.communityId,
        fareRuleId: rule.id,
        quoteId: quote.id,
        idempotencyKey: input.idempotencyKey,
        pickupLat: pickupPoint.lat,
        pickupLng: pickupPoint.lng,
        pickupAddress: pickupPoint.name,
        dropLat: dropPoint.lat,
        dropLng: dropPoint.lng,
        dropAddress: dropPoint.name,
        tripInstanceId: trip.id,
        pickupStopId: pickup.id,
        dropStopId: drop.id,
        seatCount: input.seats,
        distanceMeters: 0,
        durationSeconds: quote.durationSeconds,
        quotedFarePaise: fare.totalPaise,
        paymentMethod: input.paymentMethod,
        startPin: pin4(),
        requestExpiresAt: holdExpiresAt,
        driverId: trip.driverId,
        vehicleId: trip.vehicleId,
      },
    });
    await tx.seatReservation.createMany({
      data: seatNumbers.map((seatNumber) => ({
        tripInstanceId: trip.id,
        bookingId: b.id,
        seatNumber,
        status: 'HELD' as const,
        holdExpiresAt,
        activeSeatKey: `${trip.id}:${seatNumber}`,
      })),
    });
    await tx.sharedTripInstance.update({ where: { id: trip.id }, data: { seatsBooked: { increment: input.seats } } });
    await recordStatus(tx, { id: b.id, status: 'REQUESTED' }, 'REQUESTED', 'PASSENGER', ctx.userId, `Held seats ${seatNumbers.join(', ')}`);
    await audit({ action: 'shared.seats_held', entityType: 'Booking', entityId: b.id, communityId: b.communityId, after: { reference: b.reference, seats: seatNumbers, farePaise: fare.totalPaise } }, { ctx, req }, tx);
    return b;
  }).catch(async (err) => {
    if ((err as { code?: string }).code === 'P2002') {
      const winner = await prisma.booking.findUnique({ where: { passengerId_idempotencyKey: { passengerId: ctx.userId, idempotencyKey: input.idempotencyKey } } });
      if (winner) return winner;
      throw conflict('That seat was just taken. Please try again.', 'SEAT_TAKEN');
    }
    throw err;
  });
  emitToCommunity(booking.communityId, 'trip:seats', { tripInstanceId: booking.tripInstanceId });
  return { booking, replayed: false };
}

/** Passenger confirms held seats before the hold expires. */
export async function confirmHold(ctx: AuthContext, bookingId: string) {
  const b = await withTransaction(async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: bookingId } });
    if (!booking || booking.passengerId !== ctx.userId) throw notFound('Booking');
    if (booking.type !== 'SHARED') throw unprocessable('Only shared bookings need confirmation');
    if (booking.status === 'CONFIRMED') return booking;
    assertTransition('SHARED', booking.status, 'CONFIRMED', 'PASSENGER');
    if (booking.requestExpiresAt && booking.requestExpiresAt < new Date()) throw unprocessable('Your seat hold has expired. Please book again.', 'HOLD_EXPIRED');
    const updated = await tx.booking.updateMany({ where: { id: booking.id, status: 'REQUESTED', version: booking.version }, data: { status: 'CONFIRMED', version: { increment: 1 } } });
    if (updated.count === 0) throw conflict('Booking changed. Refresh and try again.', 'STALE_BOOKING');
    await tx.seatReservation.updateMany({ where: { bookingId, status: 'HELD' }, data: { status: 'CONFIRMED', holdExpiresAt: null } });
    await recordStatus(tx, booking, 'CONFIRMED', 'PASSENGER', ctx.userId);
    return { ...booking, status: 'CONFIRMED' as const };
  });
  const trip = await prisma.sharedTripInstance.findUnique({ where: { id: b.tripInstanceId! }, include: { driver: { select: { userId: true } } } });
  if (trip?.driver) emitToUser(trip.driver.userId, 'trip:manifest', { tripInstanceId: trip.id });
  emitToUser(b.passengerId, 'booking:updated', { bookingId: b.id, status: 'CONFIRMED' });
  return b;
}

/** Release holds that were never confirmed. Run by the job scheduler. */
export async function expireSeatHolds() {
  const expired = await prisma.booking.findMany({
    where: { type: 'SHARED', status: 'REQUESTED', requestExpiresAt: { lt: new Date() } },
    select: { id: true },
    take: 200,
  });
  let count = 0;
  for (const { id } of expired) {
    await withTransaction(async (tx) => {
      const b = await tx.booking.findUnique({ where: { id } });
      if (!b || b.status !== 'REQUESTED') return;
      const updated = await tx.booking.updateMany({ where: { id, status: 'REQUESTED', version: b.version }, data: { status: 'EXPIRED', version: { increment: 1 } } });
      if (updated.count === 0) return;
      await releaseSeats(tx, id, 'EXPIRED');
      await recordStatus(tx, b, 'EXPIRED', 'SYSTEM', null, 'Seat hold expired');
      count++;
    });
  }
  return count;
}

// ───────────────────────────── Driver & admin operations ─────────────────────────────

async function assertTripDriver(ctx: AuthContext, tripId: string, tx: Tx = prisma as unknown as Tx) {
  const trip = await tx.sharedTripInstance.findUnique({ where: { id: tripId }, include: { route: true } });
  if (!trip) throw notFound('Departure');
  if (!ctx.driverId || trip.driverId !== ctx.driverId) throw forbidden('This departure is not assigned to you');
  return trip;
}

/** Assign a driver/vehicle to a departure (community admin), or claim one (eligible driver). */
export async function assignDriver(ctx: AuthContext, tripId: string, driverId: string, mode: 'ADMIN' | 'CLAIM', req?: Request) {
  const trip = await prisma.sharedTripInstance.findUnique({ where: { id: tripId } });
  if (!trip) throw notFound('Departure');
  if (mode === 'ADMIN') assertCommunityPermission(ctx, trip.communityId, 'community.queue.manage');
  else if (ctx.driverId !== driverId) throw forbidden();
  if (trip.status !== 'SCHEDULED') throw unprocessable('Only scheduled departures can be assigned');
  const eligibility = await getEligibility(driverId, trip.communityId);
  if (!eligibility.eligible || !eligibility.vehicle) throw unprocessable('Driver is not eligible for this community', 'NOT_ELIGIBLE', eligibility.reasons);
  // Seats sold can never exceed the permitted capacity of the vehicle that runs the trip.
  if (eligibility.vehicle.seatCapacity < trip.capacity) {
    throw unprocessable(`Vehicle capacity (${eligibility.vehicle.seatCapacity}) is below this departure's capacity (${trip.capacity})`, 'CAPACITY_MISMATCH');
  }
  const clash = await prisma.sharedTripInstance.findFirst({
    where: { driverId, id: { not: tripId }, status: { in: ['SCHEDULED', 'BOARDING', 'IN_PROGRESS'] }, departureAt: { gt: addMinutes(trip.departureAt, -60), lt: addMinutes(trip.departureAt, 60) } },
  });
  if (clash) throw conflict('Driver already has a departure within an hour of this one', 'SCHEDULE_CLASH');
  const updated = await prisma.sharedTripInstance.updateMany({
    where: { id: tripId, status: 'SCHEDULED', ...(mode === 'CLAIM' ? { driverId: null } : {}) },
    data: { driverId, vehicleId: eligibility.vehicle.id },
  });
  if (updated.count === 0) throw conflict('This departure has already been taken', 'ALREADY_ASSIGNED');
  await prisma.booking.updateMany({ where: { tripInstanceId: tripId }, data: { driverId, vehicleId: eligibility.vehicle.id } });
  await audit({ action: mode === 'ADMIN' ? 'shared.driver_assigned' : 'shared.driver_claimed', entityType: 'SharedTripInstance', entityId: tripId, communityId: trip.communityId, after: { driverId } }, { ctx, req });
  return { assigned: true };
}

export async function manifest(ctx: AuthContext, tripId: string) {
  const trip = await prisma.sharedTripInstance.findUnique({
    where: { id: tripId },
    include: {
      route: { include: { stops: { orderBy: { sequence: 'asc' }, include: { pickupPoint: { select: { name: true, lat: true, lng: true } } } } } },
      vehicle: { select: { registrationNumber: true, seatCapacity: true } },
      bookings: {
        where: { status: { in: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW'] } },
        select: {
          id: true,
          reference: true,
          status: true,
          seatCount: true,
          quotedFarePaise: true,
          paymentMethod: true,
          paymentStatus: true,
          pickupStop: { select: { sequence: true, pickupPoint: { select: { name: true } } } },
          dropStop: { select: { sequence: true, pickupPoint: { select: { name: true } } } },
          seats: { where: { status: { in: ['CONFIRMED', 'BOARDED', 'COMPLETED'] } }, select: { seatNumber: true, status: true } },
          passenger: { select: { name: true } },
        },
      },
    },
  });
  if (!trip) throw notFound('Departure');
  const isDriver = ctx.driverId && trip.driverId === ctx.driverId;
  if (!isDriver) assertCommunityPermission(ctx, trip.communityId, 'community.bookings.view');
  return {
    ...trip,
    // Drivers see first names only — never phone numbers.
    bookings: trip.bookings.map((b) => ({ ...b, passenger: { firstName: b.passenger.name.split(' ')[0] } })),
  };
}

export async function updateTripStatus(ctx: AuthContext, tripId: string, action: 'BOARDING' | 'START' | 'COMPLETE', req?: Request) {
  const result = await withTransaction(async (tx) => {
    const trip = await assertTripDriver(ctx, tripId, tx);
    const now = new Date();
    if (action === 'BOARDING') {
      if (trip.status !== 'SCHEDULED') throw conflict('Boarding can only open for a scheduled departure');
      if (trip.departureAt.getTime() - now.getTime() > 30 * 60_000) throw unprocessable('Boarding opens 30 minutes before departure', 'TOO_EARLY');
      await tx.sharedTripInstance.update({ where: { id: tripId }, data: { status: 'BOARDING' } });
    } else if (action === 'START') {
      if (!['SCHEDULED', 'BOARDING'].includes(trip.status)) throw conflict('This departure has already started or ended');
      await tx.sharedTripInstance.update({ where: { id: tripId }, data: { status: 'IN_PROGRESS', startedAt: now } });
    } else {
      if (trip.status !== 'IN_PROGRESS') throw conflict('Only a departure in progress can be completed');
      // Anyone still on board is dropped; anyone who never boarded is a no-show.
      const onboard = await tx.booking.findMany({ where: { tripInstanceId: tripId, status: 'IN_PROGRESS' } });
      for (const b of onboard) await completeSharedBooking(tx, ctx, b.id);
      const notBoarded = await tx.booking.findMany({ where: { tripInstanceId: tripId, status: 'CONFIRMED' } });
      for (const b of notBoarded) {
        await tx.booking.update({ where: { id: b.id }, data: { status: 'NO_SHOW', version: { increment: 1 } } });
        await recordStatus(tx, b, 'NO_SHOW', 'SYSTEM', null, 'Did not board before the trip completed');
        await releaseSeats(tx, b.id, 'NO_SHOW');
      }
      await tx.sharedTripInstance.update({ where: { id: tripId }, data: { status: 'COMPLETED', completedAt: now } });
    }
    await audit({ action: `shared.trip_${action.toLowerCase()}`, entityType: 'SharedTripInstance', entityId: tripId, communityId: trip.communityId }, { ctx, req }, tx);
    return trip;
  });
  emitToCommunity(result.communityId, 'trip:updated', { tripInstanceId: tripId });
  const passengers = await prisma.booking.findMany({ where: { tripInstanceId: tripId }, select: { id: true, passengerId: true } });
  for (const p of passengers) emitToUser(p.passengerId, 'booking:updated', { bookingId: p.id });
  if (action === 'BOARDING') {
    await notify(
      passengers.map((p) => p.passengerId),
      { type: 'SHARED_BOARDING', title: 'Your shared auto is boarding', body: `Route ${result.route.code} departs soon. Show your PIN to the driver.`, link: '/app/bookings' },
    );
  }
}

async function completeSharedBooking(tx: Tx, ctx: AuthContext, bookingId: string) {
  const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
  assertTransition('SHARED', b.status, 'COMPLETED', 'DRIVER');
  const finalFarePaise = b.quotedFarePaise;
  const updated = await tx.booking.updateMany({
    where: { id: b.id, status: b.status, version: b.version },
    data: { status: 'COMPLETED', completedAt: new Date(), finalFarePaise, version: { increment: 1 }, ...(b.paymentStatus === 'NOT_DUE' ? { paymentStatus: 'PAYMENT_PENDING' } : {}) },
  });
  if (updated.count === 0) throw conflict('Booking changed. Refresh and try again.', 'STALE_BOOKING');
  await tx.seatReservation.updateMany({ where: { bookingId, status: 'BOARDED' }, data: { status: 'COMPLETED', activeSeatKey: null } });
  const split = await recordFeeSplit(tx, b, finalFarePaise);
  await tx.booking.update({ where: { id: b.id }, data: { platformFeePaise: split.platformFeePaise, communityFeePaise: split.communityFeePaise, driverEarningsPaise: split.driverNetPaise } });
  await recordStatus(tx, b, 'COMPLETED', 'DRIVER', ctx.userId);
}

/** Board (with the passenger's PIN), drop, or mark a passenger as no-show. */
export async function passengerAction(ctx: AuthContext, tripId: string, bookingId: string, action: 'BOARD' | 'DROP' | 'NO_SHOW', pin?: string) {
  const b = await withTransaction(async (tx) => {
    const trip = await assertTripDriver(ctx, tripId, tx);
    const booking = await tx.booking.findFirst({ where: { id: bookingId, tripInstanceId: tripId } });
    if (!booking) throw notFound('Booking');
    if (action === 'BOARD') {
      if (!['BOARDING', 'IN_PROGRESS'].includes(trip.status)) throw unprocessable('Open boarding first', 'NOT_BOARDING');
      assertTransition('SHARED', booking.status, 'IN_PROGRESS', 'DRIVER');
      if (booking.startPin !== pin) throw unprocessable('Incorrect PIN', 'INVALID_PIN');
      await tx.booking.update({ where: { id: booking.id }, data: { status: 'IN_PROGRESS', startedAt: new Date(), version: { increment: 1 } } });
      await tx.seatReservation.updateMany({ where: { bookingId, status: 'CONFIRMED' }, data: { status: 'BOARDED' } });
      await recordStatus(tx, booking, 'IN_PROGRESS', 'DRIVER', ctx.userId, 'Boarded');
      await tx.tripEvent.create({ data: { bookingId, tripInstanceId: tripId, type: 'BOARDED', actorId: ctx.userId } });
    } else if (action === 'DROP') {
      await completeSharedBooking(tx, ctx, bookingId);
    } else {
      assertTransition('SHARED', booking.status, 'NO_SHOW', 'DRIVER');
      if (trip.status === 'SCHEDULED') throw unprocessable('Passengers can be marked no-show only after boarding opens', 'TOO_EARLY');
      await tx.booking.update({ where: { id: booking.id }, data: { status: 'NO_SHOW', version: { increment: 1 } } });
      await releaseSeats(tx, bookingId, 'NO_SHOW');
      await recordStatus(tx, booking, 'NO_SHOW', 'DRIVER', ctx.userId);
      await tx.tripEvent.create({ data: { bookingId, tripInstanceId: tripId, type: 'NO_SHOW', actorId: ctx.userId } });
    }
    return booking;
  });
  emitToUser(b.passengerId, 'booking:updated', { bookingId: b.id });
}

/** Community admin cancels a whole departure: every passenger is notified and refunded. */
export async function cancelDeparture(ctx: AuthContext, tripId: string, reason: string, req?: Request) {
  const trip = await prisma.sharedTripInstance.findUnique({ where: { id: tripId } });
  if (!trip) throw notFound('Departure');
  assertCommunityPermission(ctx, trip.communityId, 'community.routes.manage');
  if (!['SCHEDULED', 'BOARDING'].includes(trip.status)) throw conflict('Only departures that have not started can be cancelled');
  const affected = await withTransaction(async (tx) => {
    await tx.sharedTripInstance.update({ where: { id: tripId }, data: { status: 'CANCELLED', cancelReason: reason } });
    const bookings = await tx.booking.findMany({ where: { tripInstanceId: tripId, status: { in: ['REQUESTED', 'CONFIRMED'] } } });
    for (const b of bookings) {
      await tx.booking.update({ where: { id: b.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: ctx.userId, cancelReason: `Departure cancelled: ${reason}`, version: { increment: 1 } } });
      await recordStatus(tx, b, 'CANCELLED', 'ADMIN', ctx.userId, reason);
      await releaseSeats(tx, b.id, 'CANCELLED');
      const paid = await tx.payment.findFirst({ where: { bookingId: b.id, status: 'SUCCEEDED', method: { not: 'CASH' } } });
      if (paid) await refundPayment(paid.id, paid.amountPaise, 'Departure cancelled by community', ctx.userId, tx);
    }
    await tx.tripEvent.create({ data: { tripInstanceId: tripId, type: 'DEPARTURE_CANCELLED', note: reason, actorId: ctx.userId } });
    await audit({ action: 'shared.departure_cancelled', entityType: 'SharedTripInstance', entityId: tripId, communityId: trip.communityId, after: { reason, bookings: bookings.length } }, { ctx, req }, tx);
    return bookings;
  });
  await notify(affected.map((b) => b.passengerId), { type: 'DEPARTURE_CANCELLED', title: 'Shared auto departure cancelled', body: `${reason}. Any online payment will be refunded in full.`, link: '/app/bookings' });
  for (const b of affected) emitToUser(b.passengerId, 'booking:updated', { bookingId: b.id });
  return { cancelledBookings: affected.length };
}

export async function recordTripEvent(ctx: AuthContext, tripId: string, input: { type: 'ROUTE_DEVIATION' | 'DELAY' | 'BREAKDOWN'; note: string; lat?: number; lng?: number }) {
  const trip = await assertTripDriver(ctx, tripId);
  const event = await prisma.tripEvent.create({ data: { tripInstanceId: tripId, type: input.type, note: input.note, lat: input.lat, lng: input.lng, actorId: ctx.userId } });
  emitToCommunity(trip.communityId, 'trip:event', { tripInstanceId: tripId, type: input.type });
  await audit({ action: `shared.${input.type.toLowerCase()}`, entityType: 'SharedTripInstance', entityId: tripId, communityId: trip.communityId, after: input }, { ctx });
  return event;
}
