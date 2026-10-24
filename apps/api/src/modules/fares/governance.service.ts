import type { CommunityPolicy, FareProposal, GovernanceProposal, ServiceType } from '@prisma/client';
import type { Request } from 'express';
import { prisma, withTransaction, type Db, type Tx } from '../../db.js';
import { conflict, forbidden, notFound, unprocessable } from '../../utils/errors.js';
import { addMinutes } from '../../utils/time.js';
import { audit } from '../audit/audit.service.js';
import { assertCommunityPermission, isSuperAdmin, type AuthContext } from '../auth/auth-context.js';
import { communityAdminUserIds, notify, superAdminUserIds } from '../notifications/notification.service.js';
import { findActiveRule } from './fare.service.js';

export const FARE_FIELDS = [
  'baseFarePaise',
  'baseDistanceMeters',
  'perKmPaise',
  'minimumFarePaise',
  'waitingPerMinutePaise',
  'freeWaitingMinutes',
  'perSeatPaise',
  'perStopPaise',
  'nightSurchargeBps',
  'nightStartHour',
  'nightEndHour',
] as const;
type FareFields = Record<(typeof FARE_FIELDS)[number], number>;

/** Price components compared when measuring an increase (structure fields excluded). */
const PRICE_FIELDS = ['baseFarePaise', 'perKmPaise', 'minimumFarePaise', 'perSeatPaise', 'perStopPaise', 'waitingPerMinutePaise'] as const;

export interface FareCaps {
  maxBaseFarePaise: number;
  maxPerKmPaise: number;
  maxMinimumFarePaise: number;
  maxPerSeatPaise: number;
  maxPerStopPaise: number;
  maxNightSurchargeBps: number;
  maxWaitingPerMinutePaise: number;
}

/** Platform-configured regulatory ceilings (platform_settings.fare_caps). */
export const DEFAULT_FARE_CAPS: FareCaps = {
  maxBaseFarePaise: 10_000,
  maxPerKmPaise: 3_000,
  maxMinimumFarePaise: 10_000,
  maxPerSeatPaise: 10_000,
  maxPerStopPaise: 2_000,
  maxNightSurchargeBps: 5_000,
  maxWaitingPerMinutePaise: 300,
};

export async function getFareCaps(db: Db = prisma): Promise<FareCaps> {
  const row = await db.platformSetting.findUnique({ where: { key: 'fare_caps' } });
  return { ...DEFAULT_FARE_CAPS, ...((row?.value as Partial<FareCaps>) ?? {}) };
}

export async function getPolicy(communityId: string, db: Db = prisma): Promise<CommunityPolicy> {
  return (
    (await db.communityPolicy.findUnique({ where: { communityId } })) ??
    (await db.communityPolicy.create({ data: { communityId } }))
  );
}

/** Pure validation of a proposed fare against platform caps and community policy. */
export function validateFareProposal(
  fare: FareFields & { serviceType: ServiceType },
  caps: FareCaps,
  policy: Pick<CommunityPolicy, 'allowDistanceFares' | 'maxFareIncreasePercent'>,
  previous: Partial<FareFields> | null,
): { violations: string[]; maxIncreasePercent: number; exceedsIncreaseLimit: boolean } {
  const v: string[] = [];
  const over = (field: keyof FareFields, cap: number, label: string) => {
    if (fare[field] > cap) v.push(`${label} exceeds the permitted maximum of ₹${cap / 100}`);
  };
  if (fare.serviceType === 'REGULAR') {
    over('baseFarePaise', caps.maxBaseFarePaise, 'Base fare');
    over('perKmPaise', caps.maxPerKmPaise, 'Per-km rate');
    over('minimumFarePaise', caps.maxMinimumFarePaise, 'Minimum fare');
    if (!policy.allowDistanceFares && fare.perKmPaise > 0) v.push('Distance-based fares are not permitted for this community');
    if (fare.baseFarePaise <= 0 && fare.minimumFarePaise <= 0) v.push('A regular fare needs a base or minimum fare');
  } else {
    over('perSeatPaise', caps.maxPerSeatPaise, 'Per-seat fare');
    over('perStopPaise', caps.maxPerStopPaise, 'Per-stop increment');
    if (fare.perSeatPaise <= 0) v.push('A shared fare needs a per-seat amount');
  }
  over('waitingPerMinutePaise', caps.maxWaitingPerMinutePaise, 'Waiting charge');
  if (fare.nightSurchargeBps > caps.maxNightSurchargeBps) v.push(`Night surcharge exceeds ${caps.maxNightSurchargeBps / 100}%`);
  for (const f of ['nightStartHour', 'nightEndHour'] as const) {
    if (fare[f] < 0 || fare[f] > 23) v.push('Night hours must be between 0 and 23');
  }

  let maxIncrease = 0;
  if (previous) {
    for (const f of PRICE_FIELDS) {
      const before = previous[f] ?? 0;
      if (before > 0 && fare[f] > before) maxIncrease = Math.max(maxIncrease, ((fare[f] - before) / before) * 100);
    }
  }
  return {
    violations: [...new Set(v)],
    maxIncreasePercent: Math.round(maxIncrease * 10) / 10,
    exceedsIncreaseLimit: maxIncrease > policy.maxFareIncreasePercent,
  };
}

