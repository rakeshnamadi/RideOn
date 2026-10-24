import type { Request } from 'express';
import { prisma } from '../../db.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { AppError, conflict, forbidden, unauthorized } from '../../utils/errors.js';
import { randomToken, sha256 } from '../../utils/ids.js';
import { addDays, addMinutes } from '../../utils/time.js';
import { audit } from '../audit/audit.service.js';
import { dummyVerify, hashPassword, verifyPassword } from './password.js';
import { hashRefreshToken, newRefreshToken, signAccessToken } from './tokens.js';
import { createId } from './cuid.js';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;
export const CURRENT_TERMS_VERSION = '2026-10';

export interface RegisterInput {
  name: string;
  phone: string;
  email?: string | null;
  password: string;
  accountType: 'PASSENGER' | 'DRIVER';
  preferredLanguage?: string;
  acceptTerms: true;
}

export async function registerUser(input: RegisterInput, req: Request) {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ phone: input.phone }, ...(input.email ? [{ email: input.email }] : [])] },
    select: { id: true },
  });
  if (existing) throw conflict('An account with this phone number or email already exists', 'ACCOUNT_EXISTS');

  const passwordHash = await hashPassword(input.password);
  const role = await prisma.role.findUniqueOrThrow({ where: { key: input.accountType } });
  const user = await prisma.user.create({
    data: {
      name: input.name,
      phone: input.phone,
      email: input.email || null,
      passwordHash,
      preferredLanguage: input.preferredLanguage ?? 'en',
      roles: { create: { roleId: role.id } },
      consents: {
        create: [
          { consentType: 'TERMS_OF_SERVICE', version: CURRENT_TERMS_VERSION, ipAddress: req.ip },
          { consentType: 'PRIVACY_POLICY', version: CURRENT_TERMS_VERSION, ipAddress: req.ip },
        ],
      },
    },
    select: { id: true },
  });
  await audit({ action: 'user.registered', entityType: 'User', entityId: user.id, after: { accountType: input.accountType } }, { req });
  return user.id;
}

export async function authenticateCredentials(identifier: string, password: string) {
  const user = await prisma.user.findFirst({
    where: identifier.includes('@') ? { email: identifier.toLowerCase() } : { phone: identifier },
  });
  if (!user) {
    await dummyVerify(password);
    throw unauthorized('Incorrect phone/email or password');
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(
      423,
      'ACCOUNT_LOCKED',
      'Too many failed attempts. Try again later or reset your password.',
    );
  }
  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    const failed = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failed >= MAX_FAILED_LOGINS ? 0 : failed,
        lockedUntil: failed >= MAX_FAILED_LOGINS ? addMinutes(new Date(), LOCKOUT_MINUTES) : null,
      },
    });
    throw unauthorized('Incorrect phone/email or password');
  }
  if (user.status !== 'ACTIVE') throw forbidden('This account is suspended. Contact support for help.');
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  return user;
}

/** Create a session (refresh-token family) and return both tokens. */
export async function startSession(userId: string, req: Request) {
  const refreshToken = newRefreshToken();
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashRefreshToken(refreshToken),
      familyId: createId(),
      userAgent: req.headers['user-agent']?.slice(0, 255) ?? null,
      ipAddress: req.ip ?? null,
      expiresAt: addDays(new Date(), env.REFRESH_TOKEN_TTL_DAYS),
    },
  });
  return { accessToken: signAccessToken(userId, session.id), refreshToken, expiresAt: session.expiresAt };
}

/**
 * Rotate a refresh token. Presenting an already-rotated token means it was stolen
 * or replayed: the entire session family is revoked.
 */
export async function rotateSession(refreshToken: string, req: Request) {
  const tokenHash = hashRefreshToken(refreshToken);
  const session = await prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!session) throw unauthorized('Session not found');
  if (session.rotatedAt || session.revokedAt) {
    if (session.rotatedAt && !session.revokedAt) {
      await prisma.session.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: 'TOKEN_REUSE' },
      });
      logger.warn({ userId: session.userId }, 'Refresh token reuse detected; session family revoked');
      await audit({ action: 'auth.refresh_reuse_detected', entityType: 'Session', entityId: session.id }, { req });
    }
    throw unauthorized('Session has ended');
  }
  if (session.expiresAt < new Date()) throw unauthorized('Session expired');
  if (session.user.status !== 'ACTIVE') throw forbidden('This account is suspended');

  const next = newRefreshToken();
  const now = new Date();
  // Conditional update guards against two concurrent refreshes both succeeding.
  const marked = await prisma.session.updateMany({
    where: { id: session.id, rotatedAt: null, revokedAt: null },
    data: { rotatedAt: now, revokedAt: now, revokeReason: 'ROTATED' },
  });
  if (marked.count === 0) throw unauthorized('Session has ended');
  const created = await prisma.session.create({
    data: {
      userId: session.userId,
      tokenHash: hashRefreshToken(next),
      familyId: session.familyId,
      userAgent: req.headers['user-agent']?.slice(0, 255) ?? null,
      ipAddress: req.ip ?? null,
      expiresAt: session.expiresAt, // absolute lifetime does not extend on rotation
    },
  });
  return { accessToken: signAccessToken(session.userId, created.id), refreshToken: next, expiresAt: created.expiresAt };
}

export async function revokeByRefreshToken(refreshToken: string) {
  const session = await prisma.session.findUnique({ where: { tokenHash: hashRefreshToken(refreshToken) } });
  if (session) {
    await prisma.session.updateMany({
      where: { familyId: session.familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'LOGOUT' },
    });
  }
}

export async function revokeAllSessions(userId: string, reason: string) {
  await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: reason } });
}

/**
 * Begin password recovery. Returns the raw token so the caller can deliver it.
 * No SMS/email provider is integrated yet; in development the token is returned
 * in the API response (see docs/security.md).
 */
export async function createPasswordReset(identifier: string): Promise<string | null> {
  const user = await prisma.user.findFirst({
    where: identifier.includes('@') ? { email: identifier.toLowerCase() } : { phone: identifier },
  });
  if (!user || user.status === 'DEACTIVATED') return null;
  const token = randomToken(32);
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: sha256(token), expiresAt: addMinutes(new Date(), 30) },
  });
  return token;
}

export async function resetPassword(token: string, newPassword: string, req: Request) {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) throw unauthorized('Reset link is invalid or has expired');
  const used = await prisma.passwordResetToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (used.count === 0) throw unauthorized('Reset link is invalid or has expired');
  await prisma.user.update({
    where: { id: record.userId },
    data: { passwordHash: await hashPassword(newPassword), failedLoginCount: 0, lockedUntil: null },
  });
  await revokeAllSessions(record.userId, 'PASSWORD_RESET');
  await audit({ action: 'auth.password_reset', entityType: 'User', entityId: record.userId }, { req });
}
