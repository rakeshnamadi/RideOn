import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { auth, authenticate } from '../../middleware/auth.js';
import { communityId, requireCommunity } from '../../middleware/community-scope.js';
import { conflict, notFound, unprocessable } from '../../utils/errors.js';
import { created, ok, param, parse, toCsv } from '../../utils/http.js';
import { audit } from '../audit/audit.service.js';

/**
 * Union reports, prepared by reporters (or local admins): a metrics snapshot for a period,
 * plus notes they write. Drafts can be refreshed and edited; published reports are frozen
 * except for their notes.
 */
export const communityReportRoutes = Router({ mergeParams: true });
communityReportRoutes.use(authenticate);

export interface ReportMetrics {
  bookings: { total: number; regular: number; shared: number; byStatus: Record<string, number> };
  completedTrips: number;
  farePaise: number;
  platformFeePaise: number;
  communityFeePaise: number;
  driverNetPaise: number;
  cancellations: { total: number; topReasons: { reason: string; count: number }[] };
  drivers: { approved: number; applications: number; activeMembers: number };
  complaints: { opened: number; resolved: number };
  fareFeedback: Record<string, number>;
  busiestPickupPoints: { name: string; trips: number }[];
  generatedAt: string;
}

export async function computeReportMetrics(cid: string, from: Date, to: Date): Promise<ReportMetrics> {
  const period = { gte: from, lt: to };
  const [byStatus, byType, revenue, cancelReasons, approved, applications, activeMembers, opened, resolved, feedback, stops] = await Promise.all([
    prisma.booking.groupBy({ by: ['status'], where: { communityId: cid, createdAt: period }, _count: true }),
    prisma.booking.groupBy({ by: ['type'], where: { communityId: cid, createdAt: period }, _count: true }),
    prisma.platformFeeRecord.aggregate({ where: { communityId: cid, createdAt: period }, _sum: { farePaise: true, platformFeePaise: true, communityFeePaise: true, driverNetPaise: true }, _count: true }),
    prisma.booking.groupBy({ by: ['cancelReason'], where: { communityId: cid, status: 'CANCELLED', createdAt: period }, _count: true, orderBy: { _count: { cancelReason: 'desc' } }, take: 5 }),
    prisma.communityMembership.count({ where: { communityId: cid, status: 'APPROVED', decidedAt: period } }),
    prisma.communityMembership.count({ where: { communityId: cid, createdAt: period } }),
    prisma.communityMembership.count({ where: { communityId: cid, status: 'APPROVED' } }),
    prisma.complaint.count({ where: { communityId: cid, createdAt: period } }),
    prisma.complaint.count({ where: { communityId: cid, resolvedAt: period } }),
    prisma.fareFeedback.groupBy({ by: ['sentiment'], where: { communityId: cid, createdAt: period }, _count: true }),
    prisma.booking.groupBy({ by: ['pickupAddress'], where: { communityId: cid, status: 'COMPLETED', createdAt: period, pickupAddress: { not: null } }, _count: true, orderBy: { _count: { pickupAddress: 'desc' } }, take: 5 }),
  ]);
  const statusCounts = Object.fromEntries(byStatus.map((s) => [s.status, s._count]));
  const typeCounts = Object.fromEntries(byType.map((t) => [t.type, t._count]));
  return {
    bookings: { total: byStatus.reduce((s, b) => s + b._count, 0), regular: typeCounts.REGULAR ?? 0, shared: typeCounts.SHARED ?? 0, byStatus: statusCounts },
    completedTrips: revenue._count,
    farePaise: revenue._sum.farePaise ?? 0,
    platformFeePaise: revenue._sum.platformFeePaise ?? 0,
    communityFeePaise: revenue._sum.communityFeePaise ?? 0,
    driverNetPaise: revenue._sum.driverNetPaise ?? 0,
    cancellations: { total: statusCounts.CANCELLED ?? 0, topReasons: cancelReasons.map((c) => ({ reason: c.cancelReason ?? 'Not specified', count: c._count })) },
    drivers: { approved, applications, activeMembers },
    complaints: { opened, resolved },
    fareFeedback: Object.fromEntries(feedback.map((f) => [f.sentiment, f._count])),
    busiestPickupPoints: stops.map((s) => ({ name: s.pickupAddress ?? '—', trips: s._count })),
    generatedAt: new Date().toISOString(),
  };
}

const PeriodSchema = z
  .object({ title: z.string().trim().min(3).max(200), from: z.coerce.date(), to: z.coerce.date(), notes: z.string().trim().max(20_000).optional() })
  .refine((p) => p.to > p.from, { message: 'The period must end after it starts', path: ['to'] });

const json = (m: ReportMetrics) => m as unknown as Prisma.InputJsonValue;

communityReportRoutes.get('/', requireCommunity('community.reports.manage'), async (req, res) => {
  ok(
    res,
    await prisma.communityReport.findMany({
      where: { communityId: communityId(req) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, title: true, periodStart: true, periodEnd: true, status: true, createdAt: true, updatedAt: true, publishedAt: true, createdById: true },
    }),
  );
});

