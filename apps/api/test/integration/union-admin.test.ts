import { beforeAll, describe, expect, it } from 'vitest';
import { api, bearer, communityBySlug, login, PHONES, prisma, resetDatabase } from '../helpers.js';

// 1×1 PNG, and a file that only pretends to be one.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const FAKE_PNG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

describe('union administration: roles, delegation, master data, feedback, reports, activity', () => {
  let av: string;
  let am: string;
  let superAdmin: string;
  let localAdmin: string;
  let reporter: string;
  let approver: string;
  let amLocalAdmin: string;

  beforeAll(async () => {
    await resetDatabase();
    av = (await communityBySlug('ainavilli-autos')).id;
    am = (await communityBySlug('amalapuram-autos')).id;
    [superAdmin, localAdmin, reporter, approver, amLocalAdmin] = await Promise.all([
      login(PHONES.superAdmin),
      login(PHONES.kmHead),
      login(PHONES.reporter),
      login(PHONES.kmApprover),
      login(PHONES.inHead),
    ]);
  });

  describe('role hierarchy', () => {
    it('a local admin delegates the roles below them but cannot appoint local admins', async () => {
      const catalog = await api.get(`/api/v1/communities/${av}/team-catalog`).set(bearer(localAdmin));
      expect(catalog.body.data.assignableRoles).toEqual(['REPORTER', 'APPROVER', 'OPERATOR']);

      const asOperator = await api.post(`/api/v1/communities/${av}/admins`).set(bearer(localAdmin)).send({ phone: PHONES.passenger2, role: 'OPERATOR' });
      expect(asOperator.status).toBe(201);
      expect(asOperator.body.data.permissions).toContain('community.queue.manage');

      const asLocalAdmin = await api.post(`/api/v1/communities/${av}/admins`).set(bearer(localAdmin)).send({ phone: PHONES.passenger, role: 'LOCAL_ADMIN' });
      expect(asLocalAdmin.status).toBe(403);
    });

    it('a local admin switches individual permissions on and off for a delegate', async () => {
      const member = await prisma.communityAdmin.findFirstOrThrow({ where: { communityId: av, user: { phone: `+91${PHONES.passenger2}` } } });
      const operator = await login(PHONES.passenger2);
      expect((await api.post(`/api/v1/communities/${av}/pickup-points`).set(bearer(operator)).send({ name: 'Temp point', lat: 16.67, lng: 82.04 })).status).toBe(403);

      const edit = await api.patch(`/api/v1/communities/${av}/admins/${member.id}`).set(bearer(localAdmin)).send({ permissions: ['community.view', 'community.routes.manage'] });
      expect(edit.status).toBe(200);
      expect(edit.body.data.customPermissions).toEqual(['community.view', 'community.routes.manage']);
      // Takes effect on the next request — no re-login needed.
      expect((await api.post(`/api/v1/communities/${av}/pickup-points`).set(bearer(operator)).send({ name: 'Temp point', lat: 16.67, lng: 82.04 })).status).toBe(201);
      expect((await api.get(`/api/v1/communities/${av}/queue`).set(bearer(operator))).status).toBe(403);

      // Local-admin-only permissions can never be delegated.
      const escalate = await api.patch(`/api/v1/communities/${av}/admins/${member.id}`).set(bearer(localAdmin)).send({ permissions: ['community.admins.manage'] });
      expect(escalate.status).toBe(422);
      expect(escalate.body.error.code).toBe('INVALID_PERMISSIONS');
    });

    it('delegates cannot manage the team, and a local admin cannot edit another local admin', async () => {
      expect((await api.post(`/api/v1/communities/${av}/admins`).set(bearer(reporter)).send({ phone: PHONES.passenger, role: 'OPERATOR' })).status).toBe(403);
      const otherLocalAdmin = await prisma.communityAdmin.findFirstOrThrow({ where: { communityId: av, user: { phone: `+91${PHONES.kmAdmin}` } } });
      expect((await api.patch(`/api/v1/communities/${av}/admins/${otherLocalAdmin.id}`).set(bearer(localAdmin)).send({ role: 'OPERATOR' })).status).toBe(403);
      expect((await api.delete(`/api/v1/communities/${av}/admins/${otherLocalAdmin.id}`).set(bearer(localAdmin))).status).toBe(403);
    });

    it('the super admin assigns platform and union roles to any registered person', async () => {
      const teja = await prisma.user.findUniqueOrThrow({ where: { phone: `+91${PHONES.passenger2}` } });
      const assign = await api.post(`/api/v1/admin/users/${teja.id}/community-roles`).set(bearer(superAdmin)).send({ communityId: am, role: 'LOCAL_ADMIN' });
      expect(assign.status).toBe(201);
      const tejaToken = await login(PHONES.passenger2);
      expect((await api.get(`/api/v1/communities/${am}/drivers`).set(bearer(tejaToken))).status).toBe(200);

      const roles = await api.put(`/api/v1/admin/users/${teja.id}/roles`).set(bearer(superAdmin)).send({ roles: ['PASSENGER', 'COMMUNITY_ADMIN', 'SUPER_ADMIN'] });
      expect(roles.status).toBe(200);
      expect((await api.get('/api/v1/admin/dashboard').set(bearer(tejaToken))).status).toBe(200);
      await api.put(`/api/v1/admin/users/${teja.id}/roles`).set(bearer(superAdmin)).send({ roles: ['PASSENGER', 'COMMUNITY_ADMIN'] }).expect(200);
      expect((await api.get('/api/v1/admin/dashboard').set(bearer(tejaToken))).status).toBe(403);

      // Guards: no self-demotion, and the driver role needs a driver registration.
      const me = await prisma.user.findUniqueOrThrow({ where: { phone: `+91${PHONES.superAdmin}` } });
      expect((await api.put(`/api/v1/admin/users/${me.id}/roles`).set(bearer(superAdmin)).send({ roles: ['PASSENGER'] })).status).toBe(409);
      expect((await api.put(`/api/v1/admin/users/${teja.id}/roles`).set(bearer(superAdmin)).send({ roles: ['DRIVER'] })).body.error.code).toBe('DRIVER_PROFILE_REQUIRED');
      // Non-super-admins cannot assign roles.
      expect((await api.put(`/api/v1/admin/users/${teja.id}/roles`).set(bearer(localAdmin)).send({ roles: ['SUPER_ADMIN'] })).status).toBe(403);
    });

    it('the super admin has full control inside every union', async () => {
      expect((await api.post(`/api/v1/communities/${am}/pickup-points`).set(bearer(superAdmin)).send({ name: 'Platform-added point', lat: 16.58, lng: 82.01 })).status).toBe(201);
      expect((await api.get(`/api/v1/communities/${am}/reports`).set(bearer(superAdmin))).status).toBe(200);
    });
  });

  describe('union master data', () => {
    it('a local admin maintains name, tagline, pincode, colour and logo; others only see it', async () => {
      const res = await api.patch(`/api/v1/communities/${av}`).set(bearer(localAdmin)).send({ shortName: 'AADU', tagline: 'Our village, our autos', pincode: '533211', brandColor: '#0F4D3A', foundedYear: 2016, address: 'Ainavilli Centre' });
      expect(res.status).toBe(200);
      expect(res.body.data.tagline).toBe('Our village, our autos');
      expect((await api.patch(`/api/v1/communities/${av}`).set(bearer(localAdmin)).send({ pincode: '12345' })).status).toBe(400);
      expect((await api.patch(`/api/v1/communities/${av}`).set(bearer(reporter)).send({ tagline: 'x' })).status).toBe(403);
      expect((await api.patch(`/api/v1/communities/${av}`).set(bearer(amLocalAdmin)).send({ tagline: 'hijack' })).status).toBe(403);

      const fake = await api.post(`/api/v1/communities/${av}/logo`).set(bearer(localAdmin)).attach('logo', FAKE_PNG, { filename: 'logo.png', contentType: 'image/png' });
      expect(fake.status).toBe(400);
      const up = await api.post(`/api/v1/communities/${av}/logo`).set(bearer(localAdmin)).attach('logo', PNG, { filename: 'logo.png', contentType: 'image/png' });
      expect(up.status).toBe(200);
      expect(up.body.data.logoUrl).toMatch(new RegExp(`^/api/v1/communities/${av}/logo\\?v=\\d+$`));
      expect(up.body.data.logoKey).toBeUndefined();

      // The logo and master data are public.
      const logo = await api.get(`/api/v1/communities/${av}/logo`);
      expect(logo.status).toBe(200);
      expect(logo.headers['content-type']).toBe('image/png');
      const pub = await api.get(`/api/v1/communities/${av}/public`);
      expect(pub.body.data).toMatchObject({ shortName: 'AADU', pincode: '533211', tagline: 'Our village, our autos' });
      expect(pub.body.data.logoUrl).toBeTruthy();
    });
  });

  describe('driver feedback on union fares', () => {
    let feedbackId: string;
    it('an approved member driver gives feedback on the current fare', async () => {
      const driver = await login(PHONES.driver1);
      const res = await api.post('/api/v1/fare-feedback').set(bearer(driver)).send({ communityId: av, serviceType: 'REGULAR', sentiment: 'TOO_LOW', suggestedPerKmPaise: 1800, comment: 'Per-km rate does not cover the return trip from Kondukuduru' });
      expect(res.status).toBe(201);
      expect(res.body.data.fareRuleId).toBeTruthy();
      feedbackId = res.body.data.id;
      // Not a member of Amalapuram, so no feedback there; passengers cannot give it at all.
      expect((await api.post('/api/v1/fare-feedback').set(bearer(driver)).send({ communityId: am, serviceType: 'REGULAR', sentiment: 'FAIR', comment: 'Looks fine to me' })).status).toBe(403);
      const passenger = await login(PHONES.passenger);
      expect((await api.post('/api/v1/fare-feedback').set(bearer(passenger)).send({ communityId: av, serviceType: 'REGULAR', sentiment: 'FAIR', comment: 'Looks fine' })).status).toBe(403);
    });

    it('the union sees a summary and replies; the driver sees the reply', async () => {
      const list = await api.get(`/api/v1/fare-feedback/communities/${av}`).set(bearer(approver));
      expect(list.status).toBe(200);
      expect(list.body.data.length).toBeGreaterThanOrEqual(2); // seeded example + the new one
      expect(list.body.meta.summary.bySentiment).toContainEqual({ serviceType: 'REGULAR', sentiment: 'TOO_LOW', count: 2 });
      expect(list.body.meta.summary.averageSuggestion.perKmPaise).toBe(1750);
      expect((await api.get(`/api/v1/fare-feedback/communities/${av}`).set(bearer(amLocalAdmin))).status).toBe(403);
      expect((await api.get(`/api/v1/fare-feedback/communities/${av}`).set(bearer(reporter))).status).toBe(403);

      await api.patch(`/api/v1/fare-feedback/${feedbackId}`).set(bearer(localAdmin)).send({ status: 'ACKNOWLEDGED', response: 'We will discuss this at the next members meeting' }).expect(200);
      const driver = await login(PHONES.driver1);
      const mine = await api.get('/api/v1/fare-feedback/mine').set(bearer(driver));
      expect(mine.body.data[0]).toMatchObject({ status: 'ACKNOWLEDGED', response: 'We will discuss this at the next members meeting' });
    });
  });

  describe('reports', () => {
    it('a reporter prepares, edits, refreshes and publishes a report', async () => {
      const res = await api.post(`/api/v1/communities/${av}/reports`).set(bearer(reporter)).send({ title: 'Last two weeks', from: new Date(Date.now() - 14 * 86_400_000).toISOString(), to: new Date(Date.now() + 60_000).toISOString() });
      expect(res.status).toBe(201);
      expect(res.body.data.metrics.completedTrips).toBe(12);
      expect(res.body.data.metrics.drivers.activeMembers).toBe(3);
      const id = res.body.data.id;
      await api.patch(`/api/v1/communities/${av}/reports/${id}`).set(bearer(reporter)).send({ notes: 'Evening demand up near Ainavilli Centre.' }).expect(200);
      await api.post(`/api/v1/communities/${av}/reports/${id}/refresh`).set(bearer(reporter)).expect(200);
      const pub = await api.patch(`/api/v1/communities/${av}/reports/${id}`).set(bearer(reporter)).send({ status: 'PUBLISHED' });
      expect(pub.body.data.publishedAt).toBeTruthy();
      // Published reports are frozen except for notes, and are kept on record.
      expect((await api.post(`/api/v1/communities/${av}/reports/${id}/refresh`).set(bearer(reporter))).status).toBe(409);
      expect((await api.patch(`/api/v1/communities/${av}/reports/${id}`).set(bearer(reporter)).send({ title: 'Changed' })).status).toBe(409);
      expect((await api.delete(`/api/v1/communities/${av}/reports/${id}`).set(bearer(reporter))).status).toBe(422);
      const csv = await api.get(`/api/v1/communities/${av}/reports/${id}/export.csv`).set(bearer(reporter));
      expect(csv.text).toMatch(/^metric,value\nBookings,/);
      // Other unions' reporters/admins cannot see it; approvers lack the reports permission.
      expect((await api.get(`/api/v1/communities/${av}/reports/${id}`).set(bearer(amLocalAdmin))).status).toBe(403);
      expect((await api.get(`/api/v1/communities/${av}/reports`).set(bearer(approver))).status).toBe(403);
    });

    it('a reporter approves new drivers and sets area geolocation, but cannot change prices', async () => {
      const applied = await prisma.communityMembership.findFirstOrThrow({ where: { communityId: av, status: 'APPLIED' } });
      await api.post(`/api/v1/communities/${av}/memberships/${applied.id}/decision`).set(bearer(reporter)).send({ decision: 'APPROVE' }).expect(200);
      await api.post(`/api/v1/communities/${av}/service-areas`).set(bearer(reporter)).send({ name: 'Kondukuduru side', polygon: [[16.67, 82.07], [16.67, 82.09], [16.65, 82.09]] }).expect(201);
      expect((await api.post(`/api/v1/fares/communities/${av}/proposals`).set(bearer(reporter)).send({ serviceType: 'REGULAR', title: 'Reporter fare', baseFarePaise: 3000, effectiveFrom: new Date(Date.now() + 60_000).toISOString() })).status).toBe(403);
    });
  });

  describe('deleting configured data', () => {
    it('pickup points in use by a route cannot be deleted; unused ones can', async () => {
      const used = await prisma.pickupPoint.findFirstOrThrow({ where: { communityId: av, name: 'Muktheswaram Stand' } });
      const r = await api.delete(`/api/v1/communities/${av}/pickup-points/${used.id}`).set(bearer(localAdmin));
      expect(r.status).toBe(409);
      expect(r.body.error.message).toMatch(/AV-1/);
      const unused = await prisma.pickupPoint.findFirstOrThrow({ where: { communityId: av, name: 'Siripalli' } });
      await api.delete(`/api/v1/communities/${av}/pickup-points/${unused.id}`).set(bearer(localAdmin)).expect(200);
    });

    it('routes and unions with history are protected; unused ones can be removed', async () => {
      const route = await api.post(`/api/v1/communities/${av}/routes`).set(bearer(localAdmin)).send({
        code: 'AV-TMP', name: 'Temporary', maxSeats: 3,
        stops: [
          { pickupPointId: (await prisma.pickupPoint.findFirstOrThrow({ where: { name: 'Nedunuru' } })).id, offsetMinutes: 0 },
          { pickupPointId: (await prisma.pickupPoint.findFirstOrThrow({ where: { name: 'Pothukurru' } })).id, offsetMinutes: 9 },
        ],
      });
      await api.delete(`/api/v1/communities/${av}/routes/${route.body.data.id}`).set(bearer(localAdmin)).expect(200);
      expect((await api.delete(`/api/v1/admin/communities/${av}`).set(bearer(superAdmin))).body.error.code).toBe('HAS_HISTORY');
      const pending = await communityBySlug('kothapeta-autos');
      await api.delete(`/api/v1/admin/communities/${pending.id}`).set(bearer(superAdmin)).expect(200);
    });
  });

  describe('activity log', () => {
    it('records every request with the user and outcome, viewable by the super admin only', async () => {
      process.env.ACTIVITY_LOG_IN_TESTS = 'true';
      await api.get(`/api/v1/communities/${av}/console`).set(bearer(localAdmin)).expect(200);
      await api.get('/api/v1/admin/dashboard').set(bearer(localAdmin)).expect(403);
      process.env.ACTIVITY_LOG_IN_TESTS = 'false';
      const head = await prisma.user.findUniqueOrThrow({ where: { phone: `+91${PHONES.kmHead}` } });
      // Rows are written after the response; give them a moment.
      let rows: { path: string; statusCode: number; communityId: string | null }[] = [];
      for (let i = 0; i < 20 && rows.length < 2; i++) {
        rows = await prisma.activityLog.findMany({ where: { userId: head.id } });
        if (rows.length < 2) await new Promise((r) => setTimeout(r, 50));
      }
      expect(rows).toContainEqual(expect.objectContaining({ path: `/api/v1/communities/${av}/console`, statusCode: 200, communityId: av }));
      expect(rows).toContainEqual(expect.objectContaining({ path: '/api/v1/admin/dashboard', statusCode: 403 }));

      const list = await api.get('/api/v1/admin/activity').query({ userId: head.id }).set(bearer(superAdmin));
      expect(list.status).toBe(200);
      expect(list.body.data[0].userName).toBe('Satyanarayana Murthy');
      expect((await api.get('/api/v1/admin/activity/summary').set(bearer(superAdmin))).body.data.total).toBeGreaterThanOrEqual(2);
      expect((await api.get('/api/v1/admin/activity').set(bearer(localAdmin))).status).toBe(403);
    });

    it('sign-ins, failures and lockouts are recorded in the audit log', async () => {
      await api.post('/api/v1/auth/login').send({ identifier: PHONES.driver3, password: 'wrong-password-9' }).expect(401);
      await login(PHONES.driver3);
      const user = await prisma.user.findUniqueOrThrow({ where: { phone: `+91${PHONES.driver3}` } });
      const actions = (await prisma.auditLog.findMany({ where: { entityId: user.id, action: { startsWith: 'auth.' } } })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['auth.login_failed', 'auth.login']));
    });
  });
});
