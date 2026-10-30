import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { auth, authenticate } from '../../middleware/auth.js';
import { communityId, requireCommunity } from '../../middleware/community-scope.js';
import { badRequest, conflict, notFound, unprocessable } from '../../utils/errors.js';
import { isValidPolygon } from '../../utils/geo.js';
import { created, ok, pageMeta, pagination, parse, param } from '../../utils/http.js';
import { audit } from '../audit/audit.service.js';
import { communityPermissionsFor } from '../auth/auth-context.js';
import { notify } from '../notifications/notification.service.js';
import { activeFareRules } from '../fares/fare.service.js';
import { createPolicyProposal, GOVERNED_POLICY_FIELDS, OPERATIONAL_POLICY_FIELDS } from '../fares/governance.service.js';
import { PhoneSchema } from '../auth/auth.routes.js';

export const communityRoutes = Router();

// ─────────── Public (no account required) ───────────

communityRoutes.get('/', async (req, res) => {
  const q = parse(z.object({ cityId: z.string().optional(), search: z.string().max(100).optional() }), req.query);
  const items = await prisma.community.findMany({
    where: {
      status: 'ACTIVE',
      ...(q.cityId ? { cityId: q.cityId } : {}),
      ...(q.search ? { name: { contains: q.search } } : {}),
    },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      centerLat: true,
      centerLng: true,
      city: { select: { id: true, name: true, state: true } },
      _count: { select: { sharedRoutes: { where: { status: 'ACTIVE' } } } },
    },
    orderBy: { name: 'asc' },
  });
  ok(res, items);
});

/** Published information: fares, zones, stands and routes. No private driver or booking data. */
communityRoutes.get('/:communityId/public', async (req, res) => {
  const id = communityId(req);
  const community = await prisma.community.findFirst({
    where: { id, status: 'ACTIVE' },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      contactPhone: true,
      centerLat: true,
      centerLng: true,
      city: { select: { name: true, state: true, timezone: true } },
      policy: { select: { cancellationFreeWindowSec: true, cancellationFeePaise: true, allowDistanceFares: true, communityFeeBps: true } },
      serviceAreas: { where: { active: true }, select: { id: true, name: true, polygon: true } },
      pickupPoints: { where: { active: true }, select: { id: true, name: true, lat: true, lng: true, isStand: true, description: true } },
      sharedRoutes: {
        where: { status: 'ACTIVE' },
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          maxSeats: true,
          bookingCutoffMinutes: true,
          cancellationCutoffMinutes: true,
          boardingRules: true,
          stops: {
            orderBy: { sequence: 'asc' },
            select: { id: true, sequence: true, offsetMinutes: true, pickupPoint: { select: { id: true, name: true, lat: true, lng: true } } },
          },
          schedules: { where: { active: true }, select: { id: true, departureTime: true, daysOfWeek: true, seatCapacity: true } },
        },
      },
      announcements: {
        where: { audience: { in: ['ALL', 'PASSENGERS'] } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, title: true, body: true, createdAt: true },
      },
    },
  });
  if (!community) throw notFound('Community');
  ok(res, { ...community, fares: await activeFareRules(id) });
});

// ─────────── Community console ───────────

communityRoutes.use('/:communityId', authenticate);

communityRoutes.get('/:communityId/console', requireCommunity('community.view'), async (req, res) => {
  const id = communityId(req);
  const [community, pendingMembers, pendingVehicles, openComplaints, pendingProposals, onlineDrivers] = await Promise.all([
    prisma.community.findUniqueOrThrow({
      where: { id },
      include: { city: true, policy: true },
    }),
    prisma.communityMembership.count({ where: { communityId: id, status: 'APPLIED' } }),
    prisma.vehicle.count({ where: { communityId: id, status: 'PENDING' } }),
    prisma.complaint.count({ where: { communityId: id, status: { in: ['OPEN', 'IN_REVIEW', 'ESCALATED'] } } }),
    prisma.governanceProposal.count({ where: { communityId: id, status: 'PENDING' } }),
    prisma.driverAvailability.count({ where: { communityId: id, status: { in: ['ONLINE', 'ON_TRIP'] } } }),
  ]);
  ok(res, {
    community,
    permissions: communityPermissionsFor(auth(req), id),
    counts: { pendingMembers, pendingVehicles, openComplaints, pendingProposals, onlineDrivers },
  });
});

const ProfileSchema = z.object({
  name: z.string().trim().min(3).max(150).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  contactPhone: z.string().trim().max(20).nullable().optional(),
  contactEmail: z.string().trim().email().max(191).nullable().optional(),
  registrationNumber: z.string().trim().max(100).nullable().optional(),
  centerLat: z.number().min(-90).max(90).optional(),
  centerLng: z.number().min(-180).max(180).optional(),
});

communityRoutes.patch('/:communityId', requireCommunity('community.profile.edit'), async (req, res) => {
  const id = communityId(req);
  const data = parse(ProfileSchema, req.body);
  const before = await prisma.community.findUniqueOrThrow({ where: { id } });
  const updated = await prisma.community.update({ where: { id }, data });
  await audit({ action: 'community.profile_updated', entityType: 'Community', entityId: id, communityId: id, before, after: data }, { ctx: req.auth, req });
  ok(res, updated);
});