communityReportRoutes.post('/', requireCommunity('community.reports.manage'), async (req, res) => {
  const ctx = auth(req);
  const cid = communityId(req);
  const body = parse(PeriodSchema, req.body);
  const report = await prisma.communityReport.create({
    data: { communityId: cid, title: body.title, periodStart: body.from, periodEnd: body.to, notes: body.notes, metrics: json(await computeReportMetrics(cid, body.from, body.to)), createdById: ctx.userId },
  });
  await audit({ action: 'report.prepared', entityType: 'CommunityReport', entityId: report.id, communityId: cid, after: { title: body.title, from: body.from, to: body.to } }, { ctx, req });
  created(res, report);
});

async function loadReport(cid: string, id: string) {
  const r = await prisma.communityReport.findFirst({ where: { id, communityId: cid } });
  if (!r) throw notFound('Report');
  return r;
}

communityReportRoutes.get('/:reportId', requireCommunity('community.reports.manage'), async (req, res) => {
  const r = await loadReport(communityId(req), param(req, 'reportId'));
  const authors = await prisma.user.findMany({ where: { id: { in: [r.createdById, r.updatedById].filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  ok(res, { ...r, authors: Object.fromEntries(authors.map((a) => [a.id, a.name])) });
});

communityReportRoutes.patch('/:reportId', requireCommunity('community.reports.manage'), async (req, res) => {
  const ctx = auth(req);
  const cid = communityId(req);
  const r = await loadReport(cid, param(req, 'reportId'));
  const body = parse(z.object({ title: z.string().trim().min(3).max(200).optional(), notes: z.string().trim().max(20_000).nullable().optional(), status: z.enum(['DRAFT', 'PUBLISHED']).optional() }), req.body);
  if (r.status === 'PUBLISHED' && (body.title !== undefined || body.status === 'DRAFT')) {
    throw conflict('Published reports keep their title and figures; only the notes can be edited', 'REPORT_PUBLISHED');
  }
  const updated = await prisma.communityReport.update({
    where: { id: r.id },
    data: { ...body, updatedById: ctx.userId, ...(body.status === 'PUBLISHED' && r.status !== 'PUBLISHED' ? { publishedAt: new Date() } : {}) },
  });
  await audit({ action: body.status === 'PUBLISHED' && r.status !== 'PUBLISHED' ? 'report.published' : 'report.edited', entityType: 'CommunityReport', entityId: r.id, communityId: cid, before: { status: r.status, title: r.title }, after: body }, { ctx, req });
  ok(res, updated);
});

/** Recompute a draft's figures from current data. */
communityReportRoutes.post('/:reportId/refresh', requireCommunity('community.reports.manage'), async (req, res) => {
  const ctx = auth(req);
  const cid = communityId(req);
  const r = await loadReport(cid, param(req, 'reportId'));
  if (r.status === 'PUBLISHED') throw conflict('Published reports are frozen', 'REPORT_PUBLISHED');
  const updated = await prisma.communityReport.update({ where: { id: r.id }, data: { metrics: json(await computeReportMetrics(cid, r.periodStart, r.periodEnd)), updatedById: ctx.userId } });
  ok(res, updated);
});

communityReportRoutes.delete('/:reportId', requireCommunity('community.reports.manage'), async (req, res) => {
  const cid = communityId(req);
  const r = await loadReport(cid, param(req, 'reportId'));
  if (r.status === 'PUBLISHED') throw unprocessable('Published reports are kept on record', 'REPORT_PUBLISHED');
  await prisma.communityReport.delete({ where: { id: r.id } });
  await audit({ action: 'report.deleted', entityType: 'CommunityReport', entityId: r.id, communityId: cid, before: { title: r.title } }, { ctx: req.auth, req });
  ok(res, { deleted: true });
});

communityReportRoutes.get('/:reportId/export.csv', requireCommunity('community.reports.manage'), async (req, res) => {
  const r = await loadReport(communityId(req), param(req, 'reportId'));
  const m = r.metrics as unknown as ReportMetrics;
  const rows: Record<string, unknown>[] = [
    ['Bookings', m.bookings.total],
    ['Regular bookings', m.bookings.regular],
    ['Shared bookings', m.bookings.shared],
    ['Completed trips', m.completedTrips],
    ['Fares (paise)', m.farePaise],
    ['Platform fees (paise)', m.platformFeePaise],
    ['Community fees (paise)', m.communityFeePaise],
    ['Driver earnings (paise)', m.driverNetPaise],
    ['Cancellations', m.cancellations.total],
    ['Drivers approved', m.drivers.approved],
    ['Driver applications', m.drivers.applications],
    ['Active member drivers', m.drivers.activeMembers],
    ['Complaints opened', m.complaints.opened],
    ['Complaints resolved', m.complaints.resolved],
    ...Object.entries(m.fareFeedback).map(([k, v]) => [`Fare feedback: ${k}`, v]),
  ].map(([metric, value]) => ({ metric, value }));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="report-${r.periodStart.toISOString().slice(0, 10)}.csv"`);
  res.send(toCsv(rows, ['metric', 'value']));
});
