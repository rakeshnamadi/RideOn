# Build status

_Last updated: 2026-10-30_

## Summary

**Latest round (2026-11-05):** role-based software. Roles are now Super admin, Local admin, Reporter, Approver, Operator and Driver, with per-delegate permissions; the super admin assigns roles from **Users & roles** and gives unions access from **Auto unions**. Unions maintain their own master data and logo; drivers give feedback on union fares and the union replies; reporters prepare and publish reports; every API request goes to a local activity log. Pickup points, routes, schedules, announcements, cities and unions can be deleted unless they have history. The app now centres on pincode 533211 (Ainavilli, Konaseema, Andhra Pradesh), with a Telugu translation. Payment gateway and SMS remain on hold, as agreed.

**Earlier round (2026-10-30):** the UI was redesigned around the positioning **"Your city. Your people. Your ride."**, with the passenger promise ("The freedom to travel your way") and driver promise ("Respect for the people who move your city") carried through the landing page, sign-in, booking screen and driver console. Community rule changes now go through proposals and votes, shared routes follow real roads, the driver console is in Hindi, and ESLint is in place. Payment-gateway and SMS work remain on hold as agreed.

All eight phases are implemented. The API, database and web app run locally, and all automated tests pass. The core flows were also exercised by hand in a browser against the running stack (details below). Items that remain incomplete or unverified are listed under **Known limitations**; none of them are hidden behind TODOs in the code.

| Area | Status |
|---|---|
| Monorepo, config, logging, health check | Done |
| MySQL schema (53 tables), 4 migrations, development seed | Done |
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
| Policy (rule) proposals: governance rules and passenger charges change only by community vote | Done |
| Shared routes drawn along real roads (OSRM path through stops, stored and backfilled) | Done |
| Brand and marketing: landing page, positioning, passenger and driver promises, refreshed visual system | Done |
| Ratings, complaints/disputes/appeals, support tickets, SOS, trip sharing | Done |
| Notifications (in-app + Socket.IO) with polling fallback | Done |
| Four consoles (passenger, driver, community, platform) + public pages | Done |
| Reports, CSV export, audit log (append-only) | Done |
| Union roles, delegation, role assignment, master data and logo, fare feedback, reports, activity log, delete actions | Done |
| Telugu translation (landing page, passenger flow, driver console) | Done — machine-written; needs review by a native speaker |
| Automated tests | Done — 114 unit/integration tests + 18 browser journeys passing |
| ESLint (typescript-eslint, React Hooks rules) | Done — 0 problems |
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

### Round 2 — Brand, governance, routes, quality (2026-10-30)
- **Visual system "Marigold Transit":** ink green, marigold (auto-rickshaw yellow) and warm paper; Bricolage Grotesque display type over Inter; new logo; rounded, quieter UI kit across all consoles.
- **Landing page** (`pages/public/HomePage.tsx`) built on the positioning: hero "Your city. Your people. Your ride.", the three pillars, the passenger promise with four proof points, the driver promise with a live earnings breakdown, how fares are set, and a closing call to action. The example trip and fee breakdown use **live data** (a real fare estimate between two published stops; the real platform and community fees, now exposed publicly by `/config` and the public community page) — no invented numbers.
- **Brand panel on sign-in/sign-up** (`features/brand/AuthShell.tsx`), switching to the driver promise when someone registers as a driver; promise lines on the booking screen and a **driver promise banner** (what you kept today, fares and fees) on the driver home; tagline in every console sidebar.
- **Hindi:** all landing/brand copy plus the driver console (navigation, home, trip actions, earnings); language switch in every console header; extra line height for Devanagari display type.
- **Policy governance:** `POST /communities/:id/policy-proposals`; `PUT /communities/:id/policy` now accepts only operational settings and answers `422 GOVERNANCE_REQUIRED` for governed fields; votes and platform review apply either proposal type; settings page shows rules read-only with a "Propose a rule change" form; proposal lists show before → after.
- **Route paths:** `services/routing.getPathThrough` (one multi-waypoint OSRM request), `modules/communities/route-path.ts` (refresh on create/stop edits, background backfill); maps draw the road path, falling back to dashed straight segments.
- **Migration** `20261030173513_policy_proposals_and_route_paths` (`governance_proposals.policyChanges/policyBefore`, `shared_routes.pathGeometry/pathDistanceMeters`).
- **ESLint 10** flat config (`eslint.config.mjs`), `npm run lint`.
- Fixed during this round: an effect returned a non-function (crashed the landing page); tests now stub jsdom scrolling and wait for lazy routes; the landing copy no longer claims online payments while the gateway is on hold.

### Phase 8 — Frontend, tests, docs
- Web app with four consoles, i18n (English + Hindi passenger flow), React Hook Form + Zod forms, TanStack Query, live updates.
- **Bug found by tests and fixed:** the web API client could reuse a stale result from a just-finished token refresh.
- Docs in `docs/`, README, `.env.example`, Dockerfiles, nginx config, Compose file.

