import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { auth, authenticate, requirePermission, requireRole } from '../../middleware/auth.js';
import { conflict, notFound, unprocessable } from '../../utils/errors.js';
import { IdParam, created, ok, pageMeta, pagination, parse } from '../../utils/http.js';
import { audit } from '../audit/audit.service.js';
import { revokeAllSessions } from '../auth/auth.service.js';
import { PhoneSchema } from '../auth/auth.routes.js';
import { Lat, Lng } from '../geo/geo.routes.js';
import { notify } from '../notifications/notification.service.js';
import { DEFAULT_FARE_CAPS, getFareCaps } from '../fares/governance.service.js';

export const adminRoutes = Router();
adminRoutes.use(authenticate, requireRole('SUPER_ADMIN'));

// ─────────── Dashboard ───────────

adminRoutes.get('/dashboard', async (_req, res) => {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [communities, activeDrivers, onlineDrivers, passengers, bookingsByStatus, revenue, openTickets, openComplaints, pendingVerifications, pendingReviews, recentSos] = await Promise.all([
    prisma.community.groupBy({ by: ['status'], _count: true }),
    prisma.driver.count({ where: { status: 'ACTIVE', verificationStatus: 'VERIFIED' } }),
    prisma.driverAvailability.count({ where: { status: { in: ['ONLINE', 'ON_TRIP'] } } }),
    prisma.userRole.count({ where: { role: { key: 'PASSENGER' } } }),
    prisma.booking.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: true }),
    prisma.platformFeeRecord.aggregate({ where: { createdAt: { gte: since } }, _sum: { farePaise: true, platformFeePaise: true, communityFeePaise: true, driverNetPaise: true }, _count: true }),
    prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    prisma.complaint.count({ where: { status: { in: ['OPEN', 'IN_REVIEW', 'ESCALATED'] } } }),
    prisma.driver.count({ where: { verificationStatus: { in: ['PENDING', 'UNDER_REVIEW'] } } }),
    prisma.governanceProposal.count({ where: { status: 'PENDING', requiresPlatformReview: true, platformDecision: null } }),
    prisma.tripEvent.findMany({ where: { type: 'SOS', createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 5, include: { booking: { select: { reference: true } } } }),
  ]);
  const statusCounts = Object.fromEntries(bookingsByStatus.map((b) => [b.status, b._count]));
  const total = bookingsByStatus.reduce((s, b) => s + b._count, 0);
  ok(res, {
    communities: Object.fromEntries(communities.map((c) => [c.status, c._count])),
    activeDrivers,
    onlineDrivers,
    passengers,
    bookings: { last30Days: total, byStatus: statusCounts, cancellationRate: total ? Math.round(((statusCounts.CANCELLED ?? 0) / total) * 1000) / 10 : 0 },
    revenue: { completedTrips: revenue._count, ...revenue._sum },
    issues: { openTickets, openComplaints, pendingVerifications, pendingReviews },
    recentSos,
  });
});

// ─────────── Cities ───────────

const CitySchema = z.object({ name: z.string().trim().min(2).max(100), state: z.string().trim().min(2).max(100), timezone: z.string().default('Asia/Kolkata'), centerLat: Lat, centerLng: Lng, active: z.boolean().default(true) });

adminRoutes.get('/cities', async (_req, res) => {
  ok(res, await prisma.city.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { communities: true } } } }));
});

adminRoutes.post('/cities', requirePermission('platform.settings.manage'), async (req, res) => {
  const city = await prisma.city.create({ data: parse(CitySchema, req.body) });
  await audit({ action: 'city.created', entityType: 'City', entityId: city.id, after: city }, { ctx: req.auth, req });
  created(res, city);
});

adminRoutes.patch('/cities/:id', requirePermission('platform.settings.manage'), async (req, res) => {
  const { id } = parse(IdParam, req.params);
  const data = parse(CitySchema.partial(), req.body);
  const city = await prisma.city.update({ where: { id }, data });
  await audit({ action: 'city.updated', entityType: 'City', entityId: id, after: data }, { ctx: req.auth, req });
  ok(res, city);
});

