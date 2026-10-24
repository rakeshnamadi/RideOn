import jwt from 'jsonwebtoken';
import { createHmac } from 'node:crypto';
import { env } from '../../config/env.js';
import { randomToken } from '../../utils/ids.js';

export interface AccessTokenClaims {
  sub: string;
  sid: string; // session id, so logout can be checked against revocation
  typ: 'access';
}

export function signAccessToken(userId: string, sessionId: string): string {
  return jwt.sign({ sub: userId, sid: sessionId, typ: 'access' } satisfies AccessTokenClaims, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    issuer: 'rideon-api',
    audience: 'rideon-web',
  });
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    issuer: 'rideon-api',
    audience: 'rideon-web',
  }) as jwt.JwtPayload;
  if (payload.typ !== 'access' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
    throw new Error('Malformed access token');
  }
  return { sub: payload.sub, sid: payload.sid, typ: 'access' };
}

/** Opaque refresh token. Only an HMAC (peppered hash) is stored in the database. */
export function newRefreshToken(): string {
  return randomToken(48);
}

export function hashRefreshToken(token: string): string {
  return createHmac('sha256', env.JWT_REFRESH_PEPPER).update(token).digest('hex');
}

export const REFRESH_COOKIE = 'rideon_rt';
