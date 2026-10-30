// Prepares the isolated E2E database, then runs the API in the foreground.
// Started by Playwright's webServer (see playwright.config.ts), which supplies the environment.
import { execSync, spawn } from 'node:child_process';
import path from 'node:path';

const api = path.resolve(import.meta.dirname, '../apps/api');
const run = (cmd) => execSync(cmd, { cwd: api, env: process.env, stdio: 'inherit' });

run('npx prisma migrate deploy');
run('npx tsx scripts/e2e-reset.ts');

const child = spawn('npx', ['tsx', 'src/server.ts'], { cwd: api, env: process.env, stdio: 'inherit', shell: true });
const stop = () => child.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
