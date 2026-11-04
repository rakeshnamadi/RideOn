import { Prisma, type CommunityRole } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { auth, authenticate } from '../../middleware/auth.js';
import { communityId, requireCommunity } from '../../middleware/community-scope.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../utils/errors.js';
import { isValidPolygon } from '../../utils/geo.js';
import { created, ok, pageMeta, pagination, parse, param } from '../../utils/http.js';
import { audit } from '../audit/audit.service.js';
import { communityPermissionsFor, communityRoleOf, isLocalAdmin, isSuperAdmin, type AuthContext } from '../auth/auth-context.js';
import { deletePrivateFile, detectMime, logoUpload, readPrivateFile, storePrivateFile } from '../../services/uploads.js';
import {
  assignmentPermissions,
  COMMUNITY_PERMISSION_LABELS,
  COMMUNITY_PERMISSIONS,
  COMMUNITY_ROLE_PERMISSIONS,
  DELEGABLE_PERMISSIONS,
  DELEGABLE_ROLES,
  LOCAL_ADMIN_ONLY_PERMISSIONS,
  type CommunityPermission,
} from '../auth/permissions.js';
import { notify } from '../notifications/notification.service.js';
import { activeFareRules } from '../fares/fare.service.js';
import { withLogoUrl } from './branding.js';
import { backfillRoutePaths } from './route-path.js';
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
      shortName: true,
      tagline: true,
      brandColor: true,
      logoUpdatedAt: true,
      centerLat: true,
      centerLng: true,
      city: { select: { id: true, name: true, state: true } },
      _count: { select: { sharedRoutes: { where: { status: 'ACTIVE' } } } },
    },
    orderBy: { name: 'asc' },
  });
  ok(res, items.map(withLogoUrl));
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
      contactEmail: true,
      shortName: true,
      tagline: true,
      address: true,
      pincode: true,
      foundedYear: true,
      brandColor: true,
      logoUpdatedAt: true,
      registrationNumber: true,
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
          pathGeometry: true,
          pathDistanceMeters: true,
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
  backfillRoutePaths(community.sharedRoutes);
  ok(res, { ...withLogoUrl(community), fares: await activeFareRules(id) });
});

