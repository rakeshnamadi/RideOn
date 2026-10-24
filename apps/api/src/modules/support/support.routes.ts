import { Router } from 'express';
import { z } from 'zod';
import { prisma, withTransaction } from '../../db.js';
import { auth, authenticate, requirePermission } from '../../middleware/auth.js';
import { conflict, forbidden, notFound, unprocessable } from '../../utils/errors.js';
import { reference } from '../../utils/ids.js';
import { IdParam, created, ok, pageMeta, pagination, parse } from '../../utils/http.js';
import { audit } from '../audit/audit.service.js';
import { assertCommunityPermission, communitiesWithPermission, isSuperAdmin } from '../auth/auth-context.js';
import { communityAdminUserIds, notify, superAdminUserIds } from '../notifications/notification.service.js';

// ─────────── Ratings ───────────

export const ratingRoutes = Router();
ratingRoutes.use(authenticate);

ratingRoutes.post('/', async (req, res) => {
  const ctx = auth(req);
  const body = parse(z.object({ bookingId: z.string().max(40), score: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() }), req.body);
  const rating = await withTransaction(async (tx) => {
    const b = await tx.booking.findUnique({ where: { id: body.bookingId } });
    if (!b || b.passengerId !== ctx.userId) throw notFound('Booking');
    if (b.status !== 'COMPLETED' || !b.driverId) throw unprocessable('You can rate a trip after it is completed', 'NOT_COMPLETED');
    const r = await tx.rating.create({ data: { bookingId: b.id, raterId: ctx.userId, driverId: b.driverId, score: body.score, comment: body.comment } });
    await tx.driver.update({ where: { id: b.driverId }, data: { ratingSum: { increment: body.score }, ratingCount: { increment: 1 } } });
    return r;
  }).catch((err) => {
    if ((err as { code?: string }).code === 'P2002') throw conflict('You have already rated this trip', 'ALREADY_RATED');
    throw err;
  });
  created(res, rating);
});

// ─────────── Complaints, disputes and driver appeals ───────────

export const complaintRoutes = Router();
complaintRoutes.use(authenticate);

complaintRoutes.post('/', async (req, res) => {
  const ctx = auth(req);
  const body = parse(
    z.object({
      kind: z.enum(['COMPLAINT', 'DISPUTE', 'APPEAL']).default('COMPLAINT'),
      bookingId: z.string().max(40).optional(),
      communityId: z.string().max(40).optional(),
      category: z.enum(['DRIVER_BEHAVIOUR', 'SAFETY', 'FARE', 'VEHICLE', 'ROUTE', 'PAYMENT', 'SUSPENSION', 'OTHER']),
      description: z.string().trim().min(10).max(5000),
    }),
    req.body,
  );
  let communityId = body.communityId;
  let againstDriverId: string | null = null;
  if (body.bookingId) {
    const b = await prisma.booking.findUnique({ where: { id: body.bookingId } });
    // Only a party to the booking may complain about it.
    if (!b || (b.passengerId !== ctx.userId && b.driverId !== ctx.driverId)) throw notFound('Booking');
    communityId = b.communityId;
    if (b.passengerId === ctx.userId) againstDriverId = b.driverId;
  }
  if (body.kind === 'APPEAL') {
    if (!ctx.driverId) throw forbidden('Only drivers can file appeals');
    const m = communityId ? await prisma.communityMembership.findUnique({ where: { communityId_driverId: { communityId, driverId: ctx.driverId } } }) : null;
    if (!m) throw unprocessable('Appeals must name a community you belong to', 'COMMUNITY_REQUIRED');
  }
  if (!communityId) throw unprocessable('Select the community this concerns', 'COMMUNITY_REQUIRED');
  const complaint = await prisma.complaint.create({
    data: { reference: reference('CM', 6), kind: body.kind, communityId, bookingId: body.bookingId, raisedById: ctx.userId, againstDriverId, category: body.category, description: body.description },
  });
  await audit({ action: 'complaint.created', entityType: 'Complaint', entityId: complaint.id, communityId, after: { kind: body.kind, category: body.category } }, { ctx, req });
  await notify(await communityAdminUserIds(communityId), { type: 'COMPLAINT', title: `New ${body.kind.toLowerCase()}: ${complaint.reference}`, body: body.category.replace(/_/g, ' '), link: `/community/${communityId}/complaints` });
  if (body.category === 'SAFETY') await notify(await superAdminUserIds(), { type: 'COMPLAINT', title: `Safety complaint ${complaint.reference}`, body: body.description.slice(0, 200), link: '/admin/complaints' });
  created(res, complaint);
});

complaintRoutes.get('/mine', async (req, res) => {
  ok(res, await prisma.complaint.findMany({ where: { raisedById: auth(req).userId }, orderBy: { createdAt: 'desc' }, include: { community: { select: { name: true } }, booking: { select: { reference: true } } } }));
});

/** Staff view: super admins see all; community staff see only their communities. */
complaintRoutes.get('/', async (req, res) => {
  const ctx = auth(req);
  const q = parse(z.object({ communityId: z.string().max(40).optional(), status: z.enum(['OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED', 'ESCALATED']).optional() }), req.query);
  const allowed = communitiesWithPermission(ctx, 'community.complaints.manage');
  if (allowed && allowed.length === 0) throw forbidden();
  if (q.communityId && allowed && !allowed.includes(q.communityId)) throw forbidden('You are not authorised for this community');
  const { page, pageSize, skip, take } = pagination(req);
  const where = {
    ...(q.communityId ? { communityId: q.communityId } : allowed ? { communityId: { in: allowed } } : {}),
    ...(q.status ? { status: q.status } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.complaint.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { raisedBy: { select: { name: true } }, booking: { select: { reference: true } }, community: { select: { name: true } }, againstDriver: { select: { id: true, user: { select: { name: true } } } } },
    }),
    prisma.complaint.count({ where }),
  ]);
  ok(res, items, pageMeta(page, pageSize, total));
});

