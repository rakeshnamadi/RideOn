import { Router } from 'express';
import { z } from 'zod';
import { prisma, withTransaction } from '../../db.js';
import { auth, authenticate } from '../../middleware/auth.js';
import { forbidden, unprocessable } from '../../utils/errors.js';
import { created, ok, parse, toCsv, param } from '../../utils/http.js';
import { audit } from '../audit/audit.service.js';
import { assertCommunityPermission, hasPermission, isSuperAdmin } from '../auth/auth-context.js';

export const reportRoutes = Router();
reportRoutes.use(authenticate);

const PeriodSchema = z.object({ from: z.coerce.date(), to: z.coerce.date() }).refine((p) => p.to > p.from, 'to must be after from');

/** Statements for one community. Visible to that community's authorised staff and the platform. */
reportRoutes.get('/communities/:communityId/statements', async (req, res) => {
  const cid = param(req, 'communityId');
  assertCommunityPermission(auth(req), cid, 'community.statements.view');
  const [statements, unsettled] = await Promise.all([
    prisma.communityStatement.findMany({ where: { communityId: cid }, orderBy: { periodStart: 'desc' } }),
    prisma.platformFeeRecord.aggregate({ where: { communityId: cid, statementId: null }, _sum: { farePaise: true, platformFeePaise: true, communityFeePaise: true, driverNetPaise: true }, _count: true }),
  ]);
  ok(res, { statements, unsettled: { trips: unsettled._count, ...unsettled._sum } });
});

/** Generate a statement covering every unstatemented fee record in the period (platform only). */
reportRoutes.post('/communities/:communityId/statements', async (req, res) => {
  const ctx = auth(req);
  if (!hasPermission(ctx, 'platform.reports.export')) throw forbidden();
  const cid = param(req, 'communityId');
  const period = parse(PeriodSchema, req.body);
  const statement = await withTransaction(async (tx) => {
    const where = { communityId: cid, statementId: null, createdAt: { gte: period.from, lt: period.to } };
    const sum = await tx.platformFeeRecord.aggregate({ where, _sum: { farePaise: true, platformFeePaise: true, communityFeePaise: true, driverNetPaise: true }, _count: true });
    if (sum._count === 0) throw unprocessable('No unstatemented trips in this period', 'EMPTY_PERIOD');
    const s = await tx.communityStatement.create({
      data: {
        communityId: cid,
        periodStart: period.from,
        periodEnd: period.to,
        tripCount: sum._count,
        totalFarePaise: sum._sum.farePaise ?? 0,
        platformFeePaise: sum._sum.platformFeePaise ?? 0,
        communityFeePaise: sum._sum.communityFeePaise ?? 0,
        driverNetPaise: sum._sum.driverNetPaise ?? 0,
        generatedById: ctx.userId,
      },
    });
    await tx.platformFeeRecord.updateMany({ where, data: { statementId: s.id, settlementStatus: 'STATEMENTED' } });
    await audit({ action: 'statement.generated', entityType: 'CommunityStatement', entityId: s.id, communityId: cid, after: { tripCount: s.tripCount, totalFarePaise: s.totalFarePaise } }, { ctx, req }, tx);
    return s;
  });
  created(res, statement);
});

const BOOKING_COLUMNS = ['reference', 'type', 'status', 'paymentStatus', 'paymentMethod', 'community', 'seatCount', 'quotedFarePaise', 'finalFarePaise', 'platformFeePaise', 'communityFeePaise', 'driverEarningsPaise', 'cancellationFeePaise', 'cancelReason', 'createdAt', 'completedAt'];

/** CSV export of bookings. Community staff can export only their community; no passenger contact data is included. */
reportRoutes.get('/bookings.csv', async (req, res) => {
  const ctx = auth(req);
  const q = parse(z.object({ communityId: z.string().max(40).optional(), from: z.coerce.date(), to: z.coerce.date() }), req.query);
  if (q.communityId) {
    if (!isSuperAdmin(ctx)) assertCommunityPermission(ctx, q.communityId, 'community.statements.view');
  } else if (!hasPermission(ctx, 'platform.reports.export')) {
    throw forbidden('Select a community you manage');
  }
  const rows = await prisma.booking.findMany({
    where: { createdAt: { gte: q.from, lt: q.to }, ...(q.communityId ? { communityId: q.communityId } : {}) },
    include: { community: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
    take: 50_000,
  });
  await audit({ action: 'report.bookings_exported', entityType: 'Report', communityId: q.communityId, after: { from: q.from, to: q.to, rows: rows.length } }, { ctx, req });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="bookings-${q.from.toISOString().slice(0, 10)}.csv"`);
  res.send(toCsv(rows.map((r) => ({ ...r, community: r.community.name })), BOOKING_COLUMNS));
});
