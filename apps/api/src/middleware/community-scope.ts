import { param } from '../utils/http.js';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db.js';
import { notFound, unauthorized } from '../utils/errors.js';
import { assertCommunityPermission } from '../modules/auth/auth-context.js';
import type { CommunityPermission } from '../modules/auth/permissions.js';

/**
 * Guard for /communities/:communityId/... routes. Verifies the community exists and the
 * caller holds `perm` within *that* community. Handlers must still scope every query
 * by param(req, 'communityId') — never by an ID taken from the request body.
 */
export function requireCommunity(perm: CommunityPermission) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw unauthorized();
    const communityId = param(req, 'communityId');
    if (!communityId) throw notFound('Community');
    assertCommunityPermission(req.auth, communityId, perm);
    const exists = await prisma.community.findUnique({ where: { id: communityId }, select: { id: true } });
    if (!exists) throw notFound('Community');
    next();
  };
}

export function communityId(req: Request): string {
  return param(req, 'communityId') as string;
}