export interface FareProposalInput extends FareFields {
  serviceType: ServiceType;
  sharedRouteId?: string | null;
  title: string;
  rationale?: string;
  effectiveFrom: Date;
}

export async function createFareProposal(ctx: AuthContext, communityId: string, input: FareProposalInput, req?: Request) {
  assertCommunityPermission(ctx, communityId, 'community.fares.propose');
  const policy = await getPolicy(communityId);
  const routeId = input.serviceType === 'SHARED' ? input.sharedRouteId ?? null : null;
  if (input.serviceType === 'SHARED') {
    if (!routeId) throw unprocessable('Shared fares must specify a route', 'ROUTE_REQUIRED');
    const route = await prisma.sharedRoute.findFirst({ where: { id: routeId, communityId } });
    if (!route) throw notFound('Route');
  }
  const minEffective = addMinutes(new Date(), policy.minNoticeHours * 60 - 1);
  if (input.effectiveFrom < minEffective) {
    throw unprocessable(`Fare changes need at least ${policy.minNoticeHours} hours notice`, 'NOTICE_PERIOD');
  }
  const previous = await findActiveRule(communityId, input.serviceType, routeId);
  const caps = await getFareCaps();
  const check = validateFareProposal(input, caps, policy, previous);
  if (check.violations.length) throw unprocessable('Fare proposal violates platform limits', 'FARE_LIMIT', check.violations);

  const duplicate = await prisma.governanceProposal.findFirst({
    where: { communityId, status: 'PENDING', type: 'FARE_CHANGE', fareProposal: { serviceType: input.serviceType, sharedRouteId: routeId } },
  });
  if (duplicate) throw conflict('A fare proposal for this service is already pending', 'PROPOSAL_PENDING');

  const requiresPlatformReview = policy.fareApprovalMode === 'PLATFORM_REVIEW' || check.exceedsIncreaseLimit;
  const fareData = Object.fromEntries(FARE_FIELDS.map((f) => [f, input[f]])) as FareFields;
  const proposal = await prisma.governanceProposal.create({
    data: {
      communityId,
      type: 'FARE_CHANGE',
      title: input.title,
      rationale: input.rationale,
      proposedById: ctx.userId,
      requiredApprovals: policy.fareApprovalMode === 'SINGLE_APPROVER' ? 1 : policy.requiredApprovals,
      requiresPlatformReview,
      effectiveFrom: input.effectiveFrom,
      fareProposal: {
        create: { serviceType: input.serviceType, sharedRouteId: routeId, previousFareRuleId: previous?.id ?? null, ...fareData },
      },
    },
    include: { fareProposal: true },
  });
  await audit(
    {
      action: 'fare.proposal_created',
      entityType: 'GovernanceProposal',
      entityId: proposal.id,
      communityId,
      after: { ...fareData, serviceType: input.serviceType, sharedRouteId: routeId, effectiveFrom: input.effectiveFrom, requiresPlatformReview, maxIncreasePercent: check.maxIncreasePercent },
    },
    { ctx, req },
  );

  const approvers = await prisma.communityAdmin.findMany({
    where: { communityId, active: true, role: { in: ['HEAD', 'APPROVER'] } },
    select: { userId: true },
  });
  await notify(
    approvers.map((a) => a.userId).filter((id) => id !== ctx.userId),
    { type: 'FARE_PROPOSAL', title: 'Fare proposal awaiting review', body: input.title, link: `/community/${communityId}/fares` },
  );
  if (requiresPlatformReview) {
    await notify(await superAdminUserIds(), {
      type: 'FARE_REVIEW',
      title: 'Fare proposal needs platform review',
      body: check.exceedsIncreaseLimit ? `Increase of ${check.maxIncreasePercent}% exceeds the community limit` : input.title,
      link: '/admin/fare-reviews',
    });
  }
  return { ...proposal, validation: check };
}