## Test results (actually executed)

**Latest run (2026-11-05):** API 98 passed, web 16 passed, Playwright 18 passed; typecheck, lint and build pass. The tables below describe the earlier 2026-10-30 run; `test/integration/union-admin.test.ts` and `e2e/specs/06-union-admin.spec.ts` are the additions.

Command: `npm test` from the repository root (2026-10-30). `npm run typecheck` and `npm run lint` pass, and `npm run build` succeeds for both apps.

**API — 81 passed / 81** (Vitest; integration tests use Supertest against the real MySQL `rideon_test` database)

| File | Tests | Covers |
|---|---|---|
| `test/unit/fare-engine.test.ts` | 12 | Base/distance/minimum fares, rupee rounding, IST night surcharge (incl. after midnight), waiting charges, shared seat pricing, integer money |
| `test/unit/business-rules.test.ts` | 20 | State-machine transitions and actors, terminal states, cancellation rules, fee split sums exactly, fare-proposal validation, point-in-polygon, IST conversions |
| `test/unit/permissions.test.ts` | 6 | Community isolation, role scopes, revoked roles, super-admin oversight without governance |
| `test/integration/auth.test.ts` | 9 | Registration (Argon2id, cookie flags), invalid/forged/expired tokens rejected, refresh rotation + CSRF header + reuse revocation, logout, lockout, suspension, password reset |
| `test/integration/regular-booking.test.ts` | 11 | **E2E 1–2:** public estimate, out-of-area rejection, no-driver path, booking with idempotent replay, duplicate-active rejection, dispatch to two drivers, **concurrent accept — exactly one wins**, PIN, transitions, completion with fee record, cash confirmation idempotency, rating once, expired/foreign quotes, cancellation fee, verified webhook (forged signature and wrong amount rejected, replay ignored), ineligible driver, location deleted when offline |
| `test/integration/shared-booking.test.ts` | 7 | **E2E 3–4:** seat hold + server pricing + confirm, idempotent retry, duplicate reservation, reversed stops, **10 passengers racing for 3 seats → exactly 3 succeed, seats 1–3, no overbooking**, hold expiry releases seats, free cancellation, claim/manifest/PIN boarding/deviation/complete, DB-level seat uniqueness and capacity check |
| `test/integration/governance.test.ts` | 8 | **E2E 5–7:** admin creates route with ordered stops, capacity limits, no activation without a fare, foreign stops rejected; admin proposes, approver can't propose, self-approval blocked; **approver approves → new fare version, history, append-only enforced, existing booking keeps its fare**; caps rejection; >limit increase → platform review; multi-approver policy; **governed rules refused on direct edit (`GOVERNANCE_REQUIRED`) while operational settings save; policy proposal applies only after an approver votes, drops unchanged fields, blocks duplicates and invalid combinations** |
| `test/integration/isolation.test.ts` | 8 | **E2E 8–10:** another community's admin gets 403/404 on every private endpoint and record, document files protected, booking object-level access, non-super-admins blocked from `/admin`, **super admin inspects platform data**, statements, audited suspension |

**Web — 16 passed / 16** (Vitest + Testing Library, jsdom)

| File | Tests | Covers |
|---|---|---|
| `src/test/format.test.ts` | 3 | Rupee formatting, rupee→paise, labels |
| `src/test/api-client.test.ts` | 5 | Bearer + CSRF headers, refresh-and-retry on 401, session-lost callback, field errors, network errors |
| `src/test/journeys.test.tsx` | 8 | Anonymous redirect with `next`, passenger blocked from admin, community admin blocked from other community, login validation, wrong credentials, successful login → booking screen, registration validation, error state with request reference and retry |

**Browser E2E — 12 passed / 12** (Playwright 1.64 driving the installed Google Chrome 156, headless; isolated `rideon_e2e` database reseeded per run, API :4100, web :5174). Run twice in a row, green both times (1.7 min and 1.5 min).

| Spec | Journey |
|---|---|
| `e2e/specs/01-public.spec.ts` | Landing shows "Your city. Your people. Your ride.", both promises, a live example fare and real fee breakdown; "For drivers" anchor scrolls; published fares and the KM-1 route map without an account; Hindi switch; protected page → sign-in (wrong password shown) → back to the original page |
| `e2e/specs/02-regular-ride.spec.ts` | **Workflows 1–2 in two browser sessions:** driver goes online with a manual map location; a new passenger registers, picks pickup and drop on the map, gets a server quote and books; driver accepts the live offer; passenger sees driver and vehicle; driver arrives, a wrong PIN is refused, the passenger’s PIN starts the trip; complete; cash recorded; passenger sees Completed + Paid and rates 5 stars; driver goes offline |
| `e2e/specs/03-shared-auto.spec.ts` | **Workflow 3:** passenger picks a departure, holds a seat, confirms; seat number and boarding PIN shown |
| `e2e/specs/04-governance.spec.ts` | **Workflows 5–7:** community admin creates a route with ordered stops; admin proposes a cancellation-fee rule change (₹20 → ₹25) and cannot approve it; approver approves; the new rule shows in settings |
| `e2e/specs/05-roles.spec.ts` | **Workflows 8–10:** another community’s head and a passenger are refused community/admin/driver consoles; super admin inspects overview, communities, all bookings and the audit log |