// ─────────── Communities ───────────

adminRoutes.get('/communities', async (req, res) => {
  const q = parse(z.object({ status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional() }), req.query);
  ok(
    res,
    await prisma.community.findMany({
      where: q.status ? { status: q.status } : {},
      include: {
        city: { select: { name: true } },
        policy: true,
        admins: { where: { active: true }, select: { id: true, role: true, user: { select: { name: true, phone: true } } } },
        _count: { select: { memberships: { where: { status: 'APPROVED' } }, bookings: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  );
});

adminRoutes.post('/communities', requirePermission('platform.communities.manage'), async (req, res) => {
  const body = parse(
    z.object({
      cityId: z.string().max(40),
      name: z.string().trim().min(3).max(150),
      slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,100}$/),
      registrationNumber: z.string().trim().max(100).optional(),
      description: z.string().trim().max(5000).optional(),
      contactPhone: z.string().trim().max(20).optional(),
      centerLat: Lat,
      centerLng: Lng,
      headPhone: PhoneSchema.optional(),
    }),
    req.body,
  );
  const { headPhone, ...data } = body;
  const head = headPhone ? await prisma.user.findUnique({ where: { phone: headPhone } }) : null;
  if (headPhone && !head) throw notFound('User for the community head phone number');
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'COMMUNITY_ADMIN' } });
  const community = await prisma.$transaction(async (tx) => {
    const c = await tx.community.create({ data: { ...data, status: 'PENDING', policy: { create: {} } } });
    if (head) {
      await tx.userRole.upsert({ where: { userId_roleId: { userId: head.id, roleId: role.id } }, create: { userId: head.id, roleId: role.id }, update: {} });
      await tx.communityAdmin.create({ data: { communityId: c.id, userId: head.id, role: 'HEAD', assignedById: auth(req).userId } });
    }
    return c;
  });
  await audit({ action: 'community.created', entityType: 'Community', entityId: community.id, communityId: community.id, after: data }, { ctx: req.auth, req });
  if (head) await notify(head.id, { type: 'COMMUNITY_ROLE', title: 'You are a community head', body: `${community.name} was created and is pending activation.`, link: `/community/${community.id}` });
  created(res, community);
});