async function lockProposal(tx: Tx, proposalId: string) {
  await tx.$queryRaw`SELECT id FROM governance_proposals WHERE id = ${proposalId} FOR UPDATE`;
  const proposal = await tx.governanceProposal.findUnique({ where: { id: proposalId }, include: { fareProposal: true, votes: true } });
  if (!proposal) throw notFound('Proposal');
  return proposal;
}

function isReadyToApply(p: GovernanceProposal & { votes: { decision: string }[] }) {
  const approvals = p.votes.filter((v) => v.decision === 'APPROVE').length;
  return approvals >= p.requiredApprovals && (!p.requiresPlatformReview || p.platformDecision === 'APPROVED');
}

export async function voteOnProposal(
  ctx: AuthContext,
  proposalId: string,
  decision: 'APPROVE' | 'REJECT',
  comment: string | undefined,
  req?: Request,
) {
  const result = await withTransaction(async (tx) => {
    const proposal = await lockProposal(tx, proposalId);
    assertCommunityPermission(ctx, proposal.communityId, 'community.fares.approve');
    if (proposal.status !== 'PENDING') throw conflict('This proposal is no longer open for voting', 'PROPOSAL_CLOSED');
    const policy = await getPolicy(proposal.communityId, tx);
    if (proposal.proposedById === ctx.userId && !policy.allowSelfApproval) {
      throw forbidden('Community policy does not allow approving your own proposal');
    }
    if (proposal.votes.some((v) => v.voterId === ctx.userId)) throw conflict('You have already voted on this proposal', 'ALREADY_VOTED');
    await tx.governanceVote.create({ data: { proposalId, voterId: ctx.userId, decision, comment } });
    await audit({ action: `fare.proposal_vote_${decision.toLowerCase()}`, entityType: 'GovernanceProposal', entityId: proposalId, communityId: proposal.communityId, after: { decision, comment } }, { ctx, req }, tx);

    // Default governance rule: any authorised approver can veto.
    if (decision === 'REJECT') {
      await tx.governanceProposal.update({ where: { id: proposalId }, data: { status: 'REJECTED', decidedAt: new Date() } });
      return { status: 'REJECTED' as const, proposal };
    }
    const refreshed = { ...proposal, votes: [...proposal.votes, { decision }] };
    if (isReadyToApply(refreshed)) {
      const rule = await applyFareProposal(tx, proposal, ctx, req);
      return { status: 'APPLIED' as const, proposal, fareRuleId: rule.id };
    }
    return { status: 'PENDING' as const, proposal };
  });
  await afterDecision(result.proposal, result.status);
  return { status: result.status };
}

export async function platformReview(ctx: AuthContext, proposalId: string, decision: 'APPROVED' | 'REJECTED', note: string | undefined, req?: Request) {
  if (!isSuperAdmin(ctx)) throw forbidden();
  const result = await withTransaction(async (tx) => {
    const proposal = await lockProposal(tx, proposalId);
    if (proposal.status !== 'PENDING') throw conflict('This proposal is no longer pending', 'PROPOSAL_CLOSED');
    if (!proposal.requiresPlatformReview) throw conflict('This proposal does not require platform review');
    if (proposal.platformDecision) throw conflict('Platform review already recorded');
    await tx.governanceProposal.update({
      where: { id: proposalId },
      data: {
        platformDecision: decision,
        platformReviewerId: ctx.userId,
        platformReviewNote: note,
        ...(decision === 'REJECTED' ? { status: 'REJECTED', decidedAt: new Date() } : {}),
      },
    });
    await audit({ action: `fare.platform_review_${decision.toLowerCase()}`, entityType: 'GovernanceProposal', entityId: proposalId, communityId: proposal.communityId, after: { decision, note } }, { ctx, req }, tx);
    if (decision === 'REJECTED') return { status: 'REJECTED' as const, proposal };
    if (isReadyToApply({ ...proposal, platformDecision: 'APPROVED' })) {
      await applyFareProposal(tx, proposal, ctx, req);
      return { status: 'APPLIED' as const, proposal };
    }
    return { status: 'PENDING' as const, proposal };
  });
  await afterDecision(result.proposal, result.status);
  return { status: result.status };
}