Workflow 4 (concurrent seat reservations cannot overbook) is a race a single browser can’t trigger reliably; it stays covered by the API integration test that fires 10 simultaneous reservations at a 3-seat departure.

### Manual browser verification (running stack, built-in browser)

- Landing and public fares pages render, with OSM tiles, attribution, service areas, stands and route maps.
- Passenger: signed in, tapped pickup/drop on the map → live reverse geocoding (Nominatim) and an OSRM road route → server quote ₹45 incl. night charge → booked. The driver (via API) accepted, arrived, started with the passenger's PIN (a wrong PIN was rejected), completed and confirmed cash. The passenger page updated live (status, driver, vehicle, driver location, notifications). Rated the trip.
- Shared: held and confirmed a seat on IN-1 (₹30, seat 1, PIN shown).
- Round 2: landing page checked at desktop and phone width (no horizontal overflow) in English and Hindi, with the live ₹53 example fare and real fee split; brand sign-in; driver console with promise banner; community settings → proposed a rule change (cancellation fee ₹20 → ₹25) through the UI and saw it pending under Fares & governance (left pending in the dev database); KM-1 and IN-1 drawn along real roads (8.96 km and 5.36 km).
- Community head, driver and super admin: every console page loaded with real data (15 community pages, 7 driver pages, 12 admin pages), with no console errors besides the expected anonymous `/auth/refresh` 401s.

## Known limitations

| Item | Why | What it takes |
|---|---|---|
| **Real payment provider** | No provider credentials; the brief says not to fake confirmations. Cash and a clearly labelled mock hosted checkout work end to end with signed webhooks. | Implement `PaymentProvider` for the chosen gateway (create order/checkout, verify webhook signature, refunds), set `PAYMENT_PROVIDER`. |
| **SMS/email delivery** | No provider configured. Password-reset tokens are returned in the API response in development only; notifications are in-app + Socket.IO. | Add an SMS/email adapter for resets, booking alerts and trusted-contact sharing. |
| **Docker Compose untested** | Docker isn't installed on this machine. | Run `docker compose up --build` and fix any issues. |
| Cancellation fees on cash bookings | Recorded on the booking (and deducted from refunds of prepaid bookings) but not collected. | Decide a collection policy (e.g. add to next fare) with communities. |
| Shared route paths with routing disabled | Paths come from the routing provider; with `ROUTING_PROVIDER=none` (as in tests) routes fall back to dashed straight segments. | Use a hosted or self-hosted OSRM in production. |
| Turn-by-turn navigation | Drivers get an OpenStreetMap directions link. | Deep-link to a navigation app, or embed routing. |
| Translations | Telugu and Hindi cover the landing page, passenger flow and driver console. Telugu has not been reviewed by a native speaker. Community and platform admin consoles are English only; form validation messages are English. | Add dictionary keys to the admin consoles and more languages (Kannada, Tamil, Telugu, Marathi are already accepted as profile languages). |
| Single-instance assumptions | Socket.IO rooms and rate limits are in memory. | Redis adapter and store before scaling out (see `docs/deployment.md`). |
| Public map services | Dev defaults use public OSM tiles, Nominatim and the OSRM demo server. `GEOCODING_USER_AGENT` in `.env` has a placeholder contact, which Nominatim's policy asks you to replace. | Set your contact details; use hosted or self-hosted providers in production. |
| Development database | The dev database was migrated in place, so it keeps its older sample data until you run `npm run db:reset`. | Run it once to load the Konaseema seed. |
| Super admin and fare votes | Super admins now hold every union permission, including proposing and approving fares, at the owner's request. This replaces the earlier "oversight, not governance" rule. | Revisit before unions rely on the vote as independent. |
| `npm run db:reset` | Prisma blocks `migrate reset` when run by an AI agent without explicit consent, so the tests use `migrate deploy` plus truncation instead. You can run it yourself. | — |

## Next steps

1. Pick and integrate a payment gateway and an SMS provider.
2. Run the Compose stack, then deploy a staging environment with hosted map providers.
3. Replace the demo seed with a production bootstrap script for the first super admin and the pilot community.
4. Pilot review with a real community: fare caps per the state's notified fares, policy defaults, consent texts.
5. Wire `npm run lint`, `npm test` and `npm run test:e2e` into CI (CI needs MySQL and Chrome, or `npx playwright install chromium`).
