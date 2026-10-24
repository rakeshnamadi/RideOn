import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { auth, authenticate } from '../../middleware/auth.js';
import { unauthorized } from '../../utils/errors.js';
import { ok, parse } from '../../utils/http.js';
import { audit } from '../audit/audit.service.js';
import { revokeAllSessions } from '../auth/auth.service.js';
import { PhoneSchema } from '../auth/auth.routes.js';
import { hashPassword, PasswordSchema, verifyPassword } from '../auth/password.js';

export const userRoutes = Router();
userRoutes.use(authenticate);

userRoutes.patch('/me', async (req, res) => {
  const ctx = auth(req);
  const body = parse(
    z.object({
      name: z.string().trim().min(2).max(120).optional(),
      email: z.string().trim().toLowerCase().email().max(191).nullable().optional(),
      preferredLanguage: z.enum(['en', 'hi', 'kn', 'ta', 'te', 'mr']).optional(),
      trustedContactName: z.string().trim().max(120).nullable().optional(),
      trustedContactPhone: PhoneSchema.nullable().optional(),
    }),
    req.body,
  );
  const user = await prisma.user.update({
    where: { id: ctx.userId },
    data: body,
    select: { id: true, name: true, email: true, phone: true, preferredLanguage: true, trustedContactName: true, trustedContactPhone: true },
  });
  ok(res, user);
});

userRoutes.post('/me/password', async (req, res) => {
  const ctx = auth(req);
  const body = parse(z.object({ currentPassword: z.string().min(1).max(128), newPassword: PasswordSchema }), req.body);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  if (!(await verifyPassword(user.passwordHash, body.currentPassword))) throw unauthorized('Current password is incorrect');
  await prisma.user.update({ where: { id: ctx.userId }, data: { passwordHash: await hashPassword(body.newPassword) } });
  await revokeAllSessions(ctx.userId, 'PASSWORD_CHANGED');
  await audit({ action: 'auth.password_changed', entityType: 'User', entityId: ctx.userId }, { ctx, req });
  ok(res, { changed: true, reauthenticate: true });
});

userRoutes.get('/me/consents', async (req, res) => {
  ok(res, await prisma.userConsent.findMany({ where: { userId: auth(req).userId }, orderBy: { grantedAt: 'desc' } }));
});

userRoutes.post('/me/consents', async (req, res) => {
  const ctx = auth(req);
  const body = parse(z.object({ consentType: z.enum(['LOCATION_SHARING']), granted: z.boolean() }), req.body);
  if (body.granted) {
    await prisma.userConsent.create({ data: { userId: ctx.userId, consentType: body.consentType, version: '2026-10', ipAddress: req.ip } });
  } else {
    await prisma.userConsent.updateMany({ where: { userId: ctx.userId, consentType: body.consentType, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  ok(res, { consentType: body.consentType, granted: body.granted });
});
