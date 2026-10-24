# Deployment

## Components

| Component | Notes |
|---|---|
| MySQL 8.0+ | `utf8mb4`, UTC (`default-time-zone='+00:00'`). Apply migrations with `prisma migrate deploy`. Binary logging is fine; the migration creates triggers, which need the `TRIGGER` privilege (and `SUPER` or `log_bin_trust_function_creators=1` on some managed services). |
| API | Node.js 24, `node dist/server.js` from `apps/api`. Stateless except for the in-process job scheduler and `UPLOAD_DIR`. |
| Web | Static files from `apps/web/dist`, served by nginx (see `apps/web/nginx.conf`) or a CDN. `/api` and `/socket.io` must be proxied to the API on the same origin so the `SameSite=Strict` refresh cookie works. |

## Build

```bash
npm ci
```

```bash
npm run build
```

API output: `apps/api/dist`. Web output: `apps/web/dist`. Set `VITE_TILE_URL` / `VITE_TILE_ATTRIBUTION` at web build time.

## Release steps

1. Back up the database.
2. `npm run db:migrate` (runs `prisma migrate deploy`; never `migrate dev` or `reset` in production).
3. Deploy the API, then the web build.
4. Check `GET /api/v1/health` (returns `503` if the database is unreachable).

## Docker Compose

`docker-compose.yml` defines `db` (MySQL 8.4), `api` and `web` (nginx on port 8080). See the comments at the top of the file. **It was written without Docker available and has not been run**; treat it as a starting point and verify it in your environment.

## Map providers

The defaults are for development only:

| Provider | Default | Production guidance |
|---|---|---|
| Tiles | `tile.openstreetmap.org` | The OSMF tile servers forbid heavy use. Use a commercial tile host or self-host, set `VITE_TILE_URL`, and keep attribution. |
| Geocoding | public Nominatim | Max 1 request/second for the whole app (enforced by the server-side throttle), identifying User-Agent with real contact details (`GEOCODING_USER_AGENT`), results cached 7 days. For a pilot, use a hosted Nominatim/Photon/commercial geocoder or self-host. |
| Routing | `router.project-osrm.org` (demo) | Self-host OSRM with an India extract, or a commercial router. On failure the API falls back to a straight-line × 1.35 estimate and labels quotes as estimated. |

## Scaling notes

- **Multiple API instances:** Socket.IO needs a shared adapter (e.g. Redis adapter) so events reach users connected to other instances; until then, polling keeps every screen correct. Rate limits are per instance (move to a Redis store). Jobs are idempotent and use conditional updates, so running them on every instance is safe but wasteful — set `JOBS_ENABLED=false` on all but one instance or move them to a worker.
- **Uploads:** move `UPLOAD_DIR` to encrypted object storage (S3-compatible) with private ACLs; keep the authorised streaming endpoint or use short-lived signed URLs.
- **Service areas:** point-in-polygon runs in application code over JSON polygons — fine for a city pilot. For many cities, add MySQL `POLYGON` columns with spatial indexes via a raw migration.
- **Driver locations:** one row per online driver, updated every ~30 s. For large fleets, move to Redis GEO with TTLs.

## Operations

- Logs are JSON (pino) on stdout; ship them to your log platform. Secrets and personal data are redacted.
- Monitor: `/api/v1/health`, error rate, job failures (`"Job failed"` log lines), MySQL lock waits (seat reservations rely on row locks).
- Backups: daily MySQL dumps plus binary logs for point-in-time recovery; back up uploads separately.
