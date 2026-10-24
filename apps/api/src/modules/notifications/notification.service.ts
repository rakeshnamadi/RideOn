import { prisma } from '../../db.js';
import { logger } from '../../config/logger.js';
import { emitToUser } from '../../sockets/index.js';

export interface NotificationInput {
  type: string;
  title: string;
  body: string;
  link?: string;
}

/**
 * Persist an in-app notification and push it over the socket. Delivery failures are
 * logged, never thrown — a notification must not roll back the business operation
 * that triggered it, so call this after the transaction commits.
 */
export async function notify(userIds: string | string[], input: NotificationInput) {
  const ids = [...new Set(Array.isArray(userIds) ? userIds : [userIds])];
  if (ids.length === 0) return;
  try {
    await prisma.notification.createMany({ data: ids.map((userId) => ({ userId, ...input })) });
    for (const id of ids) emitToUser(id, 'notification', input);
  } catch (err) {
    logger.warn({ err, type: input.type }, 'Failed to deliver notification');
  }
}

export async function communityAdminUserIds(communityId: string): Promise<string[]> {
  const admins = await prisma.communityAdmin.findMany({
    where: { communityId, active: true },
    select: { userId: true },
  });
  return admins.map((a) => a.userId);
}

export async function superAdminUserIds(): Promise<string[]> {
  const users = await prisma.userRole.findMany({
    where: { role: { key: 'SUPER_ADMIN' }, user: { status: 'ACTIVE' } },
    select: { userId: true },
  });
  return users.map((u) => u.userId);
}
