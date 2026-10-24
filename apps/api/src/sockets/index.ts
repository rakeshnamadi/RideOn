import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../db.js';
import { loadAuthContext } from '../modules/auth/auth-context.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

let io: Server | null = null;

/**
 * Real-time channel. Every client joins `user:<id>`; community admins also join
 * `community:<id>` for each community they administer; super admins join `platform`.
 * The UI never depends solely on sockets — every screen also polls via REST.
 */
export function initSockets(server: HttpServer) {
  io = new Server(server, {
    path: '/socket.io',
    cors: { origin: env.WEB_ORIGIN.split(','), credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string') return next(new Error('unauthorized'));
      const claims = verifyAccessToken(token);
      const session = await prisma.session.findUnique({ where: { id: claims.sid } });
      if (!session || session.revokedAt || session.expiresAt < new Date()) return next(new Error('unauthorized'));
      const ctx = await loadAuthContext(claims.sub);
      socket.data.userId = ctx.userId;
      socket.data.rooms = [
        `user:${ctx.userId}`,
        ...(ctx.permissions.has('community.console') ? ctx.communityRoles.map((r) => `community:${r.communityId}`) : []),
        ...(ctx.roles.includes('SUPER_ADMIN') ? ['platform'] : []),
      ];
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    void socket.join(socket.data.rooms as string[]);
    socket.on('disconnect', () => logger.debug({ userId: socket.data.userId }, 'socket disconnected'));
  });
  return io;
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function emitToCommunity(communityId: string, event: string, payload: unknown) {
  io?.to(`community:${communityId}`).emit(event, payload);
}

export function emitToPlatform(event: string, payload: unknown) {
  io?.to('platform').emit(event, payload);
}

export function closeSockets() {
  return new Promise<void>((resolve) => (io ? io.close(() => resolve()) : resolve()));
}
