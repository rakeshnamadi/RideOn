import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { auth, authenticate, requirePermission } from '../../middleware/auth.js';
import { communityId, requireCommunity } from '../../middleware/community-scope.js';
import { sensitiveLimiter } from '../../middleware/security.js';
import { IdParam, created, ok, parse } from '../../utils/http.js';
import { Lat, Lng } from '../geo/geo.routes.js';
import { activeFareRules, createRegularQuote, priceRegularTrip } from './fare.service.js';
import { createFareProposal, getFareCaps, getPolicy, platformReview, voteOnProposal, withdrawProposal } from './governance.service.js';

const Point = z.object({ lat: Lat, lng: Lng });
const TripSchema = z.object({ pickup: Point, drop: Point, communityId: z.string().max(40).optional() });

const paise = z.number().int().min(0).max(1_000_000);
const FareProposalSchema = z.object({
  serviceType: z.enum(['REGULAR', 'SHARED']),
  sharedRouteId: z.string().max(40).nullable().optional(),
  title: z.string().trim().min(5).max(200),
  rationale: z.string().trim().max(5000).optional(),
  effectiveFrom: z.coerce.date(),
  baseFarePaise: paise.default(0),
  baseDistanceMeters: z.number().int().min(0).max(20_000).default(0),
  perKmPaise: paise.default(0),
  minimumFarePaise: paise.default(0),
  waitingPerMinutePaise: paise.default(0),
  freeWaitingMinutes: z.number().int().min(0).max(30).default(3),
  perSeatPaise: paise.default(0),
  perStopPaise: paise.default(0),
  nightSurchargeBps: z.number().int().min(0).max(10_000).default(0),
  nightStartHour: z.number().int().min(0).max(23).default(22),
  nightEndHour: z.number().int().min(0).max(23).default(5),
});

export const fareRoutes = Router();

/** Public fare estimate — no account needed, nothing stored. */
fareRoutes.post('/estimate', sensitiveLimiter, async (req, res) => {
  const body = parse(TripSchema, req.body);
  const priced = await priceRegularTrip(body.pickup, body.drop, body.communityId);
  ok(res, priced);
});

/** Bookable quote: persisted, owned by the passenger, expires after a few minutes. */
fareRoutes.post('/quotes', authenticate, requirePermission('booking.create'), sensitiveLimiter, async (req, res) => {
  const body = parse(TripSchema, req.body);
  created(res, await createRegularQuote(auth(req).userId, body.pickup, body.drop, body.communityId));
});

fareRoutes.get('/communities/:communityId', async (req, res) => {
  ok(res, await activeFareRules(communityId(req)));
});

/** Fare revision history is public for transparency. */
fareRoutes.get('/communities/:communityId/history', async (req, res) => {
  ok(res, await prisma.fareHistory.findMany({ where: { communityId: communityId(req) }, orderBy: { createdAt: 'desc' }, take: 100 }));
});

fareRoutes.get('/caps', async (_req, res) => {
  ok(res, await getFareCaps());
});

// ─────────── Governance: proposals and votes ───────────

fareRoutes.get('/communities/:communityId/proposals', authenticate, requireCommunity('community.view'), async (req, res) => {
  const q = parse(z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN']).optional() }), req.query);
  const id = communityId(req);
  const [items, policy] = await Promise.all([
    prisma.governanceProposal.findMany({
      where: { communityId: id, ...(q.status ? { status: q.status } : {}) },
      include: {
        fareProposal: true,
        proposedBy: { select: { id: true, name: true } },
        votes: { include: { voter: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    getPolicy(id),
  ]);
  ok(res, items, { policy: { fareApprovalMode: policy.fareApprovalMode, requiredApprovals: policy.requiredApprovals, allowSelfApproval: policy.allowSelfApproval, maxFareIncreasePercent: policy.maxFareIncreasePercent, minNoticeHours: policy.minNoticeHours } });
});

fareRoutes.post('/communities/:communityId/proposals', authenticate, requireCommunity('community.fares.propose'), async (req, res) => {
  const body = parse(FareProposalSchema, req.body);
  created(res, await createFareProposal(auth(req), communityId(req), body, req));
});

fareRoutes.post('/proposals/:id/votes', authenticate, async (req, res) => {
  const { id } = parse(IdParam, req.params);
  const body = parse(z.object({ decision: z.enum(['APPROVE', 'REJECT']), comment: z.string().trim().max(1000).optional() }), req.body);
  ok(res, await voteOnProposal(auth(req), id, body.decision, body.comment, req));
});

fareRoutes.post('/proposals/:id/withdraw', authenticate, async (req, res) => {
  const { id } = parse(IdParam, req.params);
  await withdrawProposal(auth(req), id, req);
  ok(res, { withdrawn: true });
});

fareRoutes.get('/reviews', authenticate, requirePermission('platform.fares.review'), async (_req, res) => {
  const items = await prisma.governanceProposal.findMany({
    where: { requiresPlatformReview: true },
    include: {
      fareProposal: true,
      community: { select: { id: true, name: true } },
      proposedBy: { select: { name: true } },
      votes: { select: { decision: true, voter: { select: { name: true } } } },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 100,
  });
  ok(res, items);
});

fareRoutes.post('/reviews/:id', authenticate, requirePermission('platform.fares.review'), async (req, res) => {
  const { id } = parse(IdParam, req.params);
  const body = parse(z.object({ decision: z.enum(['APPROVED', 'REJECTED']), note: z.string().trim().max(1000).optional() }), req.body);
  ok(res, await platformReview(auth(req), id, body.decision, body.note, req));
});