export async function withdrawProposal(ctx: AuthContext, proposalId: string, req?: Request) {
  const proposal = await prisma.governanceProposal.findUnique({ where: { id: proposalId } });
  if (!proposal) throw notFound('Proposal');
  assertCommunityPermission(ctx, proposal.communityId, 'community.fares.propose');
  if (proposal.proposedById !== ctx.userId && !ctx.communityRoles.some((r) => r.communityId === proposal.communityId && r.role === 'HEAD')) {
    throw forbidden('Only the proposer or the community head can withdraw a proposal');
  }
  const updated = await prisma.governanceProposal.updateMany({ where: { id: proposalId, status: 'PENDING' }, data: { status: 'WITHDRAWN', decidedAt: new Date() } });
  if (updated.count === 0) throw conflict('Only pending proposals can be withdrawn');
  await audit({ action: 'fare.proposal_withdrawn', entityType: 'GovernanceProposal', entityId: proposalId, communityId: proposal.communityId }, { ctx, req });
}

/**
 * Create the new fare-rule version and close the previous one. Existing bookings keep the
 * fare rule (and quoted fare) they were created with, so they are unaffected.
 */
async function applyFareProposal(
  tx: Tx,
  proposal: GovernanceProposal & { fareProposal: FareProposal | null },
  ctx: AuthContext,
  req?: Request,
) {
  const fp = proposal.fareProposal;
  if (!fp) throw conflict('Proposal has no fare details');
  const now = new Date();
  const effectiveFrom = proposal.effectiveFrom > now ? proposal.effectiveFrom : now;
  const scope = { communityId: proposal.communityId, serviceType: fp.serviceType, sharedRouteId: fp.sharedRouteId };

  // Close rules that would overlap the new one.
  await tx.fareRule.updateMany({
    where: { ...scope, effectiveFrom: { lt: effectiveFrom }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }] },
    data: { effectiveTo: effectiveFrom },
  });
  const futureRules = await tx.fareRule.findMany({ where: { ...scope, effectiveFrom: { gte: effectiveFrom }, effectiveTo: null } });
  for (const r of futureRules) await tx.fareRule.update({ where: { id: r.id }, data: { effectiveTo: r.effectiveFrom } });

  const last = await tx.fareRule.findFirst({ where: scope, orderBy: { version: 'desc' }, select: { version: true } });
  const fareData = Object.fromEntries(FARE_FIELDS.map((f) => [f, fp[f]])) as FareFields;
  const rule = await tx.fareRule.create({
    data: { ...scope, ...fareData, version: (last?.version ?? 0) + 1, effectiveFrom, proposalId: proposal.id },
  });
  await tx.fareProposal.update({ where: { id: fp.id }, data: { appliedFareRuleId: rule.id } });
  await tx.governanceProposal.update({ where: { id: proposal.id }, data: { status: 'APPROVED', decidedAt: now } });
  await tx.fareHistory.create({
    data: {
      ...scope,
      fareRuleId: rule.id,
      previousFareRuleId: fp.previousFareRuleId,
      proposalId: proposal.id,
      changedById: ctx.userId,
      summary: { ...fareData, title: proposal.title },
      effectiveFrom,
    },
  });
  await audit({ action: 'fare.rule_published', entityType: 'FareRule', entityId: rule.id, communityId: proposal.communityId, after: { ...fareData, version: rule.version, effectiveFrom } }, { ctx, req }, tx);
  return rule;
}

async function afterDecision(proposal: GovernanceProposal, status: 'APPLIED' | 'REJECTED' | 'PENDING') {
  if (status === 'PENDING') return;
  await notify(proposal.proposedById, {
    type: 'FARE_DECISION',
    title: status === 'APPLIED' ? 'Fare proposal approved' : 'Fare proposal rejected',
    body: proposal.title,
    link: `/community/${proposal.communityId}/fares`,
  });
  if (status === 'APPLIED') {
    const when = proposal.effectiveFrom > new Date() ? proposal.effectiveFrom.toISOString() : 'now';
    await prisma.announcement.create({
      data: {
        communityId: proposal.communityId,
        title: `Fare update: ${proposal.title}`,
        body: `A fare change approved through community governance takes effect ${when === 'now' ? 'immediately' : `on ${when}`}. Confirmed bookings keep their original fare.`,
        audience: 'ALL',
        publishedById: proposal.proposedById,
      },
    });
    const members = await prisma.communityMembership.findMany({
      where: { communityId: proposal.communityId, status: 'APPROVED' },
      select: { driver: { select: { userId: true } } },
    });
    await notify([...members.map((m) => m.driver.userId), ...(await communityAdminUserIds(proposal.communityId))], {
      type: 'FARE_CHANGE',
      title: 'Community fare updated',
      body: proposal.title,
      link: '/fares',
    });
  }
}
