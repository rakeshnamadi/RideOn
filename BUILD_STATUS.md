# Build status

_Last updated: 2026-10-25_

## Summary

All eight phases are implemented. The API, database and web app run locally, and all automated tests pass. The core flows were also exercised by hand in a browser against the running stack (details below). Items that remain incomplete or unverified are listed under **Known limitations**; none of them are hidden behind TODOs in the code.

| Area | Status |
|---|---|
| Monorepo, config, logging, health check | Done |
| MySQL schema (50 tables), 2 migrations, development seed | Done |
| Auth: register/login, Argon2id, rotating refresh cookies with reuse detection, logout/logout-all, lockout, password reset, suspension | Done |
| Roles, permissions, community isolation, route guards | Done |
| Communities, admins, policies, service areas, announcements | Done |
| Drivers, documents (private storage), memberships, vehicles, eligibility, verification | Done |
| Leaflet + OSM maps, address search, reverse geocoding, routing with fallback | Done |
| Pickup points/stands, stand queues, shared routes, stops, schedules | Done |
| Fare engine, quotes, regular bookings, dispatch, state machine, cancellations | Done |
| Shared-auto trip instances, atomic seat holds, confirm, boarding, no-shows, departure cancellation | Done |
| Payments: cash, mock hosted checkout + signed webhooks, refunds, fee split, statements | Done (mock provider only — see limitations) |
| Fare proposals, votes, platform review, versioned publication, fare history | Done |
| Ratings, complaints/disputes/appeals, support tickets, SOS, trip sharing | Done |
| Notifications (in-app + Socket.IO) with polling fallback | Done |
| Four consoles (passenger, driver, community, platform) + public pages | Done |
| Reports, CSV export, audit log (append-only) | Done |
| Automated tests | Done — 94 tests passing |
| Docs, `.env.example`, Docker Compose | Done — Compose not run (no Docker available) |

## Environment used

- Windows 11, Git Bash / PowerShell.
- **Node.js 24.22.1** and **MySQL 8.4.13**, both official portable zips installed project-locally in `.tools/` (checksums verified), with your approval. MySQL runs on `127.0.0.1:3307` via `scripts/db-start.sh`.
- Databases: `rideon` (development) and `rideon_test` (tests), app user `rideon`. The generated DB password is in `.tools/db-password.txt`; secrets are in `.env` (both git-ignored).

## Phase log

### Phase 1 — Foundation
- npm workspaces monorepo (`apps/api`, `apps/web`), TypeScript strict, Zod-validated environment, pino logging with redaction, `/api/v1/health`.
- Prisma schema and migrations:
  - `20261024165604_init` — full schema.
  - `20261024170000_immutable_audit` — append-only triggers on `audit_logs` and `fare_history`; `CHECK` constraints on seats booked, rating score and seat count.
- Seed with demo data for every role.

### Phase 2 — Auth and permissions
- `modules/auth/*`, `middleware/auth.ts`, `middleware/community-scope.ts`, `middleware/security.ts`.
- **Bug found by tests and fixed:** refresh-token reuse detection didn't fire because rotated sessions were also marked revoked; replaying a stolen token now revokes the whole session family.

### Phase 3 — Community and driver administration
- `modules/communities/*`, `modules/drivers/*`, `modules/admin/*`, `services/uploads.ts`.

### Phase 4 — Maps and routes
- `services/routing.ts` (OSRM + labelled estimate fallback, in-memory cache), `services/geocoding.ts` (Nominatim with global 1 req/s throttle, DB cache, timeouts), `modules/geo`.
- Web: `components/map/*` (configurable tiles + attribution, pins, polygons, route lines, click-to-place, address search with manual fallback).

### Phase 5 — Fares and regular bookings
- `modules/fares/fare-engine.ts` (pure), `fare.service.ts`, `modules/bookings/*` (state machine, cancellation rules, booking service), `jobs/index.ts`, `sockets/index.ts`.

