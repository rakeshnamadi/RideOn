import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { auth, authenticate } from '../../middleware/auth.js';
import { forbidden, notFound, unprocessable } from '../../utils/errors.js';
import { IdParam, created, ok, param, parse } from '../../utils/http.js';
import { audit } from '../audit/audit.service.js';
import { assertCommunityPermission } from '../auth/auth-context.js';
import { requireDriver } from '../drivers/driver.service.js';
import { notify } from '../notifications/notification.service.js';
import { findActiveRule } from './fare.service.js';

/**
 * Drivers' feedback on the fares fixed by their union. Drivers say whether the current fare
 * is too low, fair or too high and may suggest values; the union's local admins and approvers
 * read the summary, reply, and can turn feedback into a fare proposal.
 */
export const fareFeedbackRoutes = Router();
fareFeedbackRoutes.use(authenticate);

const MAX_FEEDBACK_PER_DAY = 5;
const paise = z.number().int().min(0).max(1_000_000).optional();

fareFeedbackRoutes.post('/', async (req, res) => {
  const ctx = auth(req);
  const driverId = requireDriver(ctx);
  const body = parse(
    z.object({
      communityId: z.string().max(40),
      serviceType: z.enum(['REGULAR', 'SHARED']),
      sharedRouteId: z.string().max(40).nullable().optional(),
      sentiment: z.enum(['TOO_LOW', 'FAIR', 'TOO_HIGH']),
      suggestedBaseFarePaise: paise,
      suggestedPerKmPaise: paise,
      suggestedPerSeatPaise: paise,
      comment: z.string().trim().min(5, 'Tell your union why (at least 5 characters)').max(1000),
    }),
    req.body,
  );
  const membership = await prisma.communityMembership.findUnique({ where: { communityId_driverId: { communityId: body.communityId, driverId } } });
  if (membership?.status !== 'APPROVED') throw forbidden('Only approved members can give feedback on this union’s fares');
  const routeId = body.serviceType === 'SHARED' ? body.sharedRouteId ?? null : null;
  if (body.serviceType === 'SHARED') {
    if (!routeId) throw unprocessable('Choose the shared route', 'ROUTE_REQUIRED');
    if (!(await prisma.sharedRoute.findFirst({ where: { id: routeId, communityId: body.communityId } }))) throw notFound('Route');
  }
  const today = await prisma.fareFeedback.count({ where: { driverId, createdAt: { gt: new Date(Date.now() - 86_400_000) } } });
  if (today >= MAX_FEEDBACK_PER_DAY) throw unprocessable(`You can send up to ${MAX_FEEDBACK_PER_DAY} fare feedback messages a day`, 'FEEDBACK_LIMIT');
  const rule = await findActiveRule(body.communityId, body.serviceType, routeId);
  const feedback = await prisma.fareFeedback.create({
    data: {
      communityId: body.communityId,
      driverId,
      serviceType: body.serviceType,
      sharedRouteId: routeId,
      fareRuleId: rule?.id ?? null,
      sentiment: body.sentiment,
      suggestedBaseFarePaise: body.serviceType === 'REGULAR' ? body.suggestedBaseFarePaise : undefined,
      suggestedPerKmPaise: body.serviceType === 'REGULAR' ? body.suggestedPerKmPaise : undefined,
      suggestedPerSeatPaise: body.serviceType === 'SHARED' ? body.suggestedPerSeatPaise : undefined,
      comment: body.comment,
    },
  });
  await audit({ action: 'fare.feedback_given', entityType: 'FareFeedback', entityId: feedback.id, communityId: body.communityId, after: { sentiment: body.sentiment, serviceType: body.serviceType } }, { ctx, req });
  const reviewers = await prisma.communityAdmin.findMany({ where: { communityId: body.communityId, active: true, role: { in: ['LOCAL_ADMIN', 'APPROVER'] } }, select: { userId: true } });
  await notify(reviewers.map((r) => r.userId), {
    type: 'FARE_FEEDBACK',
    title: 'New fare feedback from a driver',
    body: `${body.sentiment.replace('_', ' ').toLowerCase()}: ${body.comment.slice(0, 120)}`,
    link: `/community/${body.communityId}/feedback`,
  });
  created(res, feedback);
});

