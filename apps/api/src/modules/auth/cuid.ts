import { randomBytes } from 'node:crypto';

/** Collision-resistant id for values generated outside Prisma's @default(cuid()). */
export function createId(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString('hex')}`.slice(0, 30);
}