adminRoutes.post('/communities/:id/status', requirePermission('platform.communities.manage'), async (req, res) => {
  const { id } = parse(IdParam, req.params);
  const body = parse(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']), reason: z.string().trim().max(500).optional() }), req.body);
  const c = await prisma.community.findUnique({ where: { id }, include: { serviceAreas: { where: { active: true } } } });
  if (!c) throw notFound('Community');
  if (body.status !== 'ACTIVE' && !body.reason) throw unprocessable('A reason is required', 'REASON_REQUIRED');
  if (body.status === 'ACTIVE' && c.serviceAreas.length === 0) throw unprocessable('Add at least one service area before activating', 'NO_SERVICE_AREA');
  const updated = await prisma.community.update({ where: { id }, data: { status: body.status, statusReason: body.reason ?? null } });
  if (body.status !== 'ACTIVE') {
    // Take the community's drivers offline; existing active trips are left to finish.
    await prisma.driverAvailability.updateMany({ where: { communityId: id, status: 'ONLINE' }, data: { status: 'OFFLINE', standId: null, queuedAt: null } });
  }
  await audit({ action: `community.${body.status.toLowerCase()}`, entityType: 'Community', entityId: id, communityId: id, before: { status: c.status }, after: body }, { ctx: req.auth, req });
  const admins = await prisma.communityAdmin.findMany({ where: { communityId: id, active: true }, select: { userId: true } });
  await notify(admins.map((a) => a.userId), { type: 'COMMUNITY_STATUS', title: `Community ${body.status.toLowerCase()}`, body: body.reason ?? `${c.name} is now ${body.status.toLowerCase()}.`, link: `/community/${id}` });
  ok(res, updated);
});

/** Platform-controlled limits that a community cannot change itself. */
adminRoutes.put('/communities/:id/platform-policy', requirePermission('platform.fees.manage'), async (req, res) => {
  const { id } = parse(IdParam, req.params);
  const body = parse(z.object({ maxFareIncreasePercent: z.number().int().min(0).max(200), allowDistanceFares: z.boolean(), communityFeeBps: z.number().int().min(0).max(2000) }).partial(), req.body);
  const before = await prisma.communityPolicy.findUnique({ where: { communityId: id } });
  const policy = await prisma.communityPolicy.upsert({ where: { communityId: id }, create: { communityId: id, ...body }, update: body });
  await audit({ action: 'community.platform_policy_updated', entityType: 'CommunityPolicy', entityId: policy.id, communityId: id, before, after: body }, { ctx: req.auth, req });
  ok(res, policy);
});

// ─────────── Drivers & users ───────────

adminRoutes.get('/drivers', async (req, res) => {
  const q = parse(z.object({ verificationStatus: z.enum(['PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED']).optional(), search: z.string().max(100).optional() }), req.query);
  const { page, pageSize, skip, take } = pagination(req);
  const where = {
    ...(q.verificationStatus ? { verificationStatus: q.verificationStatus } : {}),
    ...(q.search ? { OR: [{ licenseNumber: { contains: q.search } }, { user: { name: { contains: q.search } } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.driver.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { name: true, phone: true, status: true } },
        documents: { select: { id: true, type: true, status: true } },
        memberships: { select: { status: true, community: { select: { name: true } } } },
      },
    }),
    prisma.driver.count({ where }),
  ]);
  ok(res, items, pageMeta(page, pageSize, total));
});

adminRoutes.post('/drivers/:id/verification', requirePermission('platform.drivers.verify'), async (req, res) => {
  const { id } = parse(IdParam, req.params);
  const body = parse(z.object({ status: z.enum(['UNDER_REVIEW', 'VERIFIED', 'REJECTED']), note: z.string().trim().max(1000).optional() }), req.body);
  const d = await prisma.driver.findUnique({ where: { id }, include: { documents: true } });
  if (!d) throw notFound('Driver');
  if (body.status === 'VERIFIED') {
    const approved = new Set(d.documents.filter((doc) => doc.status === 'APPROVED').map((doc) => doc.type));
    const missing = ['DRIVING_LICENSE', 'ID_PROOF'].filter((t) => !approved.has(t as never));
    if (missing.length) throw unprocessable(`Approve these documents first: ${missing.join(', ')}`, 'DOCUMENTS_INCOMPLETE');
  }
  if (body.status === 'REJECTED' && !body.note) throw unprocessable('A reason is required', 'REASON_REQUIRED');
  const updated = await prisma.driver.update({
    where: { id },
    data: { verificationStatus: body.status, verificationNote: body.note, ...(body.status === 'VERIFIED' ? { verifiedAt: new Date(), verifiedById: auth(req).userId } : {}) },
  });
  await audit({ action: `driver.verification_${body.status.toLowerCase()}`, entityType: 'Driver', entityId: id, before: { status: d.verificationStatus }, after: body }, { ctx: req.auth, req });
  await notify(d.userId, { type: 'VERIFICATION', title: `Verification ${body.status.toLowerCase().replace('_', ' ')}`, body: body.note ?? '', link: '/driver/profile' });
  ok(res, updated);
});

