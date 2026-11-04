import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { globalLimiter, requestId } from './middleware/security.js';
import { activityLogger, activityRoutes } from './modules/activity/activity.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { bookingRoutes } from './modules/bookings/booking.routes.js';
import { communityRoutes } from './modules/communities/community.routes.js';
import { communityOpsRoutes } from './modules/communities/operations.routes.js';
import { driverRoutes } from './modules/drivers/driver.routes.js';
import { fareFeedbackRoutes } from './modules/fares/feedback.routes.js';
import { fareRoutes } from './modules/fares/fare.routes.js';
import { geoRoutes } from './modules/geo/geo.routes.js';
import { notificationRoutes } from './modules/notifications/notification.routes.js';
import { paymentRoutes } from './modules/payments/payment.routes.js';
import { publicRoutes } from './modules/public/public.routes.js';
import { communityReportRoutes } from './modules/reports/community-reports.routes.js';
import { reportRoutes } from './modules/reports/report.routes.js';
import { sharedTripRoutes } from './modules/shared-trips/shared-trip.routes.js';
import { complaintRoutes, ratingRoutes, supportRoutes } from './modules/support/support.routes.js';
import { userRoutes } from './modules/users/user.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestId);
  app.use(activityLogger);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId ?? 'unknown',
      autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
      serializers: {
        req: (req: { method: string; url: string; id: string }) => ({ method: req.method, url: req.url.split('?')[0], id: req.id }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(
    cors({
      origin: env.WEB_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-Id'],
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      maxAge: 600,
    }),
  );
  // Webhooks verify signatures over the raw body, so they must skip the JSON parser.
  const json = express.json({ limit: '100kb' });
  app.use((req, res, next) => (req.path.startsWith('/api/v1/payments/webhooks/') ? next() : json(req, res, next)));
  app.use(cookieParser());
  app.use('/api', globalLimiter);

  const v1 = Router();
  v1.use('/', publicRoutes);
  v1.use('/auth', authRoutes);
  v1.use('/users', userRoutes);
  v1.use('/geo', geoRoutes);
  v1.use('/communities', communityRoutes);
  v1.use('/communities/:communityId/reports', communityReportRoutes);
  v1.use('/communities/:communityId', communityOpsRoutes);
  v1.use('/drivers', driverRoutes);
  v1.use('/fares', fareRoutes);
  v1.use('/fare-feedback', fareFeedbackRoutes);
  v1.use('/bookings', bookingRoutes);
  v1.use('/shared-trips', sharedTripRoutes);
  v1.use('/payments', paymentRoutes);
  v1.use('/ratings', ratingRoutes);
  v1.use('/complaints', complaintRoutes);
  v1.use('/support-tickets', supportRoutes);
  v1.use('/notifications', notificationRoutes);
  v1.use('/reports', reportRoutes);
  v1.use('/admin/activity', activityRoutes);
  v1.use('/admin', adminRoutes);
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
