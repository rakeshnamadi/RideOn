import { logger } from '../config/logger.js';
import { prisma, withTransaction } from '../db.js';
import { dispatchNextRound, recordStatus } from '../modules/bookings/booking.service.js';
import { notify } from '../modules/notifications/notification.service.js';
import { ensureTripInstances, expireSeatHolds } from '../modules/shared-trips/shared-trip.service.js';
import { emitToUser } from '../sockets/index.js';
import { purgeOldActivity } from '../modules/activity/activity.js';
import { addMinutes } from '../utils/time.js';

/** Expire unanswered offers and move to the next batch of drivers. */
export async function runDispatchSweep() {
  const now = new Date();
  await prisma.bookingAssignment.updateMany({ where: { status: 'OFFERED', expiresAt: { lt: now } }, data: { status: 'EXPIRED' } });
  const waiting = await prisma.booking.findMany({
    where: { type: 'REGULAR', status: 'REQUESTED', requestExpiresAt: { gt: now }, assignments: { none: { status: 'OFFERED' } } },
    select: { id: true },
    take: 100,
  });
  for (const b of waiting) await dispatchNextRound(b.id);
}

/** Requests nobody accepted within the community's request timeout become EXPIRED. */
export async function expireStaleRequests() {
  const stale = await prisma.booking.findMany({ where: { type: 'REGULAR', status: 'REQUESTED', requestExpiresAt: { lt: new Date() } }, take: 100 });
  for (const b of stale) {
    const changed = await withTransaction(async (tx) => {
      const r = await tx.booking.updateMany({ where: { id: b.id, status: 'REQUESTED', version: b.version }, data: { status: 'EXPIRED', version: { increment: 1 } } });
      if (r.count === 0) return false;
      await tx.bookingAssignment.updateMany({ where: { bookingId: b.id, status: 'OFFERED' }, data: { status: 'WITHDRAWN' } });
      await recordStatus(tx, b, 'EXPIRED', 'SYSTEM', null, 'No driver accepted in time');
      return true;
    });
    if (changed) {
      emitToUser(b.passengerId, 'booking:updated', { bookingId: b.id, status: 'EXPIRED' });
      await notify(b.passengerId, { type: 'BOOKING_EXPIRED', title: 'Request expired', body: `No driver accepted ${b.reference}. Please try again.`, link: `/app/bookings/${b.id}` });
    }
  }
}

/** Privacy: drop locations of drivers who stopped reporting. Offline drivers' rows are deleted immediately elsewhere. */
export async function purgeStaleLocations() {
  const cutoff = addMinutes(new Date(), -15);
  const stale = await prisma.driverLocation.findMany({ where: { updatedAt: { lt: cutoff } }, select: { driverId: true } });
  if (stale.length === 0) return;
  const ids = stale.map((s) => s.driverId);
  // Drivers who vanished without going offline are taken offline (unless mid-trip).
  await prisma.driverAvailability.updateMany({ where: { driverId: { in: ids }, status: 'ONLINE' }, data: { status: 'OFFLINE', standId: null, queuedAt: null } });
  const onTrip = await prisma.driverAvailability.findMany({ where: { driverId: { in: ids }, status: 'ON_TRIP' }, select: { driverId: true } });
  const keep = new Set(onTrip.map((d) => d.driverId));
  await prisma.driverLocation.deleteMany({ where: { driverId: { in: ids.filter((i) => !keep.has(i)) } } });
}

/** Departure reminders 30 minutes before a confirmed shared trip. */
const reminded = new Set<string>();
export async function sendDepartureReminders() {
  const now = new Date();
  const soon = await prisma.sharedTripInstance.findMany({
    where: { status: 'SCHEDULED', departureAt: { gt: addMinutes(now, 25), lt: addMinutes(now, 31) } },
    include: { route: { select: { code: true } }, bookings: { where: { status: 'CONFIRMED' }, select: { passengerId: true } } },
  });
  for (const t of soon) {
    if (reminded.has(t.id)) continue;
    reminded.add(t.id);
    await notify(t.bookings.map((b) => b.passengerId), { type: 'DEPARTURE_REMINDER', title: `Route ${t.route.code} departs in 30 minutes`, body: 'Be at your pickup stop on time with your boarding PIN.', link: '/app/bookings' });
  }
  if (reminded.size > 5000) reminded.clear();
}

type Job = { name: string; everyMs: number; run: () => Promise<unknown> };

export const JOBS: Job[] = [
  { name: 'dispatch-sweep', everyMs: 5_000, run: runDispatchSweep },
  { name: 'expire-requests', everyMs: 15_000, run: expireStaleRequests },
  { name: 'expire-seat-holds', everyMs: 20_000, run: expireSeatHolds },
  { name: 'generate-departures', everyMs: 30 * 60_000, run: () => ensureTripInstances() },
  { name: 'departure-reminders', everyMs: 60_000, run: sendDepartureReminders },
  { name: 'purge-locations', everyMs: 5 * 60_000, run: purgeStaleLocations },
  { name: 'purge-activity', everyMs: 6 * 60 * 60_000, run: purgeOldActivity },
];

/**
 * In-process scheduler. Each job is guarded against overlapping runs. Every job is
 * idempotent and uses conditional updates, so running several API instances is safe
 * (if wasteful) — see docs/deployment.md for moving these to a dedicated worker.
 */
export function startJobs() {
  const timers: NodeJS.Timeout[] = [];
  for (const job of JOBS) {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await job.run();
      } catch (err) {
        logger.error({ err, job: job.name }, 'Job failed');
      } finally {
        running = false;
      }
    };
    timers.push(setInterval(tick, job.everyMs));
    void tick();
  }
  logger.info({ jobs: JOBS.map((j) => j.name) }, 'Background jobs started');
  return () => timers.forEach(clearInterval);
}
