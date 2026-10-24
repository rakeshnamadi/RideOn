import jwt from 'jsonwebtoken';
import { beforeAll, describe, expect, it } from 'vitest';
import { api, bearer, login, PHONES, prisma, resetDatabase } from '../helpers.js';

const CSRF = { 'X-Requested-With': 'rideon' };

function refreshCookie(res: { headers: Record<string, unknown> }) {
  const cookies = res.headers['set-cookie'] as string[] | undefined;
  return cookies?.find((c) => c.startsWith('rideon_rt='))?.split(';')[0];
}

describe('authentication and sessions', () => {
  beforeAll(resetDatabase);

  it('registers a passenger with a secure, http-only refresh cookie', async () => {
    const res = await api.post('/api/v1/auth/register').send({ name: 'Test Rider', phone: '9876543210', password: 'Secure-pass-123', acceptTerms: true });
    expect(res.status).toBe(201);
    expect(res.body.data.accessToken).toBeTruthy();
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('rideon_rt='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    const me = await api.get('/api/v1/auth/me').set(bearer(res.body.data.accessToken));
    expect(me.body.data.roles).toEqual(['PASSENGER']);
    expect(me.body.data.phone).toBe('+919876543210');
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: '+919876543210' } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('rejects duplicate accounts, weak passwords and missing consent', async () => {
    expect((await api.post('/api/v1/auth/register').send({ name: 'Dup', phone: '9876543210', password: 'Secure-pass-123', acceptTerms: true })).status).toBe(409);
    expect((await api.post('/api/v1/auth/register').send({ name: 'Weak', phone: '9876500000', password: 'short', acceptTerms: true })).status).toBe(400);
    expect((await api.post('/api/v1/auth/register').send({ name: 'NoTerms', phone: '9876500001', password: 'Secure-pass-123' })).status).toBe(400);
  });

  it('cannot self-register as an administrator', async () => {
    const res = await api.post('/api/v1/auth/register').send({ name: 'Sneaky', phone: '9876500002', password: 'Secure-pass-123', acceptTerms: true, accountType: 'SUPER_ADMIN' });
    expect(res.status).toBe(400);
  });

  it('rejects missing, malformed, forged and expired access tokens', async () => {
    expect((await api.get('/api/v1/auth/me')).status).toBe(401);
    expect((await api.get('/api/v1/auth/me').set('Authorization', 'Bearer not-a-jwt')).status).toBe(401);
    const forged = jwt.sign({ sub: 'x', sid: 'y', typ: 'access' }, 'wrong-secret-wrong-secret-wrong-secret', { issuer: 'rideon-api', audience: 'rideon-web' });
    expect((await api.get('/api/v1/auth/me').set(bearer(forged))).status).toBe(401);

    const token = await login(PHONES.passenger);
    const { sub, sid } = jwt.decode(token) as { sub: string; sid: string };
    const expired = jwt.sign({ sub, sid, typ: 'access', exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_ACCESS_SECRET!, { issuer: 'rideon-api', audience: 'rideon-web' });
    const res = await api.get('/api/v1/auth/me').set(bearer(expired));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rotates refresh tokens, requires the CSRF header, and revokes the family on reuse', async () => {
    const loginRes = await api.post('/api/v1/auth/login').send({ identifier: PHONES.passenger2, password: 'Demo@12345' });
    const first = refreshCookie(loginRes)!;
    expect((await api.post('/api/v1/auth/refresh').set('Cookie', first)).status).toBe(403); // no CSRF header

    const rotated = await api.post('/api/v1/auth/refresh').set('Cookie', first).set(CSRF);
    expect(rotated.status).toBe(200);
    const second = refreshCookie(rotated)!;
    expect(second).not.toBe(first);

    // Replaying the first (already rotated) token is treated as theft…
    expect((await api.post('/api/v1/auth/refresh').set('Cookie', first).set(CSRF)).status).toBe(401);
    // …and kills the whole session family, including the newest token.
    expect((await api.post('/api/v1/auth/refresh').set('Cookie', second).set(CSRF)).status).toBe(401);
    expect((await api.get('/api/v1/auth/me').set(bearer(rotated.body.data.accessToken))).status).toBe(401);
  });

  it('logout revokes the session immediately', async () => {
    const res = await api.post('/api/v1/auth/login').send({ identifier: PHONES.passenger2, password: 'Demo@12345' });
    const token = res.body.data.accessToken;
    expect((await api.get('/api/v1/auth/me').set(bearer(token))).status).toBe(200);
    await api.post('/api/v1/auth/logout').set('Cookie', refreshCookie(res)!).set(CSRF).expect(200);
    expect((await api.get('/api/v1/auth/me').set(bearer(token))).status).toBe(401);
  });

  it('locks the account after repeated failures', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await api.post('/api/v1/auth/login').send({ identifier: '9876543210', password: 'wrong-password-1' })).status).toBe(401);
    }
    const locked = await api.post('/api/v1/auth/login').send({ identifier: '9876543210', password: 'Secure-pass-123' });
    expect(locked.status).toBe(423);
  });

  it('suspension blocks login and invalidates existing tokens', async () => {
    const victim = await login(PHONES.passenger2);
    const admin = await login(PHONES.superAdmin);
    const user = await prisma.user.findUniqueOrThrow({ where: { phone: `+91${PHONES.passenger2}` } });
    await api.post(`/api/v1/admin/users/${user.id}/status`).set(bearer(admin)).send({ status: 'SUSPENDED', reason: 'Test suspension' }).expect(200);
    expect((await api.get('/api/v1/auth/me').set(bearer(victim))).status).toBe(401);
    expect((await api.post('/api/v1/auth/login').send({ identifier: PHONES.passenger2, password: 'Demo@12345' })).status).toBe(403);
    await api.post(`/api/v1/admin/users/${user.id}/status`).set(bearer(admin)).send({ status: 'ACTIVE', reason: 'Reinstated' }).expect(200);
  });

  it('supports password recovery with single-use tokens', async () => {
    const forgot = await api.post('/api/v1/auth/password/forgot').send({ identifier: PHONES.passenger2 });
    expect(forgot.status).toBe(200);
    const token = forgot.body.data.devResetToken;
    expect(token).toBeTruthy();
    await api.post('/api/v1/auth/password/reset').send({ token, newPassword: 'Brand-new-pass-1' }).expect(200);
    expect((await api.post('/api/v1/auth/password/reset').send({ token, newPassword: 'Another-pass-22' })).status).toBe(401);
    await login(PHONES.passenger2, 'Brand-new-pass-1');
    // Unknown accounts get the same response (no account enumeration).
    const unknown = await api.post('/api/v1/auth/password/forgot').send({ identifier: '9999999999' });
    expect(unknown.status).toBe(200);
    expect(unknown.body.data.devResetToken).toBeUndefined();
  });
});
