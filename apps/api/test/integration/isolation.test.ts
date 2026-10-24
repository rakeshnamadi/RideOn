import { beforeAll, describe, expect, it } from 'vitest';
import { api, bearer, communityBySlug, login, PHONES, prisma, resetDatabase } from '../helpers.js';

describe('community data isolation and role boundaries', () => {
  let km: string;
  let inId: string;
  let inHead: string;
  let kmHead: string;

  beforeAll(async () => {
    await resetDatabase();
    km = (await communityBySlug('koramangala-autos')).id;
    inId = (await communityBySlug('indiranagar-autos')).id;
    [inHead, kmHead] = await Promise.all([login(PHONES.inHead), login(PHONES.kmHead)]);
  });

  it("a community admin cannot read another community's private records", async () => {
    for (const path of ['console', 'memberships', 'drivers', 'vehicles', 'bookings', 'queue', 'audit-logs', 'stats']) {
      const res = await api.get(`/api/v1/communities/${km}/${path}`).set(bearer(inHead));
      expect(res.status, path).toBe(403);
    }
    expect((await api.get(`/api/v1/reports/communities/${km}/statements`).set(bearer(inHead))).status).toBe(403);
    expect((await api.get(`/api/v1/fares/communities/${km}/proposals`).set(bearer(inHead))).status).toBe(403);
    expect((await api.get(`/api/v1/complaints?communityId=${km}`).set(bearer(inHead))).status).toBe(403);
    expect((await api.get(`/api/v1/shared-trips/community/${km}`).set(bearer(inHead))).status).toBe(403);
    // …while their own community works.
    expect((await api.get(`/api/v1/communities/${inId}/drivers`).set(bearer(inHead))).status).toBe(200);
  });

  it("a community admin cannot modify another community's data", async () => {
    const kmMembership = await prisma.communityMembership.findFirstOrThrow({ where: { communityId: km, status: 'APPLIED' } });
    // Using their own community in the URL with a foreign record ID still fails.
    expect((await api.post(`/api/v1/communities/${inId}/memberships/${kmMembership.id}/decision`).set(bearer(inHead)).send({ decision: 'APPROVE' })).status).toBe(404);
    expect((await api.post(`/api/v1/communities/${km}/memberships/${kmMembership.id}/decision`).set(bearer(inHead)).send({ decision: 'APPROVE' })).status).toBe(403);
    const kmVehicle = await prisma.vehicle.findFirstOrThrow({ where: { communityId: km } });
    expect((await api.post(`/api/v1/communities/${inId}/vehicles/${kmVehicle.id}/decision`).set(bearer(inHead)).send({ decision: 'DEACTIVATE' })).status).toBe(404);
    const kmRoute = await prisma.sharedRoute.findFirstOrThrow({ where: { communityId: km } });
    expect((await api.patch(`/api/v1/communities/${inId}/routes/${kmRoute.id}`).set(bearer(inHead)).send({ status: 'SUSPENDED' })).status).toBe(404);
    expect((await api.patch(`/api/v1/communities/${km}`).set(bearer(inHead)).send({ name: 'Hijacked' })).status).toBe(403);
  });

  it("protects private driver documents across communities", async () => {
    const doc = await prisma.driverDocument.findFirstOrThrow({ where: { driver: { memberships: { some: { communityId: km } } } } });
    expect((await api.get(`/api/v1/drivers/documents/${doc.id}/file`).set(bearer(inHead))).status).toBe(403);
    const ok = await api.get(`/api/v1/drivers/documents/${doc.id}/file`).set(bearer(kmHead));
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('application/pdf');
    // Passengers and other drivers can't read it either.
    const passenger = await login(PHONES.passenger);
    const otherDriver = await login(PHONES.inDriver);
    expect((await api.get(`/api/v1/drivers/documents/${doc.id}/file`).set(bearer(passenger))).status).toBe(403);
    expect((await api.get(`/api/v1/drivers/documents/${doc.id}/file`).set(bearer(otherDriver))).status).toBe(403);
  });

  it('passengers cannot read other passengers bookings', async () => {
    const booking = await prisma.booking.findFirstOrThrow();
    const other = await login(PHONES.passenger2);
    expect((await api.get(`/api/v1/bookings/${booking.id}`).set(bearer(other))).status).toBe(403);
    expect((await api.get(`/api/v1/bookings/${booking.id}`).set(bearer(inHead))).status).toBe(403);
    expect((await api.get(`/api/v1/bookings/${booking.id}`).set(bearer(kmHead))).status).toBe(200);
  });

  it('non-super-admins cannot reach the platform console', async () => {
    for (const token of [kmHead, await login(PHONES.passenger), await login(PHONES.driver1)]) {
      expect((await api.get('/api/v1/admin/dashboard').set(bearer(token))).status).toBe(403);
      expect((await api.post('/api/v1/admin/fees').set(bearer(token)).send({ serviceType: 'REGULAR', feeBps: 0, effectiveFrom: new Date().toISOString() })).status).toBe(403);
    }
    expect((await api.get('/api/v1/reports/bookings.csv?from=2020-01-01&to=2030-01-01').set(bearer(kmHead))).status).toBe(403);
  });

  it('super admin can inspect platform-wide operational data', async () => {
    const sa = await login(PHONES.superAdmin);
    const dash = await api.get('/api/v1/admin/dashboard').set(bearer(sa));
    expect(dash.status).toBe(200);
    expect(dash.body.data.communities.ACTIVE).toBe(2);
    expect(dash.body.data.revenue.completedTrips).toBe(12);
    expect(dash.body.data.issues.pendingVerifications).toBeGreaterThanOrEqual(1);
    const bookings = await api.get('/api/v1/admin/bookings').set(bearer(sa));
    expect(bookings.body.meta.total).toBeGreaterThanOrEqual(12);
    const audit = await api.get('/api/v1/admin/audit-logs').set(bearer(sa));
    expect(audit.status).toBe(200);
    const csv = await api.get('/api/v1/reports/bookings.csv?from=2020-01-01&to=2030-01-01').set(bearer(sa));
    expect(csv.status).toBe(200);
    expect(csv.text.split('\n')[0]).toMatch(/^reference,type,status/);
    expect(csv.text).not.toMatch(/\+91/); // no phone numbers in exports
  });

  it('community heads see their own statements; the platform generates them', async () => {
    const sa = await login(PHONES.superAdmin);
    const gen = await api.post(`/api/v1/reports/communities/${km}/statements`).set(bearer(sa)).send({ from: '2020-01-01', to: new Date(Date.now() + 60_000).toISOString() });
    expect(gen.status).toBe(201);
    expect(gen.body.data.tripCount).toBe(12);
    expect((await api.post(`/api/v1/reports/communities/${km}/statements`).set(bearer(kmHead)).send({ from: '2020-01-01', to: '2030-01-01' })).status).toBe(403);
    const mine = await api.get(`/api/v1/reports/communities/${km}/statements`).set(bearer(kmHead));
    expect(mine.body.data.statements).toHaveLength(1);
  });

  it('suspending a membership takes the driver off the network and is audited', async () => {
    const membership = await prisma.communityMembership.findFirstOrThrow({ where: { communityId: km, status: 'APPROVED' }, include: { driver: true } });
    const noReason = await api.post(`/api/v1/communities/${km}/memberships/${membership.id}/decision`).set(bearer(kmHead)).send({ decision: 'SUSPEND' });
    expect(noReason.status).toBe(422);
    await api.post(`/api/v1/communities/${km}/memberships/${membership.id}/decision`).set(bearer(kmHead)).send({ decision: 'SUSPEND', note: 'Repeated overcharging complaints' }).expect(200);
    expect(await prisma.auditLog.count({ where: { action: 'membership.suspend', entityId: membership.id } })).toBe(1);
  });
});
