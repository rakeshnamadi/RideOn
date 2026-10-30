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
 * Road path through several waypoints in order (e.g. a shared route's stops).
 * Returns null — never an estimate — when routing is disabled or fails, so callers
 * can fall back to drawing straight segments and label them as such.
 */
export async function getPathThrough(points: LatLng[]): Promise<{ geometry: [number, number][]; distanceMeters: number } | null> {
  if (env.ROUTING_PROVIDER === 'none' || points.length < 2 || points.length > 50) return null;
  try {
    const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
    const res = await fetch(`${env.ROUTING_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson`, {
      signal: AbortSignal.timeout(env.PROVIDER_TIMEOUT_MS * 2),
      headers: { 'User-Agent': env.GEOCODING_USER_AGENT },
    });
    if (!res.ok) throw new Error(`Routing provider HTTP ${res.status}`);
    const body = (await res.json()) as { code: string; routes?: { distance: number; geometry: { coordinates: [number, number][] } }[] };
    const route = body.routes?.[0];
    if (body.code !== 'Ok' || !route) throw new Error(`Routing provider returned ${body.code}`);
    // Round to ~1 m and drop consecutive duplicates to keep the stored path small.
    const geometry: [number, number][] = [];
    for (const [lng, lat] of route.geometry.coordinates) {
      const p: [number, number] = [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5];
      const last = geometry[geometry.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) geometry.push(p);
    }
    return { geometry, distanceMeters: Math.round(route.distance) };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Could not compute road path through stops');
    return null;
  }
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