### Phase 6 — Shared autos
- `modules/shared-trips/*`: trip-instance generation, row-locked seat holds with a unique active-seat key, hold expiry, claims/assignment with capacity checks, manifests, PIN boarding, completion, departure cancellation with refunds.

### Phase 7 — Payments, governance, reports
- `modules/payments/*` (fee split, provider abstraction, mock checkout, signed webhooks, refunds), `modules/fares/governance.service.ts`, `modules/reports/*`, `modules/support/*`.

### Phase 8 — Frontend, tests, docs
- Web app with four consoles, i18n (English + Hindi passenger flow), React Hook Form + Zod forms, TanStack Query, live updates.
- **Bug found by tests and fixed:** the web API client could reuse a stale result from a just-finished token refresh.
- Docs in `docs/`, README, `.env.example`, Dockerfiles, nginx config, Compose file.

## Test results (actually executed)

Command: `npm test` from the repository root (2026-10-25). `npm run typecheck` also passes for both apps, and `npm run build` succeeds for both.

**API — 78 passed / 78** (Vitest; integration tests use Supertest against the real MySQL `rideon_test` database)

| File | Tests | Covers |
|---|---|---|
| `test/unit/fare-engine.test.ts` | 12 | Base/distance/minimum fares, rupee rounding, IST night surcharge (incl. after midnight), waiting charges, shared seat pricing, integer money |
| `test/unit/business-rules.test.ts` | 20 | State-machine transitions and actors, terminal states, cancellation rules, fee split sums exactly, fare-proposal validation, point-in-polygon, IST conversions |
| `test/unit/permissions.test.ts` | 6 | Community isolation, role scopes, revoked roles, super-admin oversight without governance |
| `test/integration/auth.test.ts` | 9 | Registration (Argon2id, cookie flags), invalid/forged/expired tokens rejected, refresh rotation + CSRF header + reuse revocation, logout, lockout, suspension, password reset |
| `test/integration/regular-booking.test.ts` | 11 | **E2E 1–2:** public estimate, out-of-area rejection, no-driver path, booking with idempotent replay, duplicate-active rejection, dispatch to two drivers, **concurrent accept — exactly one wins**, PIN, transitions, completion with fee record, cash confirmation idempotency, rating once, expired/foreign quotes, cancellation fee, verified webhook (forged signature and wrong amount rejected, replay ignored), ineligible driver, location deleted when offline |
| `test/integration/shared-booking.test.ts` | 7 | **E2E 3–4:** seat hold + server pricing + confirm, idempotent retry, duplicate reservation, reversed stops, **10 passengers racing for 3 seats → exactly 3 succeed, seats 1–3, no overbooking**, hold expiry releases seats, free cancellation, claim/manifest/PIN boarding/deviation/complete, DB-level seat uniqueness and capacity check |
| `test/integration/governance.test.ts` | 5 | **E2E 5–7:** admin creates route with ordered stops, capacity limits, no activation without a fare, foreign stops rejected; admin proposes, approver can't propose, self-approval blocked; **approver approves → new fare version, history, append-only enforced, existing booking keeps its fare**; caps rejection; >limit increase → platform review; multi-approver policy |
| `test/integration/isolation.test.ts` | 8 | **E2E 8–10:** another community's admin gets 403/404 on every private endpoint and record, document files protected, booking object-level access, non-super-admins blocked from `/admin`, **super admin inspects platform data**, statements, audited suspension |

**Web — 16 passed / 16** (Vitest + Testing Library, jsdom)

| File | Tests | Covers |
|---|---|---|
| `src/test/format.test.ts` | 3 | Rupee formatting, rupee→paise, labels |
| `src/test/api-client.test.ts` | 5 | Bearer + CSRF headers, refresh-and-retry on 401, session-lost callback, field errors, network errors |
| `src/test/journeys.test.tsx` | 8 | Anonymous redirect with `next`, passenger blocked from admin, community admin blocked from other community, login validation, wrong credentials, successful login → booking screen, registration validation, error state with request reference and retry |

