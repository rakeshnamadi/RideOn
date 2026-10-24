import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth } from '../../middleware/auth.js';
import { geoLimiter } from '../../middleware/security.js';
import { reverseGeocode, searchPlaces } from '../../services/geocoding.js';
import { getRoute } from '../../services/routing.js';
import { ok, parse } from '../../utils/http.js';

export const Lat = z.coerce.number().min(-90).max(90);
export const Lng = z.coerce.number().min(-180).max(180);

export const geoRoutes = Router();
geoRoutes.use(optionalAuth, geoLimiter);

geoRoutes.get('/search', async (req, res) => {
  const q = parse(z.object({ q: z.string().trim().min(3).max(200), lat: Lat.optional(), lng: Lng.optional() }), req.query);
  const near = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : undefined;
  ok(res, await searchPlaces(q.q, near));
});

geoRoutes.get('/reverse', async (req, res) => {
  const q = parse(z.object({ lat: Lat, lng: Lng }), req.query);
  ok(res, await reverseGeocode(q.lat, q.lng));
});

geoRoutes.get('/route', async (req, res) => {
  const q = parse(z.object({ fromLat: Lat, fromLng: Lng, toLat: Lat, toLng: Lng }), req.query);
  ok(res, await getRoute({ lat: q.fromLat, lng: q.fromLng }, { lat: q.toLat, lng: q.toLng }));
});
