import { beforeAll, describe, expect, it } from 'vitest';
import { signPayload } from '../../src/modules/payments/providers.js';
import { api, bearer, communityBySlug, goOnline, idem, login, PHONES, prisma, resetDatabase, SILK_BOARD, SONY_WORLD } from '../helpers.js';

describe('regular auto booking — end to end', () => {
  let communityId: string;
  let passenger: string;
  let d1: string;
  let d2: string;

  beforeAll(async () => {
    await resetDatabase();
    communityId = (await communityBySlug('koramangala-autos')).id;
    [passenger, d1, d2] = await Promise.all([login(PHONES.passenger), login(PHONES.driver1), login(PHONES.driver2)]);
  });

  async function quote(token = passenger) {
    const res = await api.post('/api/v1/fares/quotes').set(bearer(token)).send({ pickup: SONY_WORLD, drop: SILK_BOARD });
    expect(res.status).toBe(201);
    return res.body.data;
  }

  it('shows a public fare estimate without an account', async () => {
    const res = await api.post('/api/v1/fares/estimate').send({ pickup: SONY_WORLD, drop: SILK_BOARD });
    expect(res.status).toBe(200);
    expect(res.body.data.communityName).toMatch(/Koramangala/);
    expect(res.body.data.fare.totalPaise % 100).toBe(0);
    expect(res.body.data.distanceSource).toBe('estimate'); // routing provider disabled in tests
  });

  it('rejects pickups outside every service area', async () => {
    const res = await api.post('/api/v1/fares/quotes').set(bearer(passenger)).send({ pickup: { lat: 13.1, lng: 77.5 }, drop: SILK_BOARD });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OUTSIDE_SERVICE_AREA');
  });

  it('reports NO_DRIVER_AVAILABLE when no eligible driver is online', async () => {
    const q = await quote();
    const res = await api.post('/api/v1/bookings').set(bearer(passenger)).send({ quoteId: q.quoteId, idempotencyKey: idem() });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('NO_DRIVER_AVAILABLE');
  });

  let bookingId: string;
  it('books, dispatches to online drivers, and lets exactly one driver win the race to accept', async () => {
    await goOnline(d1, communityId);
    await goOnline(d2, communityId, { lat: 12.9346, lng: 77.6112 });
    const q = await quote();
    const key = idem();
    const res = await api.post('/api/v1/bookings').set(bearer(passenger)).send({ quoteId: q.quoteId, idempotencyKey: key, pickupAddress: 'Sony World', dropAddress: 'Silk Board' });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('REQUESTED');
    expect(res.body.data.quotedFarePaise).toBe(q.fare.totalPaise); // server-side fare, as quoted
    bookingId = res.body.data.id;

    // Retrying with the same idempotency key returns the same booking.
    const replay = await api.post('/api/v1/bookings').set(bearer(passenger)).send({ quoteId: q.quoteId, idempotencyKey: key });
    expect(replay.status).toBe(200);
    expect(replay.body.data.id).toBe(bookingId);
    expect(replay.body.meta.replayed).toBe(true);

    // A different request while one is active is refused.
    const q2 = await quote();
    const dup = await api.post('/api/v1/bookings').set(bearer(passenger)).send({ quoteId: q2.quoteId, idempotencyKey: idem() });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ACTIVE_BOOKING_EXISTS');

    const offers1 = await api.get('/api/v1/drivers/me/offers').set(bearer(d1));
    const offers2 = await api.get('/api/v1/drivers/me/offers').set(bearer(d2));
    expect(offers1.body.data.map((o: { booking: { id: string } }) => o.booking.id)).toContain(bookingId);
    expect(offers2.body.data.map((o: { booking: { id: string } }) => o.booking.id)).toContain(bookingId);

    const [a, b] = await Promise.all([
      api.post(`/api/v1/bookings/${bookingId}/accept`).set(bearer(d1)),
      api.post(`/api/v1/bookings/${bookingId}/accept`).set(bearer(d2)),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.status).toBe('ACCEPTED');
    const accepted = await prisma.bookingAssignment.count({ where: { bookingId, status: 'ACCEPTED' } });
    expect(accepted).toBe(1);
  });

  it('enforces state transitions and the start PIN', async () => {
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { driver: { include: { user: true } } } });
    const driverToken = booking.driver!.user.phone === `+91${PHONES.driver1}` ? d1 : d2;
    const otherDriver = driverToken === d1 ? d2 : d1;

    // Other driver cannot act on the trip; driver cannot skip states.
    expect((await api.post(`/api/v1/bookings/${bookingId}/arrived`).set(bearer(otherDriver))).status).toBe(403);
    expect((await api.post(`/api/v1/bookings/${bookingId}/complete`).set(bearer(driverToken))).status).toBe(409);

    // Passenger sees driver first name and vehicle, never the phone number.
    const view = await api.get(`/api/v1/bookings/${bookingId}`).set(bearer(passenger));
    expect(view.body.data.driver.firstName).toBeTruthy();
    expect(JSON.stringify(view.body.data.driver)).not.toMatch(/\+91/);
    expect(view.body.data.vehicle.registrationNumber).toBeTruthy();
    const pin = view.body.data.startPin;
    expect(pin).toMatch(/^\d{4}$/);
    // The driver never receives the PIN.
    expect((await api.get(`/api/v1/bookings/${bookingId}`).set(bearer(driverToken))).body.data.startPin).toBeUndefined();

    await api.post(`/api/v1/bookings/${bookingId}/arrived`).set(bearer(driverToken)).expect(200);
    const wrong = pin === '0000' ? '1111' : '0000';
    expect((await api.post(`/api/v1/bookings/${bookingId}/start`).set(bearer(driverToken)).send({ pin: wrong })).status).toBe(422);
    await api.post(`/api/v1/bookings/${bookingId}/start`).set(bearer(driverToken)).send({ pin }).expect(200);

    // Passenger cannot cancel a trip in progress.
    expect((await api.post(`/api/v1/bookings/${bookingId}/cancel`).set(bearer(passenger)).send({ reason: 'changed mind' })).status).toBe(409);

    await api.post(`/api/v1/bookings/${bookingId}/complete`).set(bearer(driverToken)).expect(200);
    const done = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { feeRecord: true, statusHistory: true } });
    expect(done.status).toBe('COMPLETED');
    expect(done.paymentStatus).toBe('PAYMENT_PENDING');
    expect(done.finalFarePaise).toBe(done.quotedFarePaise);
    const fee = done.feeRecord!;
    expect(fee.platformFeePaise + fee.communityFeePaise + fee.processingFeePaise + fee.driverNetPaise).toBe(fee.farePaise);
    expect(done.statusHistory.map((h) => h.toStatus)).toEqual(['REQUESTED', 'ACCEPTED', 'ARRIVING', 'IN_PROGRESS', 'COMPLETED']);

    // Driver is free again; cash confirmation is idempotent.
    expect((await prisma.driverAvailability.findFirstOrThrow({ where: { driverId: done.driverId! } })).status).toBe('ONLINE');
    expect((await api.post(`/api/v1/payments/bookings/${bookingId}/cash-confirm`).set(bearer(otherDriver))).status).toBe(403);
    await api.post(`/api/v1/payments/bookings/${bookingId}/cash-confirm`).set(bearer(driverToken)).expect(200);
    const again = await api.post(`/api/v1/payments/bookings/${bookingId}/cash-confirm`).set(bearer(driverToken));
    expect(again.body.data.alreadyPaid).toBe(true);
    expect(await prisma.payment.count({ where: { bookingId, status: 'SUCCEEDED' } })).toBe(1);
  });

  it('lets the passenger rate once', async () => {
    await api.post('/api/v1/ratings').set(bearer(passenger)).send({ bookingId, score: 5, comment: 'Great ride' }).expect(201);
    expect((await api.post('/api/v1/ratings').set(bearer(passenger)).send({ bookingId, score: 1 })).status).toBe(409);
  });

  it('expired or reused quotes cannot be booked', async () => {
    const q = await quote();
    await prisma.fareQuote.update({ where: { id: q.quoteId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await api.post('/api/v1/bookings').set(bearer(passenger)).send({ quoteId: q.quoteId, idempotencyKey: idem() });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('QUOTE_EXPIRED');
    // Another passenger cannot book my quote.
    const mine = await quote();
    const other = await login(PHONES.passenger2);
    expect((await api.post('/api/v1/bookings').set(bearer(other)).send({ quoteId: mine.quoteId, idempotencyKey: idem() })).status).toBe(404);
  });

  it('charges the published cancellation fee only after the free window', async () => {
    const q = await quote();
    const created = await api.post('/api/v1/bookings').set(bearer(passenger)).send({ quoteId: q.quoteId, idempotencyKey: idem() });
    const id = created.body.data.id;
    const offered = await prisma.bookingAssignment.findFirstOrThrow({ where: { bookingId: id, status: 'OFFERED' }, include: { driver: { include: { user: true } } } });
    const token = offered.driver.user.phone === `+91${PHONES.driver1}` ? d1 : d2;
    await api.post(`/api/v1/bookings/${id}/accept`).set(bearer(token)).expect(200);
    await prisma.booking.update({ where: { id }, data: { acceptedAt: new Date(Date.now() - 10 * 60_000) } });
    const res = await api.post(`/api/v1/bookings/${id}/cancel`).set(bearer(passenger)).send({ reason: 'Plans changed' });
    expect(res.status).toBe(200);
    expect(res.body.data.cancellationFeePaise).toBe(2000);
    expect((await prisma.driverAvailability.findFirstOrThrow({ where: { driverId: offered.driverId } })).status).toBe('ONLINE');
  });

  it('marks online payments paid only through a verified provider webhook', async () => {
    const p2 = await login(PHONES.passenger2, 'Demo@12345').catch(() => login(PHONES.passenger2, 'Brand-new-pass-1'));
    const q = await quote(p2);
    const created = await api.post('/api/v1/bookings').set(bearer(p2)).send({ quoteId: q.quoteId, idempotencyKey: idem(), paymentMethod: 'MOCK_ONLINE' });
    const id = created.body.data.id;
    const offer = await prisma.bookingAssignment.findFirstOrThrow({ where: { bookingId: id, status: 'OFFERED' }, include: { driver: { include: { user: true } } } });
    const token = offer.driver.user.phone === `+91${PHONES.driver1}` ? d1 : d2;
    await api.post(`/api/v1/bookings/${id}/accept`).set(bearer(token)).expect(200);
    const pin = (await prisma.booking.findUniqueOrThrow({ where: { id } })).startPin;
    await api.post(`/api/v1/bookings/${id}/arrived`).set(bearer(token)).expect(200);
    await api.post(`/api/v1/bookings/${id}/start`).set(bearer(token)).send({ pin }).expect(200);
    await api.post(`/api/v1/bookings/${id}/complete`).set(bearer(token)).expect(200);

    const checkout = await api.post(`/api/v1/payments/bookings/${id}/checkout`).set(bearer(p2));
    expect(checkout.status).toBe(201);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: checkout.body.data.paymentId } });
    expect(payment.status).toBe('PENDING');

    const event = JSON.stringify({ type: 'payment.succeeded', providerRef: payment.providerRef, amountPaise: payment.amountPaise });
    // Forged / unsigned webhooks are rejected.
    expect((await api.post('/api/v1/payments/webhooks/mock').set('Content-Type', 'application/json').set('x-signature', 'deadbeef').send(event)).status).toBe(401);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).paymentStatus).toBe('PAYMENT_PENDING');
    // Wrong amount is rejected even when signed.
    const tampered = JSON.stringify({ type: 'payment.succeeded', providerRef: payment.providerRef, amountPaise: 1 });
    expect((await api.post('/api/v1/payments/webhooks/mock').set('Content-Type', 'application/json').set('x-signature', signPayload(tampered)).send(tampered)).status).toBe(422);

    const ok = await api.post('/api/v1/payments/webhooks/mock').set('Content-Type', 'application/json').set('x-signature', signPayload(event)).send(event);
    expect(ok.status).toBe(200);
    expect(ok.body.data.applied).toBe(true);
    const replay = await api.post('/api/v1/payments/webhooks/mock').set('Content-Type', 'application/json').set('x-signature', signPayload(event)).send(event);
    expect(replay.body.data.duplicate).toBe(true);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).paymentStatus).toBe('PAID');
    expect((await api.post(`/api/v1/payments/bookings/${id}/checkout`).set(bearer(p2))).status).toBe(409);
  });

  it('drivers who are not eligible cannot go online', async () => {
    const applicant = await login(PHONES.applicantDriver);
    const res = await api.post('/api/v1/drivers/me/availability').set(bearer(applicant)).send({ status: 'ONLINE', communityId, ...SONY_WORLD });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NOT_ELIGIBLE');
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('stops tracking and deletes location when a driver goes offline', async () => {
    await api.post('/api/v1/drivers/me/availability').set(bearer(d1)).send({ status: 'OFFLINE' }).expect(200);
    const driver = await prisma.driver.findFirstOrThrow({ where: { user: { phone: `+91${PHONES.driver1}` } } });
    expect(await prisma.driverLocation.findUnique({ where: { driverId: driver.id } })).toBeNull();
    expect((await api.post('/api/v1/drivers/me/location').set(bearer(d1)).send(SONY_WORLD)).status).toBe(409);
  });
});
