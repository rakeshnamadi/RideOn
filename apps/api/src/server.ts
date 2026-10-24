import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { prisma } from './db.js';
import { startJobs } from './jobs/index.js';
import { closeSockets, initSockets } from './sockets/index.js';

const app = createApp();
const server = createServer(app);
initSockets(server);

await prisma.$connect();
const stopJobs = env.JOBS_ENABLED ? startJobs() : () => {};

server.listen(env.API_PORT, () => {
  logger.info(`RideOn API listening on http://localhost:${env.API_PORT}/api/v1 (${env.NODE_ENV})`);
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  stopJobs();
  await closeSockets();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
