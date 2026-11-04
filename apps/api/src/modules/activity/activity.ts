import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { isTest } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../db.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { ok, pageMeta, pagination, parse, toCsv } from '../../utils/http.js';

/** Requests not worth recording (health probes, CORS preflight, the dev mock gateway's static page). */
const SKIP = [/^\/api\/v1\/health$/, /^\/socket\.io/];

/** Sensitive path segments (share/reset tokens) are masked before the path is stored. */
function cleanPath(url: string) {
  const path = url.split('?')[0]!.slice(0, 300);
  return path.replace(/\/track\/[^/]+/, '/track/[token]').replace(/\/mock-gateway\/[^/]+/, '/mock-gateway/[ref]');
}

function communityFromPath(path: string) {
  return /\/communities\/([a-z0-9]{20,30})(\/|$)/.exec(path)?.[1] ?? /\/fares\/communities\/([a-z0-9]{20,30})/.exec(path)?.[1] ?? null;
}

/**
 * Website activity log: one row per API request, written after the response is sent so it
 * never slows or breaks a request. Records who (user id once authenticated), what (method,
 * path, union), the outcome (status, duration) and where from (IP, user agent, request id).
 */
export function activityLogger(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'OPTIONS' || SKIP.some((r) => r.test(req.path)) || (isTest && process.env.ACTIVITY_LOG_IN_TESTS !== 'true')) return next();
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const path = cleanPath(req.originalUrl);
    prisma.activityLog
      .create({
        data: {
          userId: req.auth?.userId ?? null,
          method: req.method,
          path,
          statusCode: res.statusCode,
          durationMs: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
          communityId: communityFromPath(path),
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent']?.slice(0, 255) ?? null,
          requestId: req.requestId ?? null,
        },
      })
      .catch((err) => logger.warn({ err: (err as Error).message }, 'Could not write activity log'));
  });
  next();
}

export const ACTIVITY_RETENTION_DAYS = 90;

export async function purgeOldActivity() {
  const cutoff = new Date(Date.now() - ACTIVITY_RETENTION_DAYS * 86_400_000);
  const { count } = await prisma.activityLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
}

// ─────────── Super admin: browse, summarise and export the activity log ───────────

const FilterSchema = z.object({
  userId: z.string().max(40).optional(),
  communityId: z.string().max(40).optional(),
  path: z.string().max(100).optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
  outcome: z.enum(['success', 'client_error', 'server_error']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

function whereFrom(q: z.infer<typeof FilterSchema>) {
  const status =
    q.outcome === 'success' ? { lt: 400 } : q.outcome === 'client_error' ? { gte: 400, lt: 500 } : q.outcome === 'server_error' ? { gte: 500 } : undefined;
  return {
    ...(q.userId ? { userId: q.userId } : {}),
    ...(q.communityId ? { communityId: q.communityId } : {}),
    ...(q.path ? { path: { contains: q.path } } : {}),
    ...(q.method ? { method: q.method } : {}),
    ...(status ? { statusCode: status } : {}),
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } } : {}),
  };
}

async function withUserNames<T extends { userId: string | null }>(rows: T[]) {
  const ids = [...new Set(rows.map((r) => r.userId).filter((x): x is string => !!x))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, userName: r.userId ? (names.get(r.userId) ?? null) : null }));
}

export const activityRoutes = Router();
activityRoutes.use(authenticate, requirePermission('platform.audit.view'));

activityRoutes.get('/', async (req, res) => {
  const q = parse(FilterSchema, req.query);
  const { page, pageSize, skip, take } = pagination(req);
  const where = whereFrom(q);
  const [items, total] = await Promise.all([
    prisma.activityLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.activityLog.count({ where }),
  ]);
  ok(res, await withUserNames(items), pageMeta(page, pageSize, total));
});

/** Last-24-hours overview: volume, error rates, slowest and busiest endpoints, most active users. */
activityRoutes.get('/summary', async (_req, res) => {
  const since = new Date(Date.now() - 86_400_000);
  const where = { createdAt: { gte: since } };
  const [total, clientErrors, serverErrors, busiest, slowest, users, signedIn] = await Promise.all([
    prisma.activityLog.count({ where }),
    prisma.activityLog.count({ where: { ...where, statusCode: { gte: 400, lt: 500 } } }),
    prisma.activityLog.count({ where: { ...where, statusCode: { gte: 500 } } }),
    prisma.activityLog.groupBy({ by: ['method', 'path'], where, _count: true, orderBy: { _count: { path: 'desc' } }, take: 8 }),
    prisma.activityLog.groupBy({ by: ['method', 'path'], where, _avg: { durationMs: true }, orderBy: { _avg: { durationMs: 'desc' } }, take: 5 }),
    prisma.activityLog.groupBy({ by: ['userId'], where: { ...where, userId: { not: null } }, _count: true, orderBy: { _count: { userId: 'desc' } }, take: 5 }),
    prisma.activityLog.findMany({ where: { ...where, userId: { not: null } }, distinct: ['userId'], select: { userId: true } }),
  ]);
  ok(res, {
    windowHours: 24,
    total,
    clientErrors,
    serverErrors,
    activeUsers: signedIn.length,
    busiest: busiest.map((b) => ({ method: b.method, path: b.path, count: b._count })),
    slowest: slowest.map((s) => ({ method: s.method, path: s.path, avgMs: Math.round(s._avg.durationMs ?? 0) })),
    topUsers: await withUserNames(users.map((u) => ({ userId: u.userId, count: u._count }))),
    retentionDays: ACTIVITY_RETENTION_DAYS,
  });
});

activityRoutes.get('/export.csv', async (req, res) => {
  const q = parse(FilterSchema, req.query);
  const rows = await withUserNames(await prisma.activityLog.findMany({ where: whereFrom(q), orderBy: { createdAt: 'desc' }, take: 50_000 }));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="rideon-activity.csv"');
  res.send(toCsv(rows, ['createdAt', 'userName', 'userId', 'method', 'path', 'statusCode', 'durationMs', 'communityId', 'ipAddress', 'requestId']));
});
