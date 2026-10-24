import type { FareRule, Prisma, ServiceType } from '@prisma/client';
import { prisma, type Db } from '../../db.js';
import { getRoute } from '../../services/routing.js';
import { notFound, unprocessable } from '../../utils/errors.js';
import { pointInPolygon, type LatLng, type PolygonCoords } from '../../utils/geo.js';
import { addMinutes, DEFAULT_TIMEZONE } from '../../utils/time.js';
import { calculateRegularFare, calculateSharedFare, type FareResult } from './fare-engine.js';

export const QUOTE_TTL_MINUTES = 10;
/** Regular trips longer than this are outside the auto service envelope. */
export const MAX_REGULAR_TRIP_METERS = 40_000;

/** The fare rule in force at `at` for a community/service (and route, for shared). */
export async function findActiveRule(
  communityId: string,
  serviceType: ServiceType,
  sharedRouteId: string | null,
  at = new Date(),
  db: Db = prisma,
): Promise<FareRule | null> {
  return db.fareRule.findFirst({
    where: {
      communityId,
      serviceType,
      sharedRouteId,
      effectiveFrom: { lte: at },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
    },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
  });
}

/** Published fare tables for a community: current regular rule plus each active route's rule. */
export async function activeFareRules(communityId: string) {
  const now = new Date();
  const regular = await findActiveRule(communityId, 'REGULAR', null, now);
  const routes = await prisma.sharedRoute.findMany({ where: { communityId, status: 'ACTIVE' }, select: { id: true, code: true, name: true } });
  const shared = await Promise.all(
    routes.map(async (r) => ({ route: r, rule: await findActiveRule(communityId, 'SHARED', r.id, now) })),
  );
  const upcoming = await prisma.fareRule.findMany({
    where: { communityId, effectiveFrom: { gt: now } },
    orderBy: { effectiveFrom: 'asc' },
  });
  return { regular, shared: shared.filter((s) => s.rule), upcoming };
}

/**
 * Which ACTIVE community serves this pickup point? A community serves a point if the
 * point lies inside one of its active service areas. If several do, the one whose
 * centre is closest wins (deterministic).
 */
export async function findServingCommunity(pickup: LatLng, drop: LatLng, preferredCommunityId?: string) {
  const communities = await prisma.community.findMany({
    where: { status: 'ACTIVE', ...(preferredCommunityId ? { id: preferredCommunityId } : {}) },
    select: { id: true, name: true, centerLat: true, centerLng: true, city: { select: { timezone: true } }, serviceAreas: { where: { active: true }, select: { polygon: true } } },
  });
  const candidates = communities.filter((c) =>
    c.serviceAreas.some((a) => pointInPolygon(pickup, a.polygon as PolygonCoords)),
  );
  if (candidates.length === 0) return null;
  const dropServed = (c: (typeof candidates)[number]) => c.serviceAreas.some((a) => pointInPolygon(drop, a.polygon as PolygonCoords));
  const sorted = candidates.sort(
    (a, b) =>
      Number(dropServed(b)) - Number(dropServed(a)) ||
      Math.hypot(a.centerLat - pickup.lat, a.centerLng - pickup.lng) - Math.hypot(b.centerLat - pickup.lat, b.centerLng - pickup.lng),
  );
  const chosen = sorted[0]!;
  return { id: chosen.id, name: chosen.name, timeZone: chosen.city.timezone ?? DEFAULT_TIMEZONE, dropInsideArea: dropServed(chosen) };
}

export interface RegularQuoteResult {
  communityId: string;
  communityName: string;
  fareRuleId: string;
  distanceMeters: number;
  durationSeconds: number;
  distanceSource: 'osrm' | 'estimate';
  geometry: [number, number][] | null;
  fare: FareResult;
  dropInsideArea: boolean;
}

/** Compute (without persisting) the regular-auto fare. Every input is validated server-side. */
export async function priceRegularTrip(pickup: LatLng, drop: LatLng, preferredCommunityId?: string, at = new Date()): Promise<RegularQuoteResult> {
  const community = await findServingCommunity(pickup, drop, preferredCommunityId);
  if (!community) throw unprocessable('Pickup location is outside every participating community service area', 'OUTSIDE_SERVICE_AREA');
  const rule = await findActiveRule(community.id, 'REGULAR', null, at);
  if (!rule) throw unprocessable('This community has not published a regular-auto fare yet', 'NO_FARE_RULE');
  const route = await getRoute(pickup, drop);
  if (route.distanceMeters < 200) throw unprocessable('Pickup and destination are too close together', 'TRIP_TOO_SHORT');
  if (route.distanceMeters > MAX_REGULAR_TRIP_METERS) throw unprocessable('Trip is longer than the maximum auto trip distance', 'TRIP_TOO_LONG');
  const fare = calculateRegularFare(rule, { distanceMeters: route.distanceMeters, at, timeZone: community.timeZone });
  return {
    communityId: community.id,
    communityName: community.name,
    fareRuleId: rule.id,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    distanceSource: route.source,
    geometry: route.geometry,
    fare,
    dropInsideArea: community.dropInsideArea,
  };
}

export async function createRegularQuote(passengerId: string, pickup: LatLng, drop: LatLng, preferredCommunityId?: string) {
  const priced = await priceRegularTrip(pickup, drop, preferredCommunityId);
  const quote = await prisma.fareQuote.create({
    data: {
      passengerId,
      communityId: priced.communityId,
      serviceType: 'REGULAR',
      fareRuleId: priced.fareRuleId,
      pickupLat: pickup.lat,
      pickupLng: pickup.lng,
      dropLat: drop.lat,
      dropLng: drop.lng,
      distanceMeters: priced.distanceMeters,
      durationSeconds: priced.durationSeconds,
      distanceSource: priced.distanceSource,
      farePaise: priced.fare.totalPaise,
      breakdown: priced.fare.lines as unknown as Prisma.InputJsonValue,
      expiresAt: addMinutes(new Date(), QUOTE_TTL_MINUTES),
    },
  });
  return { quoteId: quote.id, expiresAt: quote.expiresAt, ...priced };
}

/** Price a shared-auto segment from the route's active per-seat rule. */
export async function priceSharedSeats(
  routeId: string,
  pickupStopId: string,
  dropStopId: string,
  seats: number,
  db: Db = prisma,
) {
  const route = await db.sharedRoute.findUnique({ where: { id: routeId }, include: { stops: true } });
  if (!route) throw notFound('Route');
  const pickup = route.stops.find((s) => s.id === pickupStopId);
  const drop = route.stops.find((s) => s.id === dropStopId);
  if (!pickup || !drop) throw unprocessable('Pickup and drop stops must belong to this route', 'INVALID_STOPS');
  if (drop.sequence <= pickup.sequence) throw unprocessable('Drop stop must come after the pickup stop', 'INVALID_STOPS');
  const rule = await findActiveRule(route.communityId, 'SHARED', route.id, new Date(), db);
  if (!rule) throw unprocessable('No published fare for this route', 'NO_FARE_RULE');
  const fare = calculateSharedFare(rule, { pickupSequence: pickup.sequence, dropSequence: drop.sequence, seats });
  return { route, pickup, drop, rule, fare };
}
