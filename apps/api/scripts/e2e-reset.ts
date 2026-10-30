/**
 * Reset the browser-test (E2E) database: truncate every table and load the development
 * seed. Refuses to run unless the database name ends in "_e2e".
 */
import { PrismaClient } from '@prisma/client';
import { seedDatabase } from '../prisma/seed.js';

const dbName = new URL(process.env.DATABASE_URL ?? 'mysql://x/none').pathname.slice(1);
if (!dbName.endsWith('_e2e')) {
  console.error('Refusing to reset: DATABASE_URL must point at a database whose name ends in "_e2e".');
  process.exit(1);
}

const prisma = new PrismaClient();
const tables = await prisma.$queryRaw<{ name: string }[]>`
  SELECT TABLE_NAME AS name FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> '_prisma_migrations'`;
await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
for (const t of tables) await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${t.name}\``);
await prisma.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
await seedDatabase(prisma);
await prisma.$disconnect();
console.warn(`E2E database reset and seeded (${tables.length} tables).`);
