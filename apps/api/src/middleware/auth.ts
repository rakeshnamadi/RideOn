import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import { hasPermission, hasRole, loadAuthContext, type AuthContext } from '../modules/auth/auth-context.js';
import type { GlobalPermission, SystemRole } from '../modules/auth/permissions.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
    requestId?: string;
  }
}

async function resolveAuth(req: Request): Promise<AuthContext | null> {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized('Malformed Authorization header');
  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch {
    throw unauthorized('Invalid or expired access token');
  }
  // Session must still be live — this makes logout and revocation immediate.
  const session = await prisma.session.findUnique({
    where: { id: claims.sid },
    select: { userId: true, revokedAt: true, expiresAt: true },
  });
  if (!session || session.userId !== claims.sub || session.revokedAt || session.expiresAt < new Date()) {
    throw unauthorized('Session has ended');
  }
  return loadAuthContext(claims.sub);
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const ctx = await resolveAuth(req);
  if (!ctx) throw unauthorized();
  req.auth = ctx;
  next();
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  req.auth = (await resolveAuth(req)) ?? undefined;
  next();
}

export function requireRole(...roles: SystemRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw unauthorized();
    if (!roles.some((r) => hasRole(req.auth!, r))) throw forbidden();
    next();
  };
}

export function requirePermission(perm: GlobalPermission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw unauthorized();
    if (!hasPermission(req.auth, perm)) throw forbidden();
    next();
  };
}

/** Narrow helper for handlers that already ran authenticate. */
export function auth(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
