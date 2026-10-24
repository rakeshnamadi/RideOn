import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma, type Db } from '../../db.js';
import type { AuthContext } from '../auth/auth-context.js';

const SENSITIVE_KEYS = /password|token|secret|pin|hash/i;

/** Strip secrets from audit snapshots; keep the rest so the history is meaningful. */
function sanitize(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (key, v) => (key && SENSITIVE_KEYS.test(key) ? '[REDACTED]' : v)),
  ) as Prisma.InputJsonValue;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  communityId?: string | null;
  before?: unknown;
  after?: unknown;
}

function primaryRole(ctx?: AuthContext | null) {
  if (!ctx) return 'SYSTEM';
  for (const r of ['SUPER_ADMIN', 'COMMUNITY_ADMIN', 'DRIVER', 'PASSENGER'] as const) if (ctx.roles.includes(r)) return r;
  return 'USER';
}

/** Append an entry to the immutable audit log. Pass a transaction client to make it atomic with the change. */
export async function audit(
  entry: AuditEntry,
  actor: { ctx?: AuthContext | null; req?: Request } = {},
  db: Db = prisma,
) {
  await db.auditLog.create({
    data: {
      actorId: actor.ctx?.userId ?? null,
      actorRole: primaryRole(actor.ctx),
      communityId: entry.communityId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: sanitize(entry.before),
      after: sanitize(entry.after),
      ipAddress: actor.req?.ip ?? null,
      requestId: actor.req?.requestId ?? null,
    },
  });
}
