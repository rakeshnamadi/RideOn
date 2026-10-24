import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { FALLBACK_SPEED_MPS, haversineMeters, ROAD_DISTANCE_FACTOR, type LatLng } from '../utils/geo.js';

export interface RouteResult {
  distanceMeters: number;
  durationSeconds: number;
  /** "osrm" when from the routing provider; "estimate" when straight-line fallback was used. */
  source: 'osrm' | 'estimate';
  geometry: [number, number][] | null; // [lat, lng]
}

const cache = new Map<string, { at: number; value: RouteResult }>();
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 2000;

function key(a: LatLng, b: LatLng) {
  // ~11 m precision is enough for fares and lets nearby requests share cache entries.
  return [a.lat, a.lng, b.lat, b.lng].map((n) => n.toFixed(4)).join(',');
}

export function estimateRoute(from: LatLng, to: LatLng): RouteResult {
  const distance = Math.round(haversineMeters(from, to) * ROAD_DISTANCE_FACTOR);
  return { distanceMeters: distance, durationSeconds: Math.round(distance / FALLBACK_SPEED_MPS), source: 'estimate', geometry: null };
}

/**
 * Road route between two points using the configured routing provider.
 * Falls back to a clearly labelled straight-line estimate on timeout or error.
 * Note: the public OSRM demo server is for development only (see docs/deployment.md).
 */
export async function getRoute(from: LatLng, to: LatLng): Promise<RouteResult> {
  if (env.ROUTING_PROVIDER === 'none') return estimateRoute(from, to);
  const k = key(from, to);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  try {
    const url = `${env.ROUTING_URL}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=simplified&geometries=geojson`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(env.PROVIDER_TIMEOUT_MS),
      headers: { 'User-Agent': env.GEOCODING_USER_AGENT },
    });
    if (!res.ok) throw new Error(`Routing provider HTTP ${res.status}`);
    const body = (await res.json()) as {
      code: string;
      routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
    };
    const route = body.routes?.[0];
    if (body.code !== 'Ok' || !route) throw new Error(`Routing provider returned ${body.code}`);
    const value: RouteResult = {
      distanceMeters: Math.round(route.distance),
      durationSeconds: Math.round(route.duration),
      source: 'osrm',
      geometry: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(k, { at: Date.now(), value });
    return value;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Routing provider unavailable; using distance estimate');
    return estimateRoute(from, to);
  }
}