/** A union's logo. Public: it appears on fare pages and booking screens. */
communityRoutes.get('/:communityId/logo', async (req, res) => {
  const c = await prisma.community.findUnique({ where: { id: communityId(req) }, select: { logoKey: true, logoMime: true } });
  if (!c?.logoKey || !c.logoMime) throw notFound('Logo');
  const file = await readPrivateFile(c.logoKey);
  res.setHeader('Content-Type', c.logoMime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.send(file);
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
    community: withLogoUrl(community),
    role: communityRoleOf(auth(req), id),
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
  shortName: z.string().trim().max(40).nullable().optional(),
  tagline: z.string().trim().max(200).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a 6-digit Indian pincode').nullable().optional(),
  foundedYear: z.number().int().min(1900).max(new Date().getFullYear()).nullable().optional(),
  brandColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #0F4D3A').nullable().optional(),
  centerLat: z.number().min(-90).max(90).optional(),
  centerLng: z.number().min(-180).max(180).optional(),
});

communityRoutes.patch('/:communityId', requireCommunity('community.profile.edit'), async (req, res) => {
  const id = communityId(req);
  const data = parse(ProfileSchema, req.body);
  const before = await prisma.community.findUniqueOrThrow({ where: { id } });
  const updated = await prisma.community.update({ where: { id }, data });
  await audit({ action: 'community.profile_updated', entityType: 'Community', entityId: id, communityId: id, before, after: data }, { ctx: req.auth, req });
  ok(res, withLogoUrl(updated));
});

communityRoutes.post('/:communityId/logo', requireCommunity('community.profile.edit'), logoUpload.single('logo'), async (req, res) => {
  const id = communityId(req);
  if (!req.file) throw badRequest('Attach an image in the "logo" field');
  const mime = detectMime(req.file.buffer);
  if (mime !== 'image/png' && mime !== 'image/jpeg') throw badRequest('Logos must be PNG or JPEG images');
  const before = await prisma.community.findUniqueOrThrow({ where: { id }, select: { logoKey: true } });
  const { storageKey, mimeType } = await storePrivateFile(req.file.buffer);
  const updated = await prisma.community.update({ where: { id }, data: { logoKey: storageKey, logoMime: mimeType, logoUpdatedAt: new Date() } });
  await deletePrivateFile(before.logoKey);
  await audit({ action: 'community.logo_updated', entityType: 'Community', entityId: id, communityId: id, after: { sizeBytes: req.file.size, mimeType } }, { ctx: req.auth, req });
  ok(res, withLogoUrl(updated));
});

communityRoutes.delete('/:communityId/logo', requireCommunity('community.profile.edit'), async (req, res) => {
  const id = communityId(req);
  const before = await prisma.community.findUniqueOrThrow({ where: { id }, select: { logoKey: true } });
  await prisma.community.update({ where: { id }, data: { logoKey: null, logoMime: null, logoUpdatedAt: null } });
  await deletePrivateFile(before.logoKey);
  await audit({ action: 'community.logo_removed', entityType: 'Community', entityId: id, communityId: id }, { ctx: req.auth, req });
  ok(res, { removed: true });
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

// ─────────── Union team: roles and delegated permissions ───────────

const RoleSchema = z.enum(['LOCAL_ADMIN', 'REPORTER', 'APPROVER', 'OPERATOR']);
const PermissionListSchema = z.array(z.enum(COMMUNITY_PERMISSIONS)).max(COMMUNITY_PERMISSIONS.length).nullable();

/**
 * Who may assign or edit a role: the platform super admin, any role; a local admin, only
 * the roles below them (local admins are appointed by the platform).
 */
function assertCanManageRole(ctx: AuthContext, communityId: string, role: CommunityRole) {
  if (isSuperAdmin(ctx)) return;
  if (!isLocalAdmin(ctx, communityId)) throw forbidden('Only a local admin can manage the union team');
  if (!(DELEGABLE_ROLES as readonly string[]).includes(role)) throw forbidden('Only the platform can appoint local admins');
}

function validateCustomPermissions(role: CommunityRole, permissions: string[] | null | undefined) {
  if (permissions === undefined || permissions === null) return permissions;
  if (role === 'LOCAL_ADMIN') throw unprocessable('Local admins always have every permission', 'INVALID_PERMISSIONS');
  const forbiddenOnes = permissions.filter((p) => LOCAL_ADMIN_ONLY_PERMISSIONS.includes(p as CommunityPermission));
  if (forbiddenOnes.length) throw unprocessable('These permissions stay with local admins', 'INVALID_PERMISSIONS', forbiddenOnes);
  return [...new Set(permissions)];
}

function teamView(a: { id: string; role: CommunityRole; permissions: unknown; active: boolean; createdAt: Date; user: { id: string; name: string; phone: string } }) {
  return { ...a, customPermissions: Array.isArray(a.permissions) ? a.permissions : null, permissions: assignmentPermissions(a.role, a.permissions) };
}

/** Catalogue the team screen needs: labels, role defaults, and what may be delegated. */
communityRoutes.get('/:communityId/team-catalog', requireCommunity('community.view'), async (req, res) => {
  const ctx = auth(req);
  const id = communityId(req);
  ok(res, {
    permissions: COMMUNITY_PERMISSIONS.map((key) => ({ key, label: COMMUNITY_PERMISSION_LABELS[key], delegable: DELEGABLE_PERMISSIONS.includes(key) })),
    roleDefaults: COMMUNITY_ROLE_PERMISSIONS,
    assignableRoles: isSuperAdmin(ctx) ? RoleSchema.options : isLocalAdmin(ctx, id) ? DELEGABLE_ROLES : [],
  });
});

communityRoutes.get('/:communityId/admins', requireCommunity('community.view'), async (req, res) => {
  const admins = await prisma.communityAdmin.findMany({
    where: { communityId: communityId(req) },
    select: { id: true, role: true, permissions: true, active: true, createdAt: true, user: { select: { id: true, name: true, phone: true } } },
    orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
  });
  ok(res, admins.map(teamView));
});

communityRoutes.post('/:communityId/admins', requireCommunity('community.admins.manage'), async (req, res) => {
  const ctx = auth(req);
  const id = communityId(req);
  const body = parse(z.object({ phone: PhoneSchema, role: RoleSchema, permissions: PermissionListSchema.optional() }), req.body);
  assertCanManageRole(ctx, id, body.role);
  const permissions = validateCustomPermissions(body.role, body.permissions);
  const user = await prisma.user.findUnique({ where: { phone: body.phone } });
  if (!user) throw notFound('User with this phone number');
  if (user.status !== 'ACTIVE') throw unprocessable('This account is not active', 'USER_INACTIVE');
  const existing = await prisma.communityAdmin.findUnique({ where: { communityId_userId: { communityId: id, userId: user.id } } });
  if (existing?.active) assertCanManageRole(ctx, id, existing.role);
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'COMMUNITY_ADMIN' } });
  const jsonPermissions = permissions ? (permissions as Prisma.InputJsonValue) : Prisma.DbNull;
  const assignment = await prisma.$transaction(async (tx) => {
    await tx.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, create: { userId: user.id, roleId: role.id }, update: {} });
    return tx.communityAdmin.upsert({
      where: { communityId_userId: { communityId: id, userId: user.id } },
      create: { communityId: id, userId: user.id, role: body.role, permissions: jsonPermissions, assignedById: ctx.userId },
      update: { role: body.role, permissions: jsonPermissions, active: true, assignedById: ctx.userId },
      select: { id: true, role: true, permissions: true, active: true, createdAt: true, user: { select: { id: true, name: true, phone: true } } },
    });
  });
  await audit({ action: 'community.admin_assigned', entityType: 'CommunityAdmin', entityId: assignment.id, communityId: id, before: existing ? { role: existing.role, active: existing.active } : null, after: { userId: user.id, role: body.role, permissions } }, { ctx, req });
  await notify(user.id, { type: 'COMMUNITY_ROLE', title: 'Union role assigned', body: `You are now ${body.role.replace('_', ' ').toLowerCase()} for this union.`, link: `/community/${id}` });
  created(res, teamView(assignment));
});

