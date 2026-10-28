import { Router } from 'express';
import { prisma } from '../../db.js';
import { env } from '../../config/env.js';
import { notFound } from '../../utils/errors.js';
import { ok, param } from '../../utils/http.js';
import { DEFAULT_PLATFORM_FEE_BPS } from '../payments/payment.service.js';

export const publicRoutes = Router();

publicRoutes.get('/health', async (_req, res) => {
  let database = 'up';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = 'down';
  }
  res.status(database === 'up' ? 200 : 503).json({ data: { status: database === 'up' ? 'ok' : 'degraded', database, time: new Date().toISOString() } });
});

publicRoutes.get('/config', async (_req, res) => {
  const flags = await prisma.featureFlag.findMany({ select: { key: true, enabled: true } });
  // Platform fees are public: drivers and passengers should be able to see exactly what the platform takes.
  const platformFees = Object.fromEntries(
    await Promise.all(
      (['REGULAR', 'SHARED'] as const).map(async (serviceType) => {
        const fee = await prisma.platformFeeConfig.findFirst({
          where: { serviceType, effectiveFrom: { lte: new Date() } },
          orderBy: { effectiveFrom: 'desc' },
          select: { feeBps: true, flatFeePaise: true, maxFeePaise: true },
        });
        return [serviceType, fee ?? { feeBps: DEFAULT_PLATFORM_FEE_BPS, flatFeePaise: 0, maxFeePaise: null }];
      }),
    ),
  );
  ok(res, {
    platformFees,
    paymentMethods: ['CASH', ...(env.PAYMENT_PROVIDER === 'mock' ? ['MOCK_ONLINE'] : [])],
    mockPayments: env.PAYMENT_PROVIDER === 'mock',
    geocoding: env.GEOCODING_PROVIDER !== 'none',
    routing: env.ROUTING_PROVIDER !== 'none',
    featureFlags: Object.fromEntries(flags.map((f) => [f.key, f.enabled])),
    emergencyNumber: '112',
  });
});

publicRoutes.get('/cities', async (_req, res) => {
  ok(res, await prisma.city.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, state: true, centerLat: true, centerLng: true } }));
});

/**
 * Trip-sharing page for a trusted contact. Shows only what they need: status, vehicle,
 * driver first name, approximate route and live location while the trip is active.
 */
publicRoutes.get('/track/:token', async (req, res) => {
  const b = await prisma.booking.findUnique({
    where: { shareToken: param(req, 'token') },
    include: {
      driver: { select: { id: true, user: { select: { name: true } }, location: true } },
      vehicle: { select: { registrationNumber: true, make: true, model: true, color: true } },
      passenger: { select: { name: true } },
    },
  });
  if (!b || !b.shareExpiresAt || b.shareExpiresAt < new Date()) throw notFound('Shared trip');
  const live = ['ACCEPTED', 'ARRIVING', 'IN_PROGRESS'].includes(b.status);
  ok(res, {
    reference: b.reference,
    status: b.status,
    passengerFirstName: b.passenger.name.split(' ')[0],
    pickup: { lat: b.pickupLat, lng: b.pickupLng, address: b.pickupAddress },
    drop: { lat: b.dropLat, lng: b.dropLng, address: b.dropAddress },
    driverFirstName: b.driver?.user.name.split(' ')[0] ?? null,
    vehicle: b.vehicle,
    driverLocation: live && b.driver?.location ? { lat: b.driver.location.lat, lng: b.driver.location.lng, updatedAt: b.driver.location.updatedAt } : null,
    startedAt: b.startedAt,
    completedAt: b.completedAt,
  });
});