// ─────────── Policy ───────────

const PolicySchema = z
  .object({
    fareApprovalMode: z.enum(['SINGLE_APPROVER', 'MULTI_APPROVER', 'PLATFORM_REVIEW']),
    requiredApprovals: z.number().int().min(1).max(10),
    allowSelfApproval: z.boolean(),
    minNoticeHours: z.number().int().min(0).max(24 * 30),
    cancellationFreeWindowSec: z.number().int().min(0).max(3600),
    cancellationFeePaise: z.number().int().min(0).max(50_000),
    driverOfferTimeoutSec: z.number().int().min(10).max(300),
    bookingRequestTimeoutSec: z.number().int().min(60).max(1800),
    seatHoldMinutes: z.number().int().min(1).max(30),
  })
  .partial();

communityRoutes.get('/:communityId/policy', requireCommunity('community.view'), async (req, res) => {
  ok(res, await prisma.communityPolicy.findUnique({ where: { communityId: communityId(req) } }));
});

/**
 * Community heads can tune operational settings directly. Governance rules and passenger
 * charges change only through an approved policy proposal (POST …/policy-proposals).
 * Platform-controlled limits (maxFareIncreasePercent, allowDistanceFares, communityFeeBps)
 * are set only via /admin.
 */
communityRoutes.put('/:communityId/policy', requireCommunity('community.policy.edit'), async (req, res) => {
  const id = communityId(req);
  const parsed = parse(PolicySchema, req.body);
  const governed = GOVERNED_POLICY_FIELDS.filter((f) => parsed[f] !== undefined);
  if (governed.length) {
    throw unprocessable('These rules change only through a community proposal and vote', 'GOVERNANCE_REQUIRED', governed);
  }
  const data = Object.fromEntries(OPERATIONAL_POLICY_FIELDS.filter((f) => parsed[f] !== undefined).map((f) => [f, parsed[f]]));
  const before = await prisma.communityPolicy.findUnique({ where: { communityId: id } });
  const policy = await prisma.communityPolicy.upsert({ where: { communityId: id }, create: { communityId: id, ...data }, update: data });
  await audit({ action: 'community.policy_updated', entityType: 'CommunityPolicy', entityId: policy.id, communityId: id, before, after: data }, { ctx: req.auth, req });
  ok(res, policy);
});

const PolicyProposalSchema = z.object({
  title: z.string().trim().min(5).max(200),
  rationale: z.string().trim().max(5000).optional(),
  changes: PolicySchema.pick({
    fareApprovalMode: true,
    requiredApprovals: true,
    allowSelfApproval: true,
    minNoticeHours: true,
    cancellationFreeWindowSec: true,
    cancellationFeePaise: true,
  }),
});

/** Propose a change to governance rules or passenger charges; approvers vote on it like a fare. */
communityRoutes.post('/:communityId/policy-proposals', requireCommunity('community.fares.propose'), async (req, res) => {
  const body = parse(PolicyProposalSchema, req.body);
  created(res, await createPolicyProposal(auth(req), communityId(req), body, req));
});

// ─────────── Service areas ───────────

const AreaSchema = z.object({
  name: z.string().trim().min(2).max(150),
  polygon: z.array(z.tuple([z.number(), z.number()])).min(3).max(500),
  active: z.boolean().optional(),
});

communityRoutes.get('/:communityId/service-areas', requireCommunity('community.view'), async (req, res) => {
  ok(res, await prisma.communityServiceArea.findMany({ where: { communityId: communityId(req) }, orderBy: { createdAt: 'asc' } }));
});

communityRoutes.post('/:communityId/service-areas', requireCommunity('community.areas.manage'), async (req, res) => {
  const id = communityId(req);
  const data = parse(AreaSchema, req.body);
  if (!isValidPolygon(data.polygon)) throw badRequest('Polygon coordinates are invalid');
  const area = await prisma.communityServiceArea.create({ data: { ...data, communityId: id } });
  await audit({ action: 'service_area.created', entityType: 'CommunityServiceArea', entityId: area.id, communityId: id, after: { name: area.name } }, { ctx: req.auth, req });
  created(res, area);
});

communityRoutes.patch('/:communityId/service-areas/:areaId', requireCommunity('community.areas.manage'), async (req, res) => {
  const id = communityId(req);
  const data = parse(AreaSchema.partial(), req.body);
  if (data.polygon && !isValidPolygon(data.polygon)) throw badRequest('Polygon coordinates are invalid');
  const existing = await prisma.communityServiceArea.findFirst({ where: { id: param(req, 'areaId'), communityId: id } });
  if (!existing) throw notFound('Service area');
  const area = await prisma.communityServiceArea.update({ where: { id: existing.id }, data });
  await audit({ action: 'service_area.updated', entityType: 'CommunityServiceArea', entityId: area.id, communityId: id, before: { name: existing.name, active: existing.active }, after: data }, { ctx: req.auth, req });
  ok(res, area);
});