adminRoutes.post('/documents/:id/review', requirePermission('platform.drivers.verify'), async (req, res) => {
  const { id } = parse(IdParam, req.params);
  const body = parse(z.object({ status: z.enum(['APPROVED', 'REJECTED']), note: z.string().trim().max(500).optional() }), req.body);
  const doc = await prisma.driverDocument.findUnique({ where: { id } });
  if (!doc) throw notFound('Document');
  const updated = await prisma.driverDocument.update({ where: { id }, data: { status: body.status, reviewNote: body.note, reviewedById: auth(req).userId, reviewedAt: new Date() }, select: { id: true, status: true } });
  await audit({ action: 'driver.document_reviewed', entityType: 'DriverDocument', entityId: id, before: { status: doc.status }, after: body }, { ctx: req.auth, req });
  ok(res, updated);
});

adminRoutes.post('/drivers/:id/status', requirePermission('platform.drivers.verify'), async (req, res) => {
  const { id } = parse(IdParam, req.params);
  const body = parse(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: z.string().trim().min(3).max(500) }), req.body);
  const d = await prisma.driver.findUnique({ where: { id } });
  if (!d) throw notFound('Driver');
  await prisma.$transaction([
    prisma.driver.update({ where: { id }, data: { status: body.status, suspensionReason: body.status === 'SUSPENDED' ? body.reason : null } }),
    ...(body.status === 'SUSPENDED' ? [prisma.driverAvailability.updateMany({ where: { driverId: id, status: 'ONLINE' }, data: { status: 'OFFLINE', standId: null, queuedAt: null } })] : []),
  ]);
  await audit({ action: `driver.${body.status.toLowerCase()}`, entityType: 'Driver', entityId: id, before: { status: d.status }, after: body }, { ctx: req.auth, req });
  await notify(d.userId, { type: 'DRIVER_STATUS', title: body.status === 'SUSPENDED' ? 'Driver account suspended' : 'Driver account reinstated', body: body.reason, link: '/driver/profile' });
  ok(res, { status: body.status });
});

adminRoutes.get('/users', requirePermission('platform.users.manage'), async (req, res) => {
  const q = parse(z.object({ search: z.string().max(100).optional(), status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional() }), req.query);
  const { page, pageSize, skip, take } = pagination(req);
  const where = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.search ? { OR: [{ name: { contains: q.search } }, { phone: { contains: q.search } }, { email: { contains: q.search } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, phone: true, email: true, status: true, suspensionReason: true, createdAt: true, lastLoginAt: true, roles: { select: { role: { select: { key: true } } } } } }),
    prisma.user.count({ where }),
  ]);
  ok(res, items.map((u) => ({ ...u, roles: u.roles.map((r) => r.role.key) })), pageMeta(page, pageSize, total));
});

adminRoutes.post('/users/:id/status', requirePermission('platform.users.manage'), async (req, res) => {
  const { id } = parse(IdParam, req.params);
  const body = parse(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']), reason: z.string().trim().min(3).max(500) }), req.body);
  if (id === auth(req).userId) throw conflict('You cannot change your own account status');
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u) throw notFound('User');
  await prisma.user.update({ where: { id }, data: { status: body.status, suspensionReason: body.status === 'ACTIVE' ? null : body.reason } });
  if (body.status !== 'ACTIVE') await revokeAllSessions(id, `ACCOUNT_${body.status}`);
  await audit({ action: `user.${body.status.toLowerCase()}`, entityType: 'User', entityId: id, before: { status: u.status }, after: body }, { ctx: req.auth, req });
  ok(res, { status: body.status });
});

// ─────────── Bookings (platform-wide) ───────────

adminRoutes.get('/bookings', requirePermission('platform.bookings.view'), async (req, res) => {
  const q = parse(z.object({ status: z.string().max(30).optional(), communityId: z.string().max(40).optional(), reference: z.string().max(20).optional() }), req.query);
  const { page, pageSize, skip, take } = pagination(req);
  const where = {
    ...(q.status ? { status: q.status as never } : {}),
    ...(q.communityId ? { communityId: q.communityId } : {}),
    ...(q.reference ? { reference: { contains: q.reference.toUpperCase() } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, reference: true, type: true, status: true, paymentStatus: true, paymentMethod: true, quotedFarePaise: true, finalFarePaise: true, createdAt: true,
        community: { select: { name: true } }, passenger: { select: { name: true } }, driver: { select: { user: { select: { name: true } } } },
      },
    }),
    prisma.booking.count({ where }),
  ]);
  ok(res, items, pageMeta(page, pageSize, total));
});

