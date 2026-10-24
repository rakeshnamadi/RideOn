import type { NextFunction, Request, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { isTest } from '../config/env.js';
import { forbidden } from '../utils/errors.js';

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id'];
  req.requestId = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

const limiter = (windowMs: number, limit: number, keyByUser = false) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => isTest,
    ...(keyByUser ? { keyGenerator: (req: Request) => req.auth?.userId ?? ipKeyGenerator(req.ip ?? '0.0.0.0') } : {}),
    handler: (req, res) =>
      res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.', requestId: req.requestId } }),
  });

export const globalLimiter = limiter(60_000, 600);
export const authLimiter = limiter(15 * 60_000, 30);
export const geoLimiter = limiter(60_000, 40, true);
export const sensitiveLimiter = limiter(60_000, 30, true);

/**
 * CSRF defence for the cookie-authenticated endpoints (refresh/logout).
 * Browsers will not send a custom header cross-origin without a CORS preflight,
 * which our CORS policy rejects for foreign origins; the refresh cookie is also SameSite=Strict.
 */
export function requireCsrfHeader(req: Request, _res: Response, next: NextFunction) {
  if (req.headers['x-requested-with'] !== 'rideon') throw forbidden('Missing CSRF header');
  next();
}
