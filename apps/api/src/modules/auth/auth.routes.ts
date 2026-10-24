import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { env, isProd } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../db.js';
import { auth, authenticate } from '../../middleware/auth.js';
import { authLimiter, requireCsrfHeader } from '../../middleware/security.js';
import { unauthorized } from '../../utils/errors.js';
import { created, ok, parse } from '../../utils/http.js';
import { communityPermissionsFor } from './auth-context.js';
import {
  authenticateCredentials,
  createPasswordReset,
  registerUser,
  resetPassword,
  revokeAllSessions,
  revokeByRefreshToken,
  rotateSession,
  startSession,
} from './auth.service.js';
import { PasswordSchema } from './password.js';
import { REFRESH_COOKIE } from './tokens.js';

export const PhoneSchema = z
  .string()
  .trim()
  .regex(/^(\+91)?[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number')
  .transform((p) => (p.startsWith('+91') ? p : `+91${p}`));

const RegisterSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: PhoneSchema,
  email: z.string().trim().toLowerCase().email().max(191).optional().or(z.literal('').transform(() => undefined)),
  password: PasswordSchema,
  accountType: z.enum(['PASSENGER', 'DRIVER']).default('PASSENGER'),
  preferredLanguage: z.enum(['en', 'hi', 'kn', 'ta', 'te', 'mr']).optional(),
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms to continue' }) }),
});

const LoginSchema = z.object({
  identifier: z.string().trim().min(3).max(191),
  password: z.string().min(1).max(128),
});

function normaliseIdentifier(identifier: string) {
  if (identifier.includes('@')) return identifier.toLowerCase();
  const digits = identifier.replace(/[\s-]/g, '');
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : digits;
}

function setRefreshCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/api/v1/auth',
    expires: expiresAt,
  });
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'strict', path: '/api/v1/auth' });
}

async function profilePayload(userId: string, req: Request) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      preferredLanguage: true,
      trustedContactName: true,
      trustedContactPhone: true,
      createdAt: true,
      driver: { select: { id: true, verificationStatus: true, status: true } },
      communityAdminRoles: {
        where: { active: true },
        select: { role: true, community: { select: { id: true, name: true, slug: true, status: true } } },
      },
    },
  });
  const ctx = req.auth!;
  return {
    ...user,
    roles: ctx.roles,
    permissions: [...ctx.permissions],
    communities: user.communityAdminRoles.map((r) => ({
      ...r.community,
      role: r.role,
      permissions: communityPermissionsFor(ctx, r.community.id),
    })),
  };
}

export const authRoutes = Router();

authRoutes.post('/register', authLimiter, async (req, res) => {
  const input = parse(RegisterSchema, req.body);
  const userId = await registerUser(input, req);
  const session = await startSession(userId, req);
  setRefreshCookie(res, session.refreshToken, session.expiresAt);
  created(res, { accessToken: session.accessToken, userId });
});

authRoutes.post('/login', authLimiter, async (req, res) => {
  const { identifier, password } = parse(LoginSchema, req.body);
  const user = await authenticateCredentials(normaliseIdentifier(identifier), password);
  const session = await startSession(user.id, req);
  setRefreshCookie(res, session.refreshToken, session.expiresAt);
  ok(res, { accessToken: session.accessToken, userId: user.id });
});

authRoutes.post('/refresh', authLimiter, requireCsrfHeader, async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (typeof token !== 'string') throw unauthorized('No session');
  try {
    const session = await rotateSession(token, req);
    setRefreshCookie(res, session.refreshToken, session.expiresAt);
    ok(res, { accessToken: session.accessToken });
  } catch (err) {
    clearRefreshCookie(res);
    throw err;
  }
});

authRoutes.post('/logout', requireCsrfHeader, async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (typeof token === 'string') await revokeByRefreshToken(token);
  clearRefreshCookie(res);
  ok(res, { loggedOut: true });
});

authRoutes.post('/logout-all', authenticate, async (req, res) => {
  await revokeAllSessions(auth(req).userId, 'LOGOUT_ALL');
  clearRefreshCookie(res);
  ok(res, { loggedOut: true });
});

authRoutes.get('/me', authenticate, async (req, res) => {
  ok(res, await profilePayload(auth(req).userId, req));
});

authRoutes.post('/password/forgot', authLimiter, async (req, res) => {
  const { identifier } = parse(z.object({ identifier: z.string().trim().min(3).max(191) }), req.body);
  const token = await createPasswordReset(normaliseIdentifier(identifier));
  if (token) logger.info('Password reset token issued (delivery provider not configured)');
  // Same response whether or not the account exists, to avoid account enumeration.
  ok(res, {
    message: 'If an account exists, password reset instructions have been sent.',
    ...(!isProd && token ? { devResetToken: token, devNotice: 'Development only: no SMS/email provider is configured.' } : {}),
  });
});

authRoutes.post('/password/reset', authLimiter, async (req, res) => {
  const { token, newPassword } = parse(z.object({ token: z.string().min(10).max(200), newPassword: PasswordSchema }), req.body);
  await resetPassword(token, newPassword, req);
  ok(res, { reset: true });
});