complaintRoutes.patch('/:id', async (req, res) => {
  const ctx = auth(req);
  const { id } = parse(IdParam, req.params);
  const body = parse(z.object({ status: z.enum(['IN_REVIEW', 'RESOLVED', 'REJECTED', 'ESCALATED']), resolution: z.string().trim().max(5000).optional() }), req.body);
  const c = await prisma.complaint.findUnique({ where: { id } });
  if (!c) throw notFound('Complaint');
  if (!isSuperAdmin(ctx)) {
    assertCommunityPermission(ctx, c.communityId, 'community.complaints.manage');
    // A community cannot rule on an appeal against its own suspension decision; escalate instead.
    if (c.kind === 'APPEAL' && ['RESOLVED', 'REJECTED'].includes(body.status) && c.status === 'ESCALATED') throw forbidden('Escalated appeals are decided by the platform');
  }
  if (['RESOLVED', 'REJECTED'].includes(body.status) && !body.resolution) throw unprocessable('Add a resolution note', 'RESOLUTION_REQUIRED');
  const updated = await prisma.complaint.update({
    where: { id },
    data: { status: body.status, resolution: body.resolution, handledById: ctx.userId, ...(['RESOLVED', 'REJECTED'].includes(body.status) ? { resolvedAt: new Date() } : {}) },
  });
  await audit({ action: 'complaint.updated', entityType: 'Complaint', entityId: id, communityId: c.communityId, before: { status: c.status }, after: body }, { ctx, req });
  await notify(c.raisedById, { type: 'COMPLAINT_UPDATE', title: `${c.reference}: ${body.status.replace('_', ' ').toLowerCase()}`, body: body.resolution ?? 'Your complaint status was updated.', link: '/app/support' });
  if (body.status === 'ESCALATED') await notify(await superAdminUserIds(), { type: 'COMPLAINT', title: `Escalated: ${c.reference}`, body: c.category, link: '/admin/complaints' });
  ok(res, updated);
});

// ─────────── Support tickets ───────────

export const supportRoutes = Router();
supportRoutes.use(authenticate);

supportRoutes.post('/', async (req, res) => {
  const ctx = auth(req);
  const body = parse(
    z.object({
      subject: z.string().trim().min(3).max(200),
      description: z.string().trim().min(10).max(5000),
      bookingId: z.string().max(40).optional(),
      kind: z.enum(['SUPPORT', 'INCIDENT', 'SAFETY']).default('SUPPORT'),
    }),
    req.body,
  );
  let communityId: string | null = null;
  if (body.bookingId) {
    const b = await prisma.booking.findUnique({ where: { id: body.bookingId } });
    if (!b || (b.passengerId !== ctx.userId && b.driverId !== ctx.driverId)) throw notFound('Booking');
    communityId = b.communityId;
  }
  const ticket = await prisma.supportTicket.create({
    data: { ...body, reference: reference('TK', 6), userId: ctx.userId, communityId, priority: body.kind === 'SAFETY' ? 'URGENT' : body.kind === 'INCIDENT' ? 'HIGH' : 'MEDIUM' },
  });
  if (body.kind !== 'SUPPORT') await notify(await superAdminUserIds(), { type: 'TICKET', title: `${body.kind} ticket ${ticket.reference}`, body: body.subject, link: '/admin/support' });
  created(res, ticket);
});

supportRoutes.get('/mine', async (req, res) => {
  ok(res, await prisma.supportTicket.findMany({ where: { userId: auth(req).userId }, orderBy: { createdAt: 'desc' } }));
});

supportRoutes.get('/', requirePermission('platform.support.manage'), async (req, res) => {
  const q = parse(z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional() }), req.query);
  const { page, pageSize, skip, take } = pagination(req);
  const where = q.status ? { status: q.status } : {};
  const [items, total] = await Promise.all([
    prisma.supportTicket.findMany({ where, orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }], skip, take, include: { user: { select: { name: true } } } }),
    prisma.supportTicket.count({ where }),
  ]);
  ok(res, items, pageMeta(page, pageSize, total));
});

supportRoutes.patch('/:id', requirePermission('platform.support.manage'), async (req, res) => {
  const { id } = parse(IdParam, req.params);
  const body = parse(z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']), resolutionNote: z.string().trim().max(5000).optional() }), req.body);
  const t = await prisma.supportTicket.findUnique({ where: { id } });
  if (!t) throw notFound('Ticket');
  const updated = await prisma.supportTicket.update({ where: { id }, data: { ...body, assignedToId: auth(req).userId } });
  await audit({ action: 'support.ticket_updated', entityType: 'SupportTicket', entityId: id, before: { status: t.status }, after: body }, { ctx: req.auth, req });
  await notify(t.userId, { type: 'TICKET_UPDATE', title: `Ticket ${t.reference} ${body.status.toLowerCase().replace('_', ' ')}`, body: body.resolutionNote ?? '', link: '/app/support' });
  ok(res, updated);
});
