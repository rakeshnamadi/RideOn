import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { prisma } from '../db.js';
import { serviceUnavailable } from '../utils/errors.js';
import { sha256 } from '../utils/ids.js';
import { addDays } from '../utils/time.js';

export interface Place {
  label: string;
  lat: number;
  lng: number;
}

/**
 * Nominatim usage policy compliance: max 1 request/second for the whole application,
 * an identifying User-Agent, results cached, no bulk/autocomplete-per-keystroke use
 * (the web client debounces and requires >= 3 characters).
 */
let nextSlot = 0;
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + 1100;
  if (wait > 3000) throw serviceUnavailable('Address search is busy. Please try again shortly or pick the location on the map.');
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function cached<T>(query: string, fetcher: () => Promise<T>): Promise<T> {
  const queryHash = sha256(`${env.GEOCODING_PROVIDER}:${query}`);
  const hit = await prisma.geocodeCache.findUnique({ where: { queryHash } });
  if (hit && hit.expiresAt > new Date()) return hit.response as T;
  const value = await fetcher();
  await prisma.geocodeCache.upsert({
    where: { queryHash },
    create: { queryHash, provider: env.GEOCODING_PROVIDER, query: query.slice(0, 300), response: value as object, expiresAt: addDays(new Date(), 7) },
    update: { response: value as object, expiresAt: addDays(new Date(), 7) },
  });
  return value;
}

async function nominatim(path: string): Promise<unknown> {
  await throttle();
  try {
    const res = await fetch(`${env.GEOCODING_URL}${path}`, {
      signal: AbortSignal.timeout(env.PROVIDER_TIMEOUT_MS),
      headers: { 'User-Agent': env.GEOCODING_USER_AGENT, 'Accept-Language': 'en' },
    });
    if (res.status === 429) throw serviceUnavailable('Address search is rate limited. Pick the location on the map instead.');
    if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if ((err as { status?: number }).status === 503) throw err;
    logger.warn({ err: (err as Error).message }, 'Geocoding provider error');
    throw serviceUnavailable('Address search is unavailable right now. Pick the location on the map instead.');
  }
}

export async function searchPlaces(q: string, near?: { lat: number; lng: number }): Promise<Place[]> {
  if (env.GEOCODING_PROVIDER === 'none') throw serviceUnavailable('Address search is not configured. Pick the location on the map.');
  const viewbox = near ? `&viewbox=${near.lng - 0.3},${near.lat + 0.3},${near.lng + 0.3},${near.lat - 0.3}` : '';
  const query = `search:${q.toLowerCase()}${viewbox}`;
  return cached(query, async () => {
    const data = (await nominatim(
      `/search?format=jsonv2&limit=6&countrycodes=in&q=${encodeURIComponent(q)}${viewbox}`,
    )) as { display_name: string; lat: string; lon: string }[];
    return data.map((d) => ({ label: d.display_name, lat: Number(d.lat), lng: Number(d.lon) }));
  });
}

export async function reverseGeocode(lat: number, lng: number): Promise<Place | null> {
  if (env.GEOCODING_PROVIDER === 'none') return null;
  const query = `reverse:${lat.toFixed(5)},${lng.toFixed(5)}`;
  return cached(query, async () => {
    const d = (await nominatim(`/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lng}`)) as { display_name?: string };
    return d.display_name ? { label: d.display_name, lat, lng } : null;
  });
}
