import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initSockets } from '../../src/sockets/index.js';
import { api, app, bearer, communityBySlug, DROP_POINT, goOnline, idem, login, PHONES, PICKUP_POINT, prisma, resetDatabase } from '../helpers.js';

type Phone = (typeof PHONES)[keyof typeof PHONES];
const userId = async (phone: Phone) => (await prisma.user.findUniqueOrThrow({ where: { phone: `+91${phone}` } })).id;

/** Notifications of one type, keyed by recipient phone, created after `since`. */
async function recipients(type: string, since: Date) {
  const rows = await prisma.notification.findMany({ where: { type, createdAt: { gte: since } }, include: { user: { select: { phone: true } } } });
  return rows.map((r) => r.user.phone.replace('+91', '')).sort();
}

const AV_STAFF = [PHONES.kmHead, PHONES.kmAdmin, PHONES.kmApprover, PHONES.reporter].sort();

describe('alerts — who is told what, in the database and live over the socket', () => {
  let communityId: string;
  let passenger: string;
  let driver: string;
  let superAdmin: string;
  let kmHead: string;
  let url: string;
  let closeServer: () => Promise<void>;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    await resetDatabase();
    communityId = (await communityBySlug('ainavilli-autos')).id;
    [passenger, driver, superAdmin, kmHead] = await Promise.all([login(PHONES.passenger), login(PHONES.driver1), login(PHONES.superAdmin), login(PHONES.kmHead)]);
    const server = createServer(app);
    const io = initSockets(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closeServer = () => new Promise((resolve) => void io.close(() => resolve()));
  });

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await closeServer();
  });

  function socketFor(token: string | undefined): Promise<Socket> {
    const s = connect(url, { path: '/socket.io', auth: token ? { token } : {}, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    return new Promise((resolve, reject) => {
      s.once('connect', () => resolve(s));
      s.once('connect_error', reject);
    });
  }
  const nextNotification = (s: Socket, type: string, ms = 5000) =>
    new Promise<{ type: string; title: string; body: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${type} notification within ${ms} ms`)), ms);
      const handler = (n: { type: string; title: string; body: string }) => {
        if (n.type !== type) return;
        clearTimeout(timer);
        s.off('notification', handler);
        resolve(n);
      };
      s.on('notification', handler);
    });

  async function bookAndAccept() {
    await goOnline(driver, communityId);
    const quote = (await api.post('/api/v1/fares/quotes').set(bearer(passenger)).send({ pickup: PICKUP_POINT, drop: DROP_POINT }).expect(201)).body.data;
    const booking = (await api.post('/api/v1/bookings').set(bearer(passenger)).send({ quoteId: quote.quoteId, idempotencyKey: idem() }).expect(201)).body.data;
    await api.post(`/api/v1/bookings/${booking.id}/accept`).set(bearer(driver)).expect(200);
    return booking as { id: string; reference: string };
  }

  it('refuses socket connections without a valid token', async () => {
    await expect(socketFor(undefined)).rejects.toThrow(/unauthorized/);
    await expect(socketFor('not-a-token')).rejects.toThrow(/unauthorized/);
  });

  let bookingId: string;
  it('tells the passenger, live and in the inbox, as the trip moves along — and nobody else', async () => {
    const since = new Date();
    const [mine, other] = await Promise.all([socketFor(passenger), socketFor(await login(PHONES.passenger2))]);
    let leaked = false;
    other.on('notification', () => (leaked = true));

    const assigned = nextNotification(mine, 'DRIVER_ASSIGNED');
    const booking = await bookAndAccept();
    bookingId = booking.id;
    expect((await assigned).body).toContain(booking.reference);

    const arrived = nextNotification(mine, 'DRIVER_ARRIVED');
    await api.post(`/api/v1/bookings/${bookingId}/arrived`).set(bearer(driver)).expect(200);
    await arrived;
    const pin = (await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).startPin;
    await api.post(`/api/v1/bookings/${bookingId}/start`).set(bearer(driver)).send({ pin }).expect(200);
    const completed = nextNotification(mine, 'TRIP_COMPLETED');
    await api.post(`/api/v1/bookings/${bookingId}/complete`).set(bearer(driver)).expect(200);
    expect((await completed).body).toMatch(/₹\d+/);

    for (const type of ['DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'TRIP_COMPLETED']) expect(await recipients(type, since)).toEqual([PHONES.passenger]);
    expect(leaked).toBe(false);
  });

  it('tells the driver when the passenger cancels', async () => {
    const since = new Date();
    const booking = await bookAndAccept();
    await api.post(`/api/v1/bookings/${booking.id}/cancel`).set(bearer(passenger)).send({ reason: 'Plans changed' }).expect(200);
    expect(await recipients('BOOKING_CANCELLED', since)).toEqual([PHONES.driver1]);
  });

  it('raises an SOS to the super admin and every Ainavilli staff member, records it, and opens an urgent ticket', async () => {
    const since = new Date();
    const staffSocket = await socketFor(kmHead);
    const live = nextNotification(staffSocket, 'SOS');
    const res = await api.post(`/api/v1/bookings/${bookingId}/sos`).set(bearer(passenger)).send({ lat: 16.664, lng: 82.031, note: 'Driver took a wrong turn' });
    expect(res.status).toBe(201);
    expect(res.body.data.emergencyNumber).toBe('112');
    expect((await live).body).toBe('Driver took a wrong turn');

    expect(await recipients('SOS', since)).toEqual([PHONES.superAdmin, ...AV_STAFF].sort()); // not the other union, not the passenger
    const ticket = await prisma.supportTicket.findFirstOrThrow({ where: { reference: res.body.data.ticketReference } });
    expect(ticket).toMatchObject({ kind: 'SAFETY', priority: 'URGENT', bookingId, communityId });
    expect(await prisma.tripEvent.count({ where: { bookingId, type: 'SOS', lat: { not: null } } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'safety.sos_raised', entityId: bookingId } })).toBe(1);
  });

  it('refuses an SOS from someone who is not on the trip, and records nothing', async () => {
    const before = await prisma.supportTicket.count();
    const outsider = await login(PHONES.passenger2);
    expect((await api.post(`/api/v1/bookings/${bookingId}/sos`).set(bearer(outsider)).send({})).status).toBe(403);
    expect(await prisma.supportTicket.count()).toBe(before);
  });

  it('routes complaints to the union, safety complaints also to the platform, and updates back to the passenger', async () => {
    let since = new Date();
    const fare = await api.post('/api/v1/complaints').set(bearer(passenger)).send({ bookingId, category: 'FARE', description: 'The driver asked for more than the fare.' });
    expect(fare.status).toBe(201);
    expect(await recipients('COMPLAINT', since)).toEqual(AV_STAFF);

    since = new Date();
    await api.post('/api/v1/complaints').set(bearer(passenger)).send({ bookingId, category: 'SAFETY', description: 'Driver was speeding near the canal.' }).expect(201);
    expect(await recipients('COMPLAINT', since)).toEqual([PHONES.superAdmin, ...AV_STAFF].sort());

    since = new Date();
    await api.patch(`/api/v1/complaints/${fare.body.data.id}`).set(bearer(kmHead)).send({ status: 'ESCALATED' }).expect(200);
    expect(await recipients('COMPLAINT_UPDATE', since)).toEqual([PHONES.passenger]);
    expect(await recipients('COMPLAINT', since)).toEqual([PHONES.superAdmin]);
  });

  it('alerts the platform about incident tickets but not ordinary support questions', async () => {
    let since = new Date();
    await api.post('/api/v1/support-tickets').set(bearer(passenger)).send({ subject: 'App question', description: 'How do I change my language?' }).expect(201);
    expect(await recipients('TICKET', since)).toEqual([]);
    since = new Date();
    const incident = await api.post('/api/v1/support-tickets').set(bearer(passenger)).send({ subject: 'Accident', description: 'Minor accident near the bus stand.', kind: 'INCIDENT' });
    expect(incident.body.data.priority).toBe('HIGH');
    expect(await recipients('TICKET', since)).toEqual([PHONES.superAdmin]);
  });

  it('sends driver announcements only to approved member drivers', async () => {
    let since = new Date();
    await api.post(`/api/v1/communities/${communityId}/announcements`).set(bearer(kmHead)).send({ title: 'Union meeting', body: 'Sunday 10 am at the stand.', audience: 'DRIVERS' }).expect(201);
    const told = await recipients('ANNOUNCEMENT', since);
    expect(told).toEqual(expect.arrayContaining([PHONES.driver1, PHONES.driver2, PHONES.driver3]));
    expect(told).not.toContain(PHONES.applicantDriver); // still applying
    expect(told).not.toContain(PHONES.inDriver); // other union
    expect(told).not.toContain(PHONES.passenger);
    since = new Date();
    await api.post(`/api/v1/communities/${communityId}/announcements`).set(bearer(kmHead)).send({ title: 'For passengers', body: 'New stand near the temple.', audience: 'PASSENGERS' }).expect(201);
    expect(await recipients('ANNOUNCEMENT', since)).toEqual([]);
  });

  it('tells union staff about a driver application, and the driver about the decision', async () => {
    let since = new Date();
    const applicant = await login(PHONES.inDriver);
    const m = await api.post('/api/v1/drivers/me/memberships').set(bearer(applicant)).send({ communityId, note: 'I live in Ainavilli now' });
    expect(m.status).toBe(201);
    expect(await recipients('MEMBERSHIP_APPLICATION', since)).toEqual(AV_STAFF);
    since = new Date();
    await api.post(`/api/v1/communities/${communityId}/memberships/${m.body.data.id}/decision`).set(bearer(kmHead)).send({ decision: 'APPROVE' }).expect(200);
    expect(await recipients('MEMBERSHIP_DECISION', since)).toEqual([PHONES.inDriver]);
  });

  it('keeps each inbox private: unread counts, marking read, and no access to other people’s alerts', async () => {
    const inbox = await api.get('/api/v1/notifications').set(bearer(passenger)).expect(200);
    expect(inbox.body.meta.unread).toBeGreaterThanOrEqual(5);
    const pid = await userId(PHONES.passenger);
    expect(inbox.body.data.every((n: { userId: string }) => n.userId === pid)).toBe(true);

    // Someone else's id is silently ignored.
    const theirs = await prisma.notification.findFirstOrThrow({ where: { user: { phone: `+91${PHONES.superAdmin}` }, readAt: null } });
    await api.post(`/api/v1/notifications/${theirs.id}/read`).set(bearer(passenger)).expect(200);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt).toBeNull();

    const first = inbox.body.data[0].id;
    await api.post(`/api/v1/notifications/${first}/read`).set(bearer(passenger)).expect(200);
    const after = await api.get('/api/v1/notifications').set(bearer(passenger));
    expect(after.body.meta.unread).toBe(inbox.body.meta.unread - 1);
    const all = await api.post('/api/v1/notifications/read-all').set(bearer(passenger)).expect(200);
    expect(all.body.data.updated).toBe(inbox.body.meta.unread - 1);
    expect((await api.get('/api/v1/notifications').set(bearer(passenger))).body.meta.unread).toBe(0);
    expect((await api.get('/api/v1/notifications').set(bearer(superAdmin))).body.meta.unread).toBeGreaterThan(0);
  });
});

describe('data insertion — what is stored, and what is refused', () => {
  let passenger: string;
  let communityId: string;
  beforeAll(async () => {
    passenger = await login(PHONES.passenger);
    communityId = (await communityBySlug('ainavilli-autos')).id;
  });

  it('rejects invalid input with 400 and field details, and inserts nothing', async () => {
    const before = await Promise.all([prisma.complaint.count(), prisma.supportTicket.count()]);
    const bad = [
      api.post('/api/v1/complaints').set(bearer(passenger)).send({ communityId, category: 'FARE', description: 'short' }),
      api.post('/api/v1/complaints').set(bearer(passenger)).send({ communityId, category: 'NOT_A_CATEGORY', description: 'A perfectly long description.' }),
      api.post('/api/v1/complaints').set(bearer(passenger)).send({ communityId, category: 'FARE', description: 'x'.repeat(5001) }),
      api.post('/api/v1/support-tickets').set(bearer(passenger)).send({ subject: 'Hi', description: 'Too short subject above.' }),
      api.post('/api/v1/support-tickets').set(bearer(passenger)).send({ subject: 'Bad kind', description: 'Kind is not allowed here.', kind: 'PANIC' }),
    ];
    for (const res of await Promise.all(bad)) {
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error.code).toBeTruthy();
    }
    // A complaint must say which union it concerns.
    expect((await api.post('/api/v1/complaints').set(bearer(passenger)).send({ category: 'FARE', description: 'No union named here.' })).body.error.code).toBe('COMMUNITY_REQUIRED');
    expect(await Promise.all([prisma.complaint.count(), prisma.supportTicket.count()])).toEqual(before);
  });

  it('refuses to attach records to a booking the caller is not part of', async () => {
    const someoneElses = await prisma.booking.findFirstOrThrow({ where: { passenger: { phone: `+91${PHONES.passenger}` } } });
    const outsider = await login(PHONES.passenger2);
    const before = await prisma.complaint.count();
    expect((await api.post('/api/v1/complaints').set(bearer(outsider)).send({ bookingId: someoneElses.id, category: 'FARE', description: 'Not my booking at all.' })).status).toBe(404);
    expect((await api.post('/api/v1/complaints').set(bearer(outsider)).send({ bookingId: 'does-not-exist', category: 'FARE', description: 'Made-up booking id.' })).status).toBe(404);
    expect(await prisma.complaint.count()).toBe(before);
  });

  it('requires a session for every write', async () => {
    expect((await api.post('/api/v1/complaints').send({ category: 'FARE', description: 'No token supplied here.' })).status).toBe(401);
    expect((await api.post('/api/v1/support-tickets').set(bearer('garbage')).send({ subject: 'Hello', description: 'Bad token supplied.' })).status).toBe(401);
  });

  it('stores Telugu, emoji and markup exactly as typed, and trims surrounding spaces', async () => {
    const text = 'ఆటో డ్రైవర్ చాలా మంచివారు 🙏 <script>alert(1)</script> & "quotes"';
    const res = await api.post('/api/v1/support-tickets').set(bearer(passenger)).send({ subject: '   తెలుగు సందేశం  ', description: text });
    expect(res.status).toBe(201);
    const row = await prisma.supportTicket.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.subject).toBe('తెలుగు సందేశం');
    expect(row.description).toBe(text);
    expect(row.reference).toMatch(/^TK/);
    const mine = await api.get('/api/v1/support-tickets/mine').set(bearer(passenger));
    expect(mine.body.data.find((t: { id: string }) => t.id === row.id).description).toBe(text);
  });

  it('accepts the longest allowed text and refuses one character more', async () => {
    const ok = await api.post('/api/v1/complaints').set(bearer(passenger)).send({ communityId, category: 'OTHER', description: 'y'.repeat(5000) });
    expect(ok.status).toBe(201);
    expect((await prisma.complaint.findUniqueOrThrow({ where: { id: ok.body.data.id } })).description).toHaveLength(5000);
    expect((await api.post('/api/v1/complaints').set(bearer(passenger)).send({ communityId, category: 'OTHER', description: 'y'.repeat(5001) })).status).toBe(400);
  });
});