/** Edit a delegate: change their role, or switch individual permissions on or off. */
communityRoutes.patch('/:communityId/admins/:adminId', requireCommunity('community.admins.manage'), async (req, res) => {
  const ctx = auth(req);
  const id = communityId(req);
  const body = parse(z.object({ role: RoleSchema.optional(), permissions: PermissionListSchema.optional() }), req.body);
  const existing = await prisma.communityAdmin.findFirst({ where: { id: param(req, 'adminId'), communityId: id, active: true } });
  if (!existing) throw notFound('Team member');
  if (existing.userId === ctx.userId && !isSuperAdmin(ctx)) throw conflict('You cannot change your own role');
  assertCanManageRole(ctx, id, existing.role);
  const nextRole = body.role ?? existing.role;
  assertCanManageRole(ctx, id, nextRole);
  // Changing role without a permission list resets to the new role's defaults.
  const permissions = body.permissions !== undefined ? validateCustomPermissions(nextRole, body.permissions) : body.role ? null : (existing.permissions as string[] | null);
  if (nextRole === 'LOCAL_ADMIN' && permissions) throw unprocessable('Local admins always have every permission', 'INVALID_PERMISSIONS');
  const updated = await prisma.communityAdmin.update({
    where: { id: existing.id },
    data: { role: nextRole, permissions: permissions ? (permissions as Prisma.InputJsonValue) : Prisma.DbNull },
    select: { id: true, role: true, permissions: true, active: true, createdAt: true, user: { select: { id: true, name: true, phone: true } } },
  });
  await audit({ action: 'community.admin_updated', entityType: 'CommunityAdmin', entityId: existing.id, communityId: id, before: { role: existing.role, permissions: existing.permissions }, after: { role: nextRole, permissions } }, { ctx, req });
  await notify(existing.userId, { type: 'COMMUNITY_ROLE', title: 'Your union permissions changed', body: `Role: ${nextRole.replace('_', ' ').toLowerCase()}`, link: `/community/${id}` });
  ok(res, teamView(updated));
});

communityRoutes.delete('/:communityId/admins/:adminId', requireCommunity('community.admins.manage'), async (req, res) => {
  const ctx = auth(req);
  const id = communityId(req);
  const existing = await prisma.communityAdmin.findFirst({ where: { id: param(req, 'adminId'), communityId: id } });
  if (!existing) throw notFound('Team member');
  if (existing.userId === ctx.userId) throw conflict('You cannot remove your own role');
  assertCanManageRole(ctx, id, existing.role);
  await prisma.communityAdmin.update({ where: { id: existing.id }, data: { active: false } });
  await audit({ action: 'community.admin_removed', entityType: 'CommunityAdmin', entityId: existing.id, communityId: id, before: { userId: existing.userId, role: existing.role } }, { ctx, req });
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

communityRoutes.delete('/:communityId/announcements/:announcementId', requireCommunity('community.announcements.manage'), async (req, res) => {
  const id = communityId(req);
  const existing = await prisma.announcement.findFirst({ where: { id: param(req, 'announcementId'), communityId: id } });
  if (!existing) throw notFound('Announcement');
  await prisma.announcement.delete({ where: { id: existing.id } });
  await audit({ action: 'announcement.deleted', entityType: 'Announcement', entityId: existing.id, communityId: id, before: { title: existing.title } }, { ctx: req.auth, req });
  ok(res, { deleted: true });
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
