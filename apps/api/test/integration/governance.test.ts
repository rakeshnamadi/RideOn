import { beforeAll, describe, expect, it } from 'vitest';
import { api, bearer, communityBySlug, login, PHONES, prisma, resetDatabase, DROP_POINT, PICKUP_POINT } from '../helpers.js';

describe('community governance: routes and fare approvals', () => {
  let km: string;
  let admin: string;
  let approver: string;
  let head: string;

  beforeAll(async () => {
    await resetDatabase();
    km = (await communityBySlug('ainavilli-autos')).id;
    [admin, approver, head] = await Promise.all([login(PHONES.kmAdmin), login(PHONES.kmApprover), login(PHONES.kmHead)]);
  });

  it('community admin creates a shared route with ordered stops and a schedule', async () => {
    const points = await prisma.pickupPoint.findMany({ where: { communityId: km }, orderBy: { name: 'asc' } });
    const res = await api.post(`/api/v1/communities/${km}/routes`).set(bearer(admin)).send({
      code: 'AV-2',
      name: 'Muktheswaram → Pothukurru',
      maxSeats: 3,
      stops: [
        { pickupPointId: points.find((p) => p.name.startsWith('Muktheswaram'))!.id, offsetMinutes: 0 },
        { pickupPointId: points.find((p) => p.name.startsWith('Sanapalli'))!.id, offsetMinutes: 5 },
        { pickupPointId: points.find((p) => p.name.startsWith('Pothukurru'))!.id, offsetMinutes: 12 },
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
    const foreign = await prisma.pickupPoint.findFirstOrThrow({ where: { community: { slug: 'amalapuram-autos' } } });
    const bad = await api.post(`/api/v1/communities/${km}/routes`).set(bearer(admin)).send({
      code: 'AV-X', name: 'Bad route', maxSeats: 3,
      stops: [{ pickupPointId: foreign.id, offsetMinutes: 0 }, { pickupPointId: points[0]!.id, offsetMinutes: 5 }],
    });
    expect(bad.status).toBe(422);
  });

  let proposalId: string;
  let bookingBefore: { id: string; quotedFarePaise: number };

  it('community admin proposes a fare change; approvers cannot propose and admins cannot approve', async () => {
    // A passenger books under the current fare first.
    const passenger = await login(PHONES.passenger);
    const q = await api.post('/api/v1/fares/quotes').set(bearer(passenger)).send({ pickup: PICKUP_POINT, drop: DROP_POINT });
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
    // The super admin controls everything: they may vote too, but platform review is still required…
    const saVote = await api.post(`/api/v1/fares/proposals/${id}/votes`).set(bearer(superAdmin)).send({ decision: 'APPROVE' });
    expect(saVote.status).toBe(200);
    expect(saVote.body.data.status).toBe('PENDING');
    // …and community admins cannot perform the platform review.
    expect((await api.post(`/api/v1/fares/reviews/${id}`).set(bearer(head)).send({ decision: 'APPROVED' })).status).toBe(403);
    const review = await api.post(`/api/v1/fares/reviews/${id}`).set(bearer(superAdmin)).send({ decision: 'REJECTED', note: 'Exceeds state notified fare' });
    expect(review.body.data.status).toBe('REJECTED');
  });

  it('honours multi-approver policies', async () => {
    const inCommunity = await communityBySlug('amalapuram-autos');
    const inHead = await login(PHONES.inHead);
    // Indiranagar requires 2 approvals; add a second approver.
    await api.post(`/api/v1/communities/${inCommunity.id}/admins`).set(bearer(inHead)).send({ phone: PHONES.kmApprover, role: 'APPROVER' }).expect(201);
    // Test setup only: governance rules normally change through a policy proposal (tested below).
    await prisma.communityPolicy.update({ where: { communityId: inCommunity.id }, data: { allowSelfApproval: true } });
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

  it('governance rules cannot be changed by one administrator; operational settings can', async () => {
    const direct = await api.put(`/api/v1/communities/${km}/policy`).set(bearer(head)).send({ cancellationFeePaise: 5000 });
    expect(direct.status).toBe(422);
    expect(direct.body.error.code).toBe('GOVERNANCE_REQUIRED');
    expect(direct.body.error.details).toEqual(['cancellationFeePaise']);

    const ops = await api.put(`/api/v1/communities/${km}/policy`).set(bearer(head)).send({ seatHoldMinutes: 7 });
    expect(ops.status).toBe(200);
    expect(ops.body.data.seatHoldMinutes).toBe(7);
  });

  it('a policy proposal changes the rules only after an approver votes for it', async () => {
    const before = await prisma.communityPolicy.findUniqueOrThrow({ where: { communityId: km } });
    const res = await api.post(`/api/v1/communities/${km}/policy-proposals`).set(bearer(admin)).send({
      title: 'Longer free cancellation window',
      rationale: 'Passengers asked for more time after a driver accepts',
      changes: { cancellationFreeWindowSec: 300, cancellationFeePaise: before.cancellationFeePaise },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('POLICY_CHANGE');
    // Unchanged fields are dropped from the proposal.
    expect(res.body.data.policyChanges).toEqual({ cancellationFreeWindowSec: 300 });
    expect(res.body.data.policyBefore).toEqual({ cancellationFreeWindowSec: before.cancellationFreeWindowSec });
    const id = res.body.data.id;

    // Nothing changes yet; a second pending policy proposal is refused; approvers can't propose.
    expect((await prisma.communityPolicy.findUniqueOrThrow({ where: { communityId: km } })).cancellationFreeWindowSec).toBe(before.cancellationFreeWindowSec);
    expect((await api.post(`/api/v1/communities/${km}/policy-proposals`).set(bearer(admin)).send({ title: 'Another change', changes: { minNoticeHours: 24 } })).status).toBe(409);
    expect((await api.post(`/api/v1/communities/${km}/policy-proposals`).set(bearer(approver)).send({ title: 'Approver proposal', changes: { minNoticeHours: 24 } })).status).toBe(403);
    const noChange = await api.post(`/api/v1/communities/${km}/policy-proposals`).set(bearer(admin)).send({ title: 'No real change', changes: { minNoticeHours: before.minNoticeHours } });
    expect(noChange.status).toBe(422);
    expect(noChange.body.error.code).toBe('NO_CHANGE');

    const vote = await api.post(`/api/v1/fares/proposals/${id}/votes`).set(bearer(approver)).send({ decision: 'APPROVE', comment: 'Agreed at the members meeting' });
    expect(vote.body.data.status).toBe('APPLIED');
    const after = await prisma.communityPolicy.findUniqueOrThrow({ where: { communityId: km } });
    expect(after.cancellationFreeWindowSec).toBe(300);
    expect(after.cancellationFeePaise).toBe(before.cancellationFeePaise);
    expect(await prisma.auditLog.count({ where: { action: 'policy.changed', communityId: km } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'policy.proposal_vote_approve', entityId: id } })).toBe(1);
  });

  it('rejects invalid policy combinations', async () => {
    const res = await api.post(`/api/v1/communities/${km}/policy-proposals`).set(bearer(admin)).send({ title: 'Multi with one approval', changes: { fareApprovalMode: 'MULTI_APPROVER', requiredApprovals: 1 } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_POLICY');
  });
});
