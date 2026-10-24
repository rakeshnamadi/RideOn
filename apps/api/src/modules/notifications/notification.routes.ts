import { Router } from 'express';
import { prisma } from '../../db.js';
import { auth, authenticate } from '../../middleware/auth.js';
import { IdParam, ok, pageMeta, pagination, parse } from '../../utils/http.js';

export const notificationRoutes = Router();
notificationRoutes.use(authenticate);

notificationRoutes.get('/', async (req, res) => {
  const { userId } = auth(req);
  const { page, pageSize, skip, take } = pagination(req);
  const where = { userId };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  ok(res, items, { ...pageMeta(page, pageSize, total), unread });
});

notificationRoutes.post('/:id/read', async (req, res) => {
  const { id } = parse(IdParam, req.params);
  // Scoped by userId so nobody can mark another user's notification.
  await prisma.notification.updateMany({ where: { id, userId: auth(req).userId, readAt: null }, data: { readAt: new Date() } });
  ok(res, { id });
});

notificationRoutes.post('/read-all', async (req, res) => {
  const result = await prisma.notification.updateMany({
    where: { userId: auth(req).userId, readAt: null },
    data: { readAt: new Date() },
  });
  ok(res, { updated: result.count });
});
