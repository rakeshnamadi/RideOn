import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Bring the test database schema up to date once per run (non-destructive).
 * Each integration test file then truncates and reseeds its data (see helpers.ts).
 */
export default function setup() {
  const rootEnv = path.resolve(import.meta.dirname, '../../../.env');
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL must be set to run tests');
  if (!/_test\b|test$/.test(new URL(url).pathname)) throw new Error('Refusing to use a test database whose name does not end in "test"');
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
