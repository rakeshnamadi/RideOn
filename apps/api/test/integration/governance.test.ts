import { beforeAll, describe, expect, it } from 'vitest';
import { api, bearer, communityBySlug, login, PHONES, prisma, resetDatabase, SILK_BOARD, SONY_WORLD } from '../helpers.js';

describe('community governance: routes and fare approvals', () => {
  let km: string;
  let admin: string;
  let approver: string;
  let head: string;

  beforeAll(async () => {
    await resetDatabase();
    km = (await communityBySlug('koramangala-autos')).id;
    [admin, approver, head] = await Promise.all([login(PHONES.kmAdmin), login(PHONES.kmApprover), login(PHONES.kmHead)]);
  });

  it('community admin creates a shared route with ordered stops and a schedule', async () => {
    const points = await prisma.pickupPoint.findMany({ where: { communityId: km }, orderBy: { name: 'asc' } });
    const res = await api.post(`/api/v1/communities/${km}/routes`).set(bearer(admin)).send({
      code: 'KM-2',
      name: 'Forum → Madiwala',
      maxSeats: 3,
      stops: [
        { pickupPointId: points.find((p) => p.name.startsWith('Forum'))!.id, offsetMinutes: 0 },
        { pickupPointId: points.find((p) => p.name.startsWith('BDA'))!.id, offsetMinutes: 5 },
        { pickupPointId: points.find((p) => p.name.startsWith('Madiwala'))!.id, offsetMinutes: 12 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.stops.map((s: { sequence: number }) => s.sequence)).toEqual([1, 2, 3]);
    const routeId = res.body.data.id;

    // Capacity can never exceed approved vehicle capacity (3).
    const tooBig = await api.post(`/api/v1/communities/${km}/routes/${routeId}/schedules`).set(bearer(admin)).send({ departureTime: '09:15', seatCapacity: 5, validFrom: new Date().toISOString() });
    expect(tooBig.status).toBe(422);
    expect(tooBig.body.error.code).toBe('CAPACITY_EXCEEDED');
    await api.post(`/api/v1/communities/${km}/routes/${routeId}/schedules`).set(bearer(admin)).send({ departureTime: '09:15', seatCapacity: 3, validFrom: new Date().toISOString() }).expect(201);

    // Route cannot go live without an approved fare.
    const activate = await api.patch(`/api/v1/communities/${km}/routes/${routeId}`).set(bearer(admin)).send({ status: 'ACTIVE' });
    expect(activate.status).toBe(422);
    expect(activate.body.error.code).toBe('NO_FARE_RULE');

    // Stops from another community are rejected.
    const foreign = await prisma.pickupPoint.findFirstOrThrow({ where: { community: { slug: 'indiranagar-autos' } } });
    const bad = await api.post(`/api/v1/communities/${km}/routes`).set(bearer(admin)).send({
      code: 'KM-X', name: 'Bad route', maxSeats: 3,
      stops: [{ pickupPointId: foreign.id, offsetMinutes: 0 }, { pickupPointId: points[0]!.id, offsetMinutes: 5 }],
    });
    expect(bad.status).toBe(422);
  });

  let proposalId: string;
  let bookingBefore: { id: string; quotedFarePaise: number };

  it('community admin proposes a fare change; approvers cannot propose and admins cannot approve', async () => {
    // A passenger books under the current fare first.
    const passenger = await login(PHONES.passenger);
    const q = await api.post('/api/v1/fares/quotes').set(bearer(passenger)).send({ pickup: SONY_WORLD, drop: SILK_BOARD });
    const b = await api.post('/api/v1/bookings').set(bearer(passenger)).send({ quoteId: q.body.data.quoteId, idempotencyKey: 'gov-before-1' });
    bookingBefore = { id: b.body.data.id, quotedFarePaise: b.body.data.quotedFarePaise };

    const body = {
      serviceType: 'REGULAR', title: 'Raise per-km rate to ₹17', rationale: 'CNG price increase',
      effectiveFrom: new Date(Date.now() + 60_000).toISOString(),
      baseFarePaise: 3000, baseDistanceMeters: 2000, perKmPaise: 1700, minimumFarePaise: 3000,
      waitingPerMinutePaise: 50, freeWaitingMinutes: 5, nightSurchargeBps: 5000, nightStartHour: 22, nightEndHour: 5,
    };
    expect((await api.post(`/api/v1/fares/communities/${km}/proposals`).set(bearer(approver)).send(body)).status).toBe(403);
    const res = await api.post(`/api/v1/fares/communities/${km}/proposals`).set(bearer(admin)).send(body);
    expect(res.status).toBe(201);
    expect(res.body.data.requiresPlatformReview).toBe(false); // +13% is within the 20% community limit
    proposalId = res.body.data.id;

    // Only one pending proposal per service.
    expect((await api.post(`/api/v1/fares/communities/${km}/proposals`).set(bearer(admin)).send(body)).status).toBe(409);
    // Proposer cannot approve their own proposal; an ADMIN lacks approval rights anyway.
    expect((await api.post(`/api/v1/fares/proposals/${proposalId}/votes`).set(bearer(admin)).send({ decision: 'APPROVE' })).status).toBe(403);
  });

  it('an authorised approver approves it, publishing a new fare version with immutable history', async () => {
    const res = await api.post(`/api/v1/fares/proposals/${proposalId}/votes`).set(bearer(approver)).send({ decision: 'APPROVE', comment: 'Justified' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPLIED');
    expect((await api.post(`/api/v1/fares/proposals/${proposalId}/votes`).set(bearer(head)).send({ decision: 'APPROVE' })).status).toBe(409);

    const rules = await prisma.fareRule.findMany({ where: { communityId: km, serviceType: 'REGULAR' }, orderBy: { version: 'asc' } });
    expect(rules.map((r) => r.version)).toEqual([1, 2]);
    expect(rules[0]!.effectiveTo?.getTime()).toBe(rules[1]!.effectiveFrom.getTime());
    expect(rules[1]!.perKmPaise).toBe(1700);
    expect(await prisma.fareHistory.count({ where: { communityId: km, proposalId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: proposalId } })).toBeGreaterThanOrEqual(2);

    // History and audit are append-only at the database level.
    await expect(prisma.fareHistory.updateMany({ where: { communityId: km }, data: { effectiveFrom: new Date() } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.deleteMany({})).rejects.toThrow(/append-only/);

    // The existing booking keeps its original fare.
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingBefore.id } });
    expect(b.quotedFarePaise).toBe(bookingBefore.quotedFarePaise);
    expect(b.fareRuleId).toBe(rules[0]!.id);
  });

  it('rejects fares above platform caps and routes large increases to platform review', async () => {
    const base = { serviceType: 'REGULAR', title: 'Big increase', baseFarePaise: 3000, baseDistanceMeters: 2000, minimumFarePaise: 3000, effectiveFrom: new Date(Date.now() + 60_000).toISOString() };
    const capped = await api.post(`/api/v1/fares/communities/${km}/proposals`).set(bearer(admin)).send({ ...base, perKmPaise: 9000 });
    expect(capped.status).toBe(422);
    expect(capped.body.error.code).toBe('FARE_LIMIT');

    const big = await api.post(`/api/v1/fares/communities/${km}/proposals`).set(bearer(admin)).send({ ...base, perKmPaise: 2500 });
    expect(big.status).toBe(201);
    expect(big.body.data.requiresPlatformReview).toBe(true);
    const id = big.body.data.id;
    const vote = await api.post(`/api/v1/fares/proposals/${id}/votes`).set(bearer(approver)).send({ decision: 'APPROVE' });
    expect(vote.body.data.status).toBe('PENDING'); // still waiting on the platform

    const superAdmin = await login(PHONES.superAdmin);
    const reviews = await api.get('/api/v1/fares/reviews').set(bearer(superAdmin));
    expect(reviews.body.data.some((p: { id: string }) => p.id === id)).toBe(true);
    // Super admins cannot vote as community approvers…
    expect((await api.post(`/api/v1/fares/proposals/${id}/votes`).set(bearer(superAdmin)).send({ decision: 'APPROVE' })).status).toBe(403);
    // …and community admins cannot perform the platform review.
    expect((await api.post(`/api/v1/fares/reviews/${id}`).set(bearer(head)).send({ decision: 'APPROVED' })).status).toBe(403);
    const review = await api.post(`/api/v1/fares/reviews/${id}`).set(bearer(superAdmin)).send({ decision: 'REJECTED', note: 'Exceeds state notified fare' });
    expect(review.body.data.status).toBe('REJECTED');
  });

  it('honours multi-approver policies', async () => {
    const inCommunity = await communityBySlug('indiranagar-autos');
    const inHead = await login(PHONES.inHead);
    // Indiranagar requires 2 approvals; add a second approver.
    await api.post(`/api/v1/communities/${inCommunity.id}/admins`).set(bearer(inHead)).send({ phone: PHONES.kmApprover, role: 'APPROVER' }).expect(201);
    await api.put(`/api/v1/communities/${inCommunity.id}/policy`).set(bearer(inHead)).send({ allowSelfApproval: true }).expect(200);
    const p = await api.post(`/api/v1/fares/communities/${inCommunity.id}/proposals`).set(bearer(inHead)).send({
      serviceType: 'REGULAR', title: 'Small change', baseFarePaise: 3600, baseDistanceMeters: 2000, perKmPaise: 1500, minimumFarePaise: 3000, effectiveFrom: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(p.status).toBe(201);
    const first = await api.post(`/api/v1/fares/proposals/${p.body.data.id}/votes`).set(bearer(inHead)).send({ decision: 'APPROVE' });
    expect(first.body.data.status).toBe('PENDING');
    const approverToken = await login(PHONES.kmApprover);
    const second = await api.post(`/api/v1/fares/proposals/${p.body.data.id}/votes`).set(bearer(approverToken)).send({ decision: 'APPROVE' });
    expect(second.body.data.status).toBe('APPLIED');
  });
});