communityRoutes.delete('/:communityId/service-areas/:areaId', requireCommunity('community.areas.manage'), async (req, res) => {
  const id = communityId(req);
  const existing = await prisma.communityServiceArea.findFirst({ where: { id: param(req, 'areaId'), communityId: id } });
  if (!existing) throw notFound('Service area');
  await prisma.communityServiceArea.delete({ where: { id: existing.id } });
  await audit({ action: 'service_area.deleted', entityType: 'CommunityServiceArea', entityId: existing.id, communityId: id, before: existing }, { ctx: req.auth, req });
  ok(res, { deleted: true });
});

// ─────────── Community administrators ───────────

communityRoutes.get('/:communityId/admins', requireCommunity('community.view'), async (req, res) => {
  const admins = await prisma.communityAdmin.findMany({
    where: { communityId: communityId(req) },
    select: { id: true, role: true, active: true, createdAt: true, user: { select: { id: true, name: true, phone: true } } },
    orderBy: { createdAt: 'asc' },
  });
  ok(res, admins);
});

communityRoutes.post('/:communityId/admins', requireCommunity('community.admins.manage'), async (req, res) => {
  const id = communityId(req);
  const body = parse(z.object({ phone: PhoneSchema, role: z.enum(['HEAD', 'ADMIN', 'APPROVER', 'OPERATOR']) }), req.body);
  const user = await prisma.user.findUnique({ where: { phone: body.phone } });
  if (!user) throw notFound('User with this phone number');
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'COMMUNITY_ADMIN' } });
  const assignment = await prisma.$transaction(async (tx) => {
    await tx.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, create: { userId: user.id, roleId: role.id }, update: {} });
    return tx.communityAdmin.upsert({
      where: { communityId_userId: { communityId: id, userId: user.id } },
      create: { communityId: id, userId: user.id, role: body.role, assignedById: auth(req).userId },
      update: { role: body.role, active: true, assignedById: auth(req).userId },
    });
  });
  await audit({ action: 'community.admin_assigned', entityType: 'CommunityAdmin', entityId: assignment.id, communityId: id, after: { userId: user.id, role: body.role } }, { ctx: req.auth, req });
  await notify(user.id, { type: 'COMMUNITY_ROLE', title: 'Community role assigned', body: `You are now ${body.role} for this community.`, link: `/community/${id}` });
  created(res, assignment);
});

communityRoutes.delete('/:communityId/admins/:adminId', requireCommunity('community.admins.manage'), async (req, res) => {
  const id = communityId(req);
  const existing = await prisma.communityAdmin.findFirst({ where: { id: param(req, 'adminId'), communityId: id } });
  if (!existing) throw notFound('Administrator');
  if (existing.userId === auth(req).userId) throw conflict('You cannot remove your own administrator role');
  await prisma.communityAdmin.update({ where: { id: existing.id }, data: { active: false } });
  await audit({ action: 'community.admin_removed', entityType: 'CommunityAdmin', entityId: existing.id, communityId: id, before: { userId: existing.userId, role: existing.role } }, { ctx: req.auth, req });
  ok(res, { removed: true });
});

// ─────────── Announcements ───────────

communityRoutes.get('/:communityId/announcements', requireCommunity('community.view'), async (req, res) => {
  ok(res, await prisma.announcement.findMany({ where: { communityId: communityId(req) }, orderBy: { createdAt: 'desc' }, take: 50 }));
});

communityRoutes.post('/:communityId/announcements', requireCommunity('community.announcements.manage'), async (req, res) => {
  const id = communityId(req);
  const body = parse(
    z.object({ title: z.string().trim().min(3).max(200), body: z.string().trim().min(3).max(5000), audience: z.enum(['ALL', 'DRIVERS', 'PASSENGERS']).default('ALL') }),
    req.body,
  );
  const announcement = await prisma.announcement.create({ data: { ...body, communityId: id, publishedById: auth(req).userId } });
  await audit({ action: 'announcement.published', entityType: 'Announcement', entityId: announcement.id, communityId: id, after: { title: body.title, audience: body.audience } }, { ctx: req.auth, req });
  if (body.audience !== 'PASSENGERS') {
    const members = await prisma.communityMembership.findMany({
      where: { communityId: id, status: 'APPROVED' },
      select: { driver: { select: { userId: true } } },
    });
    await notify(members.map((m) => m.driver.userId), { type: 'ANNOUNCEMENT', title: body.title, body: body.body.slice(0, 300), link: '/driver/community' });
  }
  created(res, announcement);
});

// ─────────── Audit history ───────────

communityRoutes.get('/:communityId/audit-logs', requireCommunity('community.audit.view'), async (req, res) => {
  const { page, pageSize, skip, take } = pagination(req);
  const where = { communityId: communityId(req) };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, include: { actor: { select: { name: true } } } }),
    prisma.auditLog.count({ where }),
  ]);
  ok(res, items, pageMeta(page, pageSize, total));
});