### Manual browser verification (running stack, built-in browser)

- Landing and public fares pages render, with OSM tiles, attribution, service areas, stands and route maps.
- Passenger: signed in, tapped pickup/drop on the map → live reverse geocoding (Nominatim) and an OSRM road route → server quote ₹45 incl. night charge → booked. The driver (via API) accepted, arrived, started with the passenger's PIN (a wrong PIN was rejected), completed and confirmed cash. The passenger page updated live (status, driver, vehicle, driver location, notifications). Rated the trip.
- Shared: held and confirmed a seat on IN-1 (₹30, seat 1, PIN shown).
- Community head, driver and super admin: every console page loaded with real data (15 community pages, 7 driver pages, 12 admin pages), with no console errors besides the expected anonymous `/auth/refresh` 401s.

## Known limitations

| Item | Why | What it takes |
|---|---|---|
| **Real payment provider** | No provider credentials; the brief says not to fake confirmations. Cash and a clearly labelled mock hosted checkout work end to end with signed webhooks. | Implement `PaymentProvider` for the chosen gateway (create order/checkout, verify webhook signature, refunds), set `PAYMENT_PROVIDER`. |
| **SMS/email delivery** | No provider configured. Password-reset tokens are returned in the API response in development only; notifications are in-app + Socket.IO. | Add an SMS/email adapter for resets, booking alerts and trusted-contact sharing. |
| **Docker Compose untested** | Docker isn't installed on this machine. | Run `docker compose up --build` and fix any issues. |
| **No browser-automation E2E suite** | The 10 required workflows are covered by API-level end-to-end tests against real MySQL, plus the manual browser run above. Playwright would need ~150 MB of browser downloads. | Add Playwright specs for the same journeys if UI regression coverage is wanted. |
| Cancellation fees on cash bookings | Recorded on the booking (and deducted from refunds of prepaid bookings) but not collected. | Decide a collection policy (e.g. add to next fare) with communities. |
| Governance for policy changes | Fare changes go through proposals and votes. Policy edits are made directly by the community head and audited; the `POLICY_CHANGE` proposal type exists in the schema but has no workflow. | Reuse the proposal/vote flow for policy fields if communities want it. |
| Shared route geometry | Drawn as straight lines between stops. | Fetch OSRM geometry per route and cache it. |
| Turn-by-turn navigation | Drivers get an OpenStreetMap directions link. | Deep-link to a navigation app, or embed routing. |
| Translations | Hindi covers the passenger flow; the consoles are English only. | Add dictionary keys to the consoles and more languages. |
| Single-instance assumptions | Socket.IO rooms and rate limits are in memory. | Redis adapter and store before scaling out (see `docs/deployment.md`). |
| Public map services | Dev defaults use public OSM tiles, Nominatim and the OSRM demo server. `GEOCODING_USER_AGENT` in `.env` has a placeholder contact, which Nominatim's policy asks you to replace. | Set your contact details; use hosted or self-hosted providers in production. |
| Linting | TypeScript strict mode is the only static check; ESLint isn't configured. | Add ESLint + Prettier if the team wants them. |
| `npm run db:reset` | Prisma blocks `migrate reset` when run by an AI agent without explicit consent, so the tests use `migrate deploy` plus truncation instead. You can run it yourself. | — |

## Next steps

1. Pick and integrate a payment gateway and an SMS provider.
2. Run the Compose stack, then deploy a staging environment with hosted map providers.
3. Replace the demo seed with a production bootstrap script for the first super admin and the pilot community.
4. Pilot review with a real community: fare caps per the state's notified fares, policy defaults, consent texts.
5. Add Playwright UI tests and ESLint, and wire `npm test` into CI.