fareFeedbackRoutes.get('/mine', async (req, res) => {
  const driverId = requireDriver(auth(req));
  ok(
    res,
    await prisma.fareFeedback.findMany({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { community: { select: { name: true } } },
    }),
  );
});

/** The union's view: every driver's feedback plus a summary of how drivers feel about current fares. */
fareFeedbackRoutes.get('/communities/:communityId', async (req, res) => {
  const ctx = auth(req);
  const cid = param(req, 'communityId');
  assertCommunityPermission(ctx, cid, 'community.feedback.manage');
  const q = parse(z.object({ status: z.enum(['OPEN', 'ACKNOWLEDGED', 'ADOPTED', 'DECLINED']).optional() }), req.query);
  const [items, bySentiment, suggestions] = await Promise.all([
    prisma.fareFeedback.findMany({
      where: { communityId: cid, ...(q.status ? { status: q.status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { driver: { select: { id: true, user: { select: { name: true } } } } },
    }),
    prisma.fareFeedback.groupBy({ by: ['serviceType', 'sentiment'], where: { communityId: cid, status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, _count: true }),
    prisma.fareFeedback.aggregate({
      where: { communityId: cid, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      _avg: { suggestedBaseFarePaise: true, suggestedPerKmPaise: true, suggestedPerSeatPaise: true },
      _count: { suggestedBaseFarePaise: true, suggestedPerKmPaise: true, suggestedPerSeatPaise: true },
    }),
  ]);
  const routes = await prisma.sharedRoute.findMany({ where: { communityId: cid }, select: { id: true, code: true } });
  const codes = new Map(routes.map((r) => [r.id, r.code]));
  ok(res, items.map((f) => ({ ...f, routeCode: f.sharedRouteId ? (codes.get(f.sharedRouteId) ?? null) : null })), {
    summary: {
      bySentiment: bySentiment.map((b) => ({ serviceType: b.serviceType, sentiment: b.sentiment, count: b._count })),
      averageSuggestion: {
        baseFarePaise: suggestions._avg.suggestedBaseFarePaise ? Math.round(suggestions._avg.suggestedBaseFarePaise) : null,
        perKmPaise: suggestions._avg.suggestedPerKmPaise ? Math.round(suggestions._avg.suggestedPerKmPaise) : null,
        perSeatPaise: suggestions._avg.suggestedPerSeatPaise ? Math.round(suggestions._avg.suggestedPerSeatPaise) : null,
        counts: suggestions._count,
      },
    },
  });
});

fareFeedbackRoutes.patch('/:id', async (req, res) => {
  const ctx = auth(req);
  const { id } = parse(IdParam, req.params);
  const body = parse(
    z.object({
      status: z.enum(['ACKNOWLEDGED', 'ADOPTED', 'DECLINED']),
      response: z.string().trim().min(3, 'Reply to the driver').max(1000),
      proposalId: z.string().max(40).optional(),
    }),
    req.body,
  );
  const fb = await prisma.fareFeedback.findUnique({ where: { id }, include: { driver: { select: { userId: true } } } });
  if (!fb) throw notFound('Feedback');
  assertCommunityPermission(ctx, fb.communityId, 'community.feedback.manage');
  if (body.proposalId && !(await prisma.governanceProposal.findFirst({ where: { id: body.proposalId, communityId: fb.communityId } }))) throw notFound('Proposal');
  const updated = await prisma.fareFeedback.update({
    where: { id },
    data: { status: body.status, response: body.response, respondedById: ctx.userId, respondedAt: new Date(), proposalId: body.proposalId ?? fb.proposalId },
  });
  await audit({ action: 'fare.feedback_answered', entityType: 'FareFeedback', entityId: id, communityId: fb.communityId, before: { status: fb.status }, after: body }, { ctx, req });
  await notify(fb.driver.userId, {
    type: 'FARE_FEEDBACK_REPLY',
    title: `Your union replied to your fare feedback (${body.status.toLowerCase()})`,
    body: body.response,
    link: '/driver/fares',
  });
  ok(res, updated);
});
