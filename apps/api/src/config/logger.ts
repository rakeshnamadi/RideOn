import pino from 'pino';
import { env, isDev } from './env.js';

/** Paths scrubbed from every log line: credentials, tokens and personal contact data. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.phone',
  '*.email',
  '*.startPin',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  base: { service: 'rideon-api' },
  ...(isDev ? { transport: { target: 'pino-pretty', options: { colorize: true, singleLine: true } } } : {}),
});
