import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_PEPPER: z.string().min(32, 'JWT_REFRESH_PEPPER must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),
  COOKIE_SECURE: bool.default('false'),
  UPLOAD_DIR: z.string().default('./uploads'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  GEOCODING_PROVIDER: z.enum(['nominatim', 'none']).default('nominatim'),
  GEOCODING_URL: z.string().url().default('https://nominatim.openstreetmap.org'),
  GEOCODING_USER_AGENT: z.string().default('RideOn/0.1'),
  ROUTING_PROVIDER: z.enum(['osrm', 'none']).default('osrm'),
  ROUTING_URL: z.string().url().default('https://router.project-osrm.org'),
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(4000),
  PAYMENT_PROVIDER: z.enum(['mock', 'none']).default('mock'),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16),
  JOBS_ENABLED: bool.default('true'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (!env.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
    if (env.PAYMENT_PROVIDER === 'mock') throw new Error('The mock payment provider cannot be used in production');
  }
  return env;
}

export const env = loadEnv();
export const isDev = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';
export const isProd = env.NODE_ENV === 'production';
