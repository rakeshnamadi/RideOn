import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Browser end-to-end tests. They run against an isolated stack — the `rideon_e2e`
 * database (migrated and reseeded on every run), an API on :4100 and the web app on
 * :5174 — so they never touch development data. Uses the locally installed Google Chrome
 * (`channel: 'chrome'`), so no Playwright browser download is needed.
 */
const rootEnv = path.resolve(process.cwd(), '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
const e2eDatabaseUrl = base.replace(/\/([^/?]+)(\?|$)/, '/rideon_e2e$2');

export const API_PORT = 4100;
export const WEB_PORT = 5174;

export default defineConfig({
  testDir: './e2e/specs',
  // One shared database and seeded actors: run journeys one at a time, in file order.
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/report' }]],
  outputDir: 'e2e/test-results',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    channel: 'chrome',
    headless: true,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    viewport: { width: 1280, height: 860 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node e2e/start-api.mjs',
      url: `http://localhost:${API_PORT}/api/v1/health`,
      timeout: 240_000,
      reuseExistingServer: false,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        ...(process.env as Record<string, string>),
        NODE_ENV: 'test',
        ACTIVITY_LOG_IN_TESTS: 'true',
        API_PORT: String(API_PORT),
        DATABASE_URL: e2eDatabaseUrl,
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        JOBS_ENABLED: 'true',
        ROUTING_PROVIDER: 'none',
        GEOCODING_PROVIDER: 'none',
        PAYMENT_PROVIDER: 'mock',
        LOG_LEVEL: 'warn',
        UPLOAD_DIR: path.join(tmpdir(), 'rideon-e2e-uploads'),
      },
    },
    {
      command: `node node_modules/vite/bin/vite.js apps/web --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'ignore',
      env: { ...(process.env as Record<string, string>), VITE_API_PROXY: `http://localhost:${API_PORT}` },
    },
  ],
});