// ─────────── Fees, feature flags, settings ───────────

adminRoutes.get('/fees', async (_req, res) => {
  ok(res, await prisma.platformFeeConfig.findMany({ orderBy: [{ serviceType: 'asc' }, { effectiveFrom: 'desc' }] }));
});

adminRoutes.post('/fees', requirePermission('platform.fees.manage'), async (req, res) => {
  const body = parse(
    z.object({ serviceType: z.enum(['REGULAR', 'SHARED']), feeBps: z.number().int().min(0).max(3000), flatFeePaise: z.number().int().min(0).max(5000).default(0), maxFeePaise: z.number().int().min(0).nullable().optional(), effectiveFrom: z.coerce.date() }),
    req.body,
  );
  if (body.effectiveFrom < new Date(Date.now() - 60_000)) throw unprocessable('Fee changes cannot be backdated', 'BACKDATED');
  const fee = await prisma.platformFeeConfig.create({ data: { ...body, createdById: auth(req).userId } });
  await audit({ action: 'platform.fee_configured', entityType: 'PlatformFeeConfig', entityId: fee.id, after: body }, { ctx: req.auth, req });
  created(res, fee);
});

adminRoutes.get('/feature-flags', async (_req, res) => {
  ok(res, await prisma.featureFlag.findMany({ orderBy: { key: 'asc' } }));
});

adminRoutes.put('/feature-flags/:key', requirePermission('platform.settings.manage'), async (req, res) => {
  const key = parse(z.object({ key: z.string().regex(/^[a-z0-9_]{2,60}$/) }), req.params).key;
  const body = parse(z.object({ enabled: z.boolean(), description: z.string().max(255).optional() }), req.body);
  const flag = await prisma.featureFlag.upsert({ where: { key }, create: { key, ...body }, update: body });
  await audit({ action: 'platform.feature_flag_set', entityType: 'FeatureFlag', entityId: key, after: body }, { ctx: req.auth, req });
  ok(res, flag);
});

adminRoutes.get('/settings/fare-caps', async (_req, res) => {
  ok(res, await getFareCaps());
});

adminRoutes.put('/settings/fare-caps', requirePermission('platform.settings.manage'), async (req, res) => {
  const shape = Object.fromEntries(Object.keys(DEFAULT_FARE_CAPS).map((k) => [k, z.number().int().min(0).max(1_000_000)]));
  const body = parse(z.object(shape).partial(), req.body);
  const before = await getFareCaps();
  const value = { ...before, ...body };
  await prisma.platformSetting.upsert({ where: { key: 'fare_caps' }, create: { key: 'fare_caps', value }, update: { value } });
  await audit({ action: 'platform.fare_caps_updated', entityType: 'PlatformSetting', entityId: 'fare_caps', before, after: value }, { ctx: req.auth, req });
  ok(res, value);
});

// ─────────── Audit log ───────────

adminRoutes.get('/audit-logs', requirePermission('platform.audit.view'), async (req, res) => {
  const q = parse(z.object({ action: z.string().max(80).optional(), communityId: z.string().max(40).optional(), entityType: z.string().max(50).optional(), entityId: z.string().max(40).optional() }), req.query);
  const { page, pageSize, skip, take } = pagination(req);
  const where = {
    ...(q.action ? { action: { contains: q.action } } : {}),
    ...(q.communityId ? { communityId: q.communityId } : {}),
    ...(q.entityType ? { entityType: q.entityType } : {}),
    ...(q.entityId ? { entityId: q.entityId } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, include: { actor: { select: { name: true } } } }),
    prisma.auditLog.count({ where }),
  ]);
  ok(res, items, pageMeta(page, pageSize, total));
});
