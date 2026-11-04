import supertest from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { seedDatabase, DEMO_PASSWORD } from '../prisma/seed.js';

export const app = createApp();
export const api = supertest(app);

/** Demo accounts created by the seed (see README). */
export const PHONES = {
  superAdmin: '9000000001',
  kmHead: '9000000002',
  kmAdmin: '9000000003',
  kmApprover: '9000000004',
  inHead: '9000000005',
  reporter: '9000000006',
  driver1: '9000000010',
  driver2: '9000000011',
  driver3: '9000000012',
  applicantDriver: '9000000013',
  inDriver: '9000000014',
  passenger: '9000000020',
  passenger2: '9000000021',
} as const;

/** Wipe every table (TRUNCATE bypasses the append-only triggers) and reseed demo data. */
export async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ name: string }[]>`
    SELECT TABLE_NAME AS name FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of tables) await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${t.name}\``);
  await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
  await seedDatabase(prisma);
}

const tokenCache = new Map<string, string>();
export async function login(phone: string, password = DEMO_PASSWORD): Promise<string> {
  const res = await api.post('/api/v1/auth/login').send({ identifier: phone, password });
  if (res.status !== 200) throw new Error(`Login failed for ${phone}: ${res.status} ${JSON.stringify(res.body)}`);
  tokenCache.set(phone, res.body.data.accessToken);
  return res.body.data.accessToken;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function communityBySlug(slug: string) {
  return prisma.community.findUniqueOrThrow({ where: { slug } });
}

/** Ainavilli Centre Stand and Kondukuduru — inside the Ainavilli union's service area (pincode 533211). */
export const PICKUP_POINT = { lat: 16.6638, lng: 82.031 };
export const DROP_POINT = { lat: 16.66, lng: 82.0777 };

let counter = 0;
export const idem = (prefix = 'test') => `${prefix}-${Date.now()}-${++counter}`;

/** Put a seeded driver online at a location inside the Ainavilli service area. */
export async function goOnline(token: string, communityId: string, at = PICKUP_POINT) {
  const res = await api.post('/api/v1/drivers/me/availability').set(bearer(token)).send({ status: 'ONLINE', communityId, ...at });
  if (res.status !== 200) throw new Error(`goOnline failed: ${JSON.stringify(res.body)}`);
}

export { prisma };
