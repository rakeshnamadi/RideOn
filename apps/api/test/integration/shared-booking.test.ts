import { beforeAll, describe, expect, it } from 'vitest';
import { expireSeatHolds } from '../../src/modules/shared-trips/shared-trip.service.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { api, bearer, idem, login, PHONES, prisma, resetDatabase } from '../helpers.js';

interface Departure {
  id: string;
  seatsAvailable: number;
  route: { stops: { id: string; sequence: number }[] };
}

describe('shared auto seat booking', () => {
  let passenger: string;
  let departures: Departure[];

  beforeAll(async () => {
    await resetDatabase();
    passenger = await login(PHONES.passenger);
    const route = await prisma.sharedRoute.findFirstOrThrow({ where: { code: 'AV-1' } });
    const res = await api.get(`/api/v1/shared-trips/search?routeId=${route.id}`);
    departures = res.body.data;
    expect(departures.length).toBeGreaterThan(3);
  });

  const stops = (d: Departure) => ({ pickupStopId: d.route.stops[0]!.id, dropStopId: d.route.stops[3]!.id });

  it('holds seats, prices them on the server, and confirms the booking', async () => {
    const d = departures[0]!;
    const key = idem('seat');
    const res = await api.post(`/api/v1/shared-trips/${d.id}/reservations`).set(bearer(passenger)).send({ ...stops(d), seats: 2, idempotencyKey: key });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('REQUESTED');
    // Seat fare: ₹20 + 2 extra stops × ₹5 = ₹30 per seat → ₹60 for 2.
    expect(res.body.data.quotedFarePaise).toBe(6000);
    const id = res.body.data.id;

    // Idempotent retry returns the same booking and does not take more seats.
    const retry = await api.post(`/api/v1/shared-trips/${d.id}/reservations`).set(bearer(passenger)).send({ ...stops(d), seats: 2, idempotencyKey: key });
    expect(retry.status).toBe(200);
    expect(retry.body.data.id).toBe(id);
    // A second booking on the same departure is treated as an accidental duplicate.
    const dup = await api.post(`/api/v1/shared-trips/${d.id}/reservations`).set(bearer(passenger)).send({ ...stops(d), seats: 1, idempotencyKey: idem('seat') });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_RESERVATION');

    await api.post(`/api/v1/bookings/${id}/confirm`).set(bearer(passenger)).expect(200);
    const trip = await prisma.sharedTripInstance.findUniqueOrThrow({ where: { id: d.id } });
    expect(trip.seatsBooked).toBe(2);
    const seats = await prisma.seatReservation.findMany({ where: { bookingId: id } });
    expect(seats.map((s) => s.status)).toEqual(['CONFIRMED', 'CONFIRMED']);
  });

  it('rejects reversed stops and more seats than are left', async () => {
    const d = departures[0]!;
    const p2 = await login(PHONES.passenger2);
    const reversed = await api.post(`/api/v1/shared-trips/${d.id}/reservations`).set(bearer(p2)).send({ pickupStopId: d.route.stops[3]!.id, dropStopId: d.route.stops[0]!.id, seats: 1, idempotencyKey: idem() });
    expect(reversed.status).toBe(422);
    const tooMany = await api.post(`/api/v1/shared-trips/${d.id}/reservations`).set(bearer(p2)).send({ ...stops(d), seats: 2, idempotencyKey: idem() });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error.code).toBe('INSUFFICIENT_SEATS');
  });

  it('never overbooks under concurrent reservations', async () => {
    const d = departures[1]!;
    // 10 different passengers race for a 3-seat departure.
    const hash = await hashPassword('Demo@12345');
    const role = await prisma.role.findUniqueOrThrow({ where: { key: 'PASSENGER' } });
    const tokens: string[] = [];
    for (let i = 0; i < 10; i++) {
      const phone = `70000000${String(i).padStart(2, '0')}`;
      await prisma.user.create({ data: { name: `Racer ${i}`, phone: `+91${phone}`, passwordHash: hash, roles: { create: { roleId: role.id } } } });
      tokens.push(await login(phone));
    }
    const results = await Promise.all(
      tokens.map((t) => api.post(`/api/v1/shared-trips/${d.id}/reservations`).set(bearer(t)).send({ ...stops(d), seats: 1, idempotencyKey: idem('race') })),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(3);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);

    const trip = await prisma.sharedTripInstance.findUniqueOrThrow({ where: { id: d.id } });
    expect(trip.seatsBooked).toBe(3);
    const active = await prisma.seatReservation.findMany({ where: { tripInstanceId: d.id, activeSeatKey: { not: null } } });
    expect(active).toHaveLength(3);
    expect(new Set(active.map((s) => s.seatNumber))).toEqual(new Set([1, 2, 3]));
  });

  it('releases expired holds back to inventory', async () => {
    const d = departures[2]!;
    const res = await api.post(`/api/v1/shared-trips/${d.id}/reservations`).set(bearer(passenger)).send({ ...stops(d), seats: 3, idempotencyKey: idem() });
    expect(res.status).toBe(201);
    expect((await prisma.sharedTripInstance.findUniqueOrThrow({ where: { id: d.id } })).seatsBooked).toBe(3);
    await prisma.booking.update({ where: { id: res.body.data.id }, data: { requestExpiresAt: new Date(Date.now() - 1000) } });
    expect(await expireSeatHolds()).toBeGreaterThanOrEqual(1);
    expect((await prisma.sharedTripInstance.findUniqueOrThrow({ where: { id: d.id } })).seatsBooked).toBe(0);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: res.body.data.id } })).status).toBe('EXPIRED');
    // Confirming an expired hold fails.
    expect((await api.post(`/api/v1/bookings/${res.body.data.id}/confirm`).set(bearer(passenger))).status).toBe(409);
  });

  it('cancellation before the cutoff is free and releases seats', async () => {
    const d = departures[3]!;
    const res = await api.post(`/api/v1/shared-trips/${d.id}/reservations`).set(bearer(passenger)).send({ ...stops(d), seats: 1, idempotencyKey: idem() });
    await api.post(`/api/v1/bookings/${res.body.data.id}/confirm`).set(bearer(passenger)).expect(200);
    const cancel = await api.post(`/api/v1/bookings/${res.body.data.id}/cancel`).set(bearer(passenger)).send({ reason: 'No longer needed' });
    expect(cancel.status).toBe(200);
    expect((await prisma.sharedTripInstance.findUniqueOrThrow({ where: { id: d.id } })).seatsBooked).toBe(0);
  });

  it('driver claims a departure, boards with PIN, drops, and the trip completes', async () => {
    const d = departures[0]!;
    const driver = await login(PHONES.driver1);
    await api.post(`/api/v1/shared-trips/${d.id}/claim`).set(bearer(driver)).expect(200);
    // A second driver cannot take it.
    const d2 = await login(PHONES.driver2);
    expect((await api.post(`/api/v1/shared-trips/${d.id}/claim`).set(bearer(d2))).status).toBe(409);

    const manifest = await api.get(`/api/v1/shared-trips/${d.id}/manifest`).set(bearer(driver));
    expect(manifest.status).toBe(200);
    const entry = manifest.body.data.bookings[0];
    expect(entry.passenger).toEqual({ firstName: 'Sravani' });
    expect(entry.seats).toHaveLength(2);
    // Other drivers cannot read the manifest.
    expect((await api.get(`/api/v1/shared-trips/${d.id}/manifest`).set(bearer(d2))).status).toBe(403);

    await prisma.sharedTripInstance.update({ where: { id: d.id }, data: { departureAt: new Date(Date.now() + 10 * 60_000) } });
    await api.post(`/api/v1/shared-trips/${d.id}/status`).set(bearer(driver)).send({ action: 'BOARDING' }).expect(200);
    const pin = (await prisma.booking.findUniqueOrThrow({ where: { id: entry.id } })).startPin;
    expect((await api.post(`/api/v1/shared-trips/${d.id}/bookings/${entry.id}/board`).set(bearer(driver)).send({ pin: pin === '0000' ? '1111' : '0000' })).status).toBe(422);
    await api.post(`/api/v1/shared-trips/${d.id}/bookings/${entry.id}/board`).set(bearer(driver)).send({ pin }).expect(200);
    await api.post(`/api/v1/shared-trips/${d.id}/status`).set(bearer(driver)).send({ action: 'START' }).expect(200);
    await api.post(`/api/v1/shared-trips/${d.id}/events`).set(bearer(driver)).send({ type: 'ROUTE_DEVIATION', note: 'Road closed at BDA, diverted via 80ft road' }).expect(201);
    await api.post(`/api/v1/shared-trips/${d.id}/status`).set(bearer(driver)).send({ action: 'COMPLETE' }).expect(200);

    const b = await prisma.booking.findUniqueOrThrow({ where: { id: entry.id }, include: { feeRecord: true } });
    expect(b.status).toBe('COMPLETED');
    expect(b.feeRecord?.farePaise).toBe(6000);
    const trip = await prisma.sharedTripInstance.findUniqueOrThrow({ where: { id: d.id } });
    expect(trip.status).toBe('COMPLETED');
    expect(await prisma.tripEvent.count({ where: { tripInstanceId: d.id, type: 'ROUTE_DEVIATION' } })).toBe(1);
  });

  it('a seat number can never be held twice, even bypassing the service (DB constraint)', async () => {
    const d = departures[1]!;
    const existing = await prisma.seatReservation.findFirstOrThrow({ where: { tripInstanceId: d.id, activeSeatKey: { not: null } } });
    await expect(
      prisma.seatReservation.create({ data: { tripInstanceId: d.id, bookingId: existing.bookingId, seatNumber: existing.seatNumber, activeSeatKey: existing.activeSeatKey } }),
    ).rejects.toThrow();
    await expect(prisma.sharedTripInstance.update({ where: { id: d.id }, data: { seatsBooked: 99 } })).rejects.toThrow();
  });
});
