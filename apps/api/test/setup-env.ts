import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Runs before each test file's imports, so src/config/env.ts sees the test configuration.
const rootEnv = path.resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

process.env.NODE_ENV = 'test';
if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must be set to run tests');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JOBS_ENABLED = 'false';
process.env.ROUTING_PROVIDER = 'none'; // deterministic distances: no network calls in tests
process.env.GEOCODING_PROVIDER = 'none';
process.env.PAYMENT_PROVIDER = 'mock';
process.env.LOG_LEVEL = 'silent';
process.env.UPLOAD_DIR = path.join(tmpdir(), 'rideon-test-uploads');
