import type { Prisma } from '@prisma/client';
import { logger } from '../../config/logger.js';
import { prisma } from '../../db.js';
import { getPathThrough } from '../../services/routing.js';

const inFlight = new Set<string>();

/**
 * Recompute and store a shared route's road path through its stops. Safe to call
 * without awaiting: failures are logged and leave the previous path untouched, and
 * concurrent refreshes of the same route are collapsed.
 */
export async function refreshRoutePath(routeId: string): Promise<boolean> {
  if (inFlight.has(routeId)) return false;
  inFlight.add(routeId);
  try {
    const stops = await prisma.routeStop.findMany({
      where: { routeId },
      orderBy: { sequence: 'asc' },
      select: { pickupPoint: { select: { lat: true, lng: true } } },
    });
    const path = await getPathThrough(stops.map((s) => s.pickupPoint));
    if (!path) return false;
    await prisma.sharedRoute.update({
      where: { id: routeId },
      data: { pathGeometry: path.geometry as unknown as Prisma.InputJsonValue, pathDistanceMeters: path.distanceMeters },
    });
    return true;
  } catch (err) {
    logger.warn({ err, routeId }, 'Failed to refresh route path');
    return false;
  } finally {
    inFlight.delete(routeId);
  }
}

/** Fill in missing paths in the background (e.g. routes created while routing was down). */
export function backfillRoutePaths(routes: { id: string; pathGeometry: unknown }[]) {
  for (const r of routes) if (r.pathGeometry === null) void refreshRoutePath(r.id);
}
