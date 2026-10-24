# API documentation

Base URL: `/api/v1`. JSON in and out.

## Conventions

- **Success:** `{ "data": … }`, with `meta` for lists: `{ "page", "pageSize", "total", "totalPages" }`.
- **Errors:** `{ "error": { "code", "message", "details?", "requestId" } }`. Every response carries `X-Request-Id`.
- **Pagination:** `?page=1&pageSize=20` (max 100).
- **Auth:** `Authorization: Bearer <accessToken>` (15-minute JWT). The refresh token is an http-only cookie on `/api/v1/auth`; refresh and logout also require the header `X-Requested-With: rideon`.
- **Idempotency:** booking and seat-hold requests take an `idempotencyKey` (8–64 chars). Replays return the original booking with `200` and `meta.replayed = true`.
- **Money:** integer paise. **Time:** ISO-8601 UTC.

| Status | Meaning |
|---|---|
| 400 `BAD_REQUEST` | Validation failed (`details` lists `{ path, message }`) |
| 401 `UNAUTHORIZED` | Missing/invalid/expired token or ended session |
| 403 `FORBIDDEN` | Authenticated but not permitted (role or community scope) |
| 404 `NOT_FOUND` | Missing — also returned for records outside your scope where existence must not leak |
| 409 | Conflicts: `INVALID_TRANSITION`, `STALE_BOOKING`, `BOOKING_TAKEN`, `INSUFFICIENT_SEATS`, `DUPLICATE_RESERVATION`, `ACTIVE_BOOKING_EXISTS`, `QUOTE_USED`, `ALREADY_VOTED`, `DUPLICATE` … |
| 422 | Business-rule failures: `OUTSIDE_SERVICE_AREA`, `QUOTE_EXPIRED`, `NOT_ELIGIBLE`, `FARE_LIMIT`, `NOTICE_PERIOD`, `INVALID_PIN`, `CAPACITY_EXCEEDED`, `NO_FARE_RULE` … |
| 423 `ACCOUNT_LOCKED` | Too many failed logins (15 min) |
| 429 `RATE_LIMITED` | Rate limit hit |
| 503 `SERVICE_UNAVAILABLE` | External provider (geocoding/payments) unavailable — use the fallback |

## Public (no account)

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness + DB check |
| GET | `/config` | Enabled payment methods, provider availability, feature flags, emergency number |
| GET | `/cities` | Active cities |
| GET | `/communities` | Active communities (`?cityId`, `?search`) |
| GET | `/communities/:id/public` | Published profile, service areas, stands/stops, active routes + schedules, current/upcoming fares, passenger announcements |
| GET | `/fares/communities/:id` | Current regular and shared fare rules, upcoming changes |
| GET | `/fares/communities/:id/history` | Fare revision history |
| GET | `/fares/caps` | Platform fare caps |
| POST | `/fares/estimate` | `{ pickup:{lat,lng}, drop:{lat,lng}, communityId? }` → price without saving (rate-limited) |
| GET | `/shared-trips/search` | Upcoming departures with seat availability (`?communityId&routeId&fromPointId&toPointId&date=YYYY-MM-DD`) |
| GET | `/track/:token` | Trip-sharing view for a trusted contact (limited fields, expires) |
| GET | `/geo/search?q=` · `/geo/reverse?lat&lng` · `/geo/route?fromLat&fromLng&toLat&toLng` | Geocoding / routing proxy (cached, throttled, rate-limited) |

## Auth & profile

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | `{ name, phone, email?, password, accountType: PASSENGER\|DRIVER, preferredLanguage?, acceptTerms: true }` → `{ accessToken }` + refresh cookie |
| POST | `/auth/login` | `{ identifier (phone or email), password }` |
| POST | `/auth/refresh` | Rotate refresh cookie → new access token (reuse revokes the session family) |
| POST | `/auth/logout` · `/auth/logout-all` | Revoke this session family / all sessions |
| GET | `/auth/me` | Profile, roles, permissions, administered communities with permissions |
| POST | `/auth/password/forgot` · `/auth/password/reset` | Recovery (single-use, 30-minute token; dev returns the token) |
| PATCH | `/users/me` | Name, email, language, trusted contact |
| POST | `/users/me/password` | Change password (revokes all sessions) |
| GET/POST | `/users/me/consents` | View / grant or revoke location-sharing consent |
| GET | `/notifications` · POST `/notifications/:id/read` · POST `/notifications/read-all` | In-app notifications (`meta.unread`) |

## Passenger bookings

| Method | Path | Description |
|---|---|---|
| POST | `/fares/quotes` | Bookable 10-minute quote for a regular auto |
| POST | `/bookings` | `{ quoteId, idempotencyKey, pickupAddress?, dropAddress?, paymentMethod: CASH\|MOCK_ONLINE }` → booking (dispatch starts) |
| GET | `/bookings` | My bookings |
| GET | `/bookings/:id` | Detail (passenger, assigned driver or authorised staff only). PIN shown to the passenger only. Driver shown as first name + rating |
| GET | `/bookings/:id/driver-location` | Assigned driver's last location, only while the trip is active |
| POST | `/bookings/:id/cancel` | `{ reason }` → applies published cancellation rules, auto-refunds prepaid amounts |
| POST | `/bookings/:id/confirm` | Confirm held shared seats |
| POST | `/bookings/:id/share` | Create a 12-hour trip-sharing link |
| POST | `/bookings/:id/sos` | Emergency: trip event + urgent safety ticket + staff alerts |
| POST | `/shared-trips/:tripId/reservations` | `{ pickupStopId, dropStopId, seats (1–4), idempotencyKey, paymentMethod }` → atomic seat hold |
| POST | `/ratings` | `{ bookingId, score 1–5, comment? }` (completed trips, once) |
| POST | `/complaints` · GET `/complaints/mine` | Complaint / dispute / driver appeal |
| POST | `/support-tickets` · GET `/support-tickets/mine` | Support, incident or safety ticket |
| POST | `/payments/bookings/:id/checkout` | Start hosted online checkout → `{ checkoutUrl }` |

## Driver

| Method | Path | Description |
|---|---|---|
| POST/GET/PATCH | `/drivers/me` | Register (licence), view profile + eligibility per community, update licence (re-verification) |
| POST | `/drivers/me/documents` | Multipart `file` (PDF/JPEG/PNG ≤ 5 MB, content-sniffed) + `type` |
| GET | `/drivers/documents/:id/file` | Stream a private document (owner, super admin, or that driver's community staff) |
| POST | `/drivers/me/memberships` · `/drivers/me/memberships/:id/leave` | Apply to / leave a community |
| POST | `/drivers/me/vehicles` | Register a vehicle with a community (capacity set on approval) |
| GET | `/drivers/me/eligibility?communityId` | Why the driver can or cannot go online |
| POST | `/drivers/me/availability` | `{ status: ONLINE, communityId, standId?, lat, lng }` or `{ status: OFFLINE }` (offline deletes location) |
| POST | `/drivers/me/location` | Only while online |
| GET | `/drivers/me/offers` · `/drivers/me/active` · `/drivers/me/trips` · `/drivers/me/earnings?month=YYYY-MM` | Offers, current trip, history, earnings with every deduction |
| POST | `/bookings/:id/accept` · `/reject` · `/arrived` · `/start {pin}` · `/complete` · `/no-show` | Regular trip actions (assigned driver only, state machine enforced) |
| POST | `/payments/bookings/:id/cash-confirm` | Record cash received (assigned driver, once) |
| GET | `/shared-trips/driver/mine` · `/shared-trips/driver/available` | My departures / unassigned departures I can take |
| POST | `/shared-trips/:id/claim` | Take an unassigned departure (vehicle capacity must cover it) |
| GET | `/shared-trips/:id/manifest` | Passengers by stop, seats, payment (first names only) |
| POST | `/shared-trips/:id/status` | `{ action: BOARDING\|START\|COMPLETE }` |
| POST | `/shared-trips/:id/bookings/:bookingId/(board\|drop\|no-show)` | Board requires `{ pin }` |
| POST | `/shared-trips/:id/events` | Route deviation / delay / breakdown |

## Community console — `/communities/:communityId/…`

Every route checks the caller's permission **in that community**; records are always looked up scoped by the community in the URL.

| Method | Path | Permission |
|---|---|---|
| GET | `/console` | view — community, my permissions, counters |
| PATCH | `` (the community) | profile.edit |
| GET/PUT | `/policy` | view / policy.edit |
| GET/POST/PATCH/DELETE | `/service-areas[/:areaId]` | view / areas.manage |
| GET/POST/DELETE | `/admins[/:adminId]` | view / admins.manage |
| GET/POST | `/announcements` | view / announcements.manage |
| GET | `/audit-logs` | audit.view |
| GET | `/memberships?status` · POST `/memberships/:id/decision` `{decision: APPROVE\|REJECT\|SUSPEND\|REINSTATE, note}` | members.manage |
| GET | `/drivers` · POST `/documents/:documentId/review` | drivers.manage |
| GET | `/vehicles?status` · POST `/vehicles/:id/decision` `{decision, seatCapacity?, note}` | vehicles.manage |
| GET | `/queue` · POST `/queue/:driverId/remove` | queue.manage |
| GET/POST/PATCH | `/pickup-points[/:pointId]` | view / routes.manage |
| GET/POST/PATCH | `/routes[/:routeId]` (stops in body) | view / routes.manage |
| POST/PATCH | `/routes/:routeId/schedules[/:scheduleId]` | routes.manage |
| GET | `/bookings` · `/stats` | bookings.view |

Related:

| Method | Path | Permission |
|---|---|---|
| GET | `/shared-trips/community/:communityId` | bookings.view |
| POST | `/shared-trips/:id/assign` `{driverId}` · `/shared-trips/:id/cancel` `{reason}` | queue.manage · routes.manage |
| GET/POST | `/fares/communities/:communityId/proposals` | view · fares.propose |
| POST | `/fares/proposals/:id/votes` `{decision: APPROVE\|REJECT, comment?}` | fares.approve |
| POST | `/fares/proposals/:id/withdraw` | proposer or head |
| GET/PATCH | `/complaints?communityId&status` · `/complaints/:id` | complaints.manage |
| GET | `/reports/communities/:id/statements` | statements.view |
| GET | `/reports/bookings.csv?communityId&from&to` | statements.view |

## Platform admin — `/admin/…` (SUPER_ADMIN)

| Method | Path | Description |
|---|---|---|
| GET | `/admin/dashboard` | Platform metrics, open issues, recent SOS |
| GET/POST/PATCH | `/admin/cities[/:id]` | Supported cities |
| GET/POST | `/admin/communities` | List / create (optionally assigning a head) |
| POST | `/admin/communities/:id/status` | Activate / suspend / deactivate (reason required unless activating) |
| PUT | `/admin/communities/:id/platform-policy` | Max increase without review, distance fares allowed, community fee |
| GET | `/admin/drivers` · POST `/admin/drivers/:id/verification` · POST `/admin/drivers/:id/status` · POST `/admin/documents/:id/review` | Verification and platform-wide suspension |
| GET | `/admin/users` · POST `/admin/users/:id/status` | Suspend/reactivate (revokes sessions) |
| GET | `/admin/bookings` | All bookings |
| GET/POST | `/admin/fees` | Platform fee schedule (no backdating) |
| GET/PUT | `/admin/feature-flags[/:key]` | Feature flags |
| GET/PUT | `/admin/settings/fare-caps` | Regulatory fare caps |
| GET | `/admin/audit-logs` | Platform audit log |
| GET/POST | `/fares/reviews` · `/fares/reviews/:id` `{decision: APPROVED\|REJECTED, note}` | Platform fare review |
| GET/PATCH | `/support-tickets` · `/support-tickets/:id` | Support desk |
| POST | `/payments/:paymentId/refunds` | Manual refund |
| POST | `/reports/communities/:id/statements` `{from, to}` | Issue a statement |

## Payments and webhooks

| Method | Path | Description |
|---|---|---|
| POST | `/payments/webhooks/:provider` | Raw body, `X-Signature` = HMAC-SHA256(body, `PAYMENT_WEBHOOK_SECRET`). Events: `payment.succeeded`, `payment.failed`. Amount must match. Replays are no-ops |
| GET/POST | `/payments/mock-gateway/:ref[/complete]` | **Development-only** mock hosted checkout (404 in production). Completing it sends a signed webhook through the normal verification path |

## Socket.IO events (path `/socket.io`, `auth: { token }`)

| Event | Room | Payload |
|---|---|---|
| `booking:updated` | passenger, driver, community | `{ bookingId, status? }` |
| `offer:new` | driver | `{ bookingId, expiresAt }` |
| `driver:location` | passenger of the active trip | `{ bookingId, lat, lng, heading, at }` |
| `notification` | user | `{ type, title, body, link }` |
| `queue:updated` | community | `{ driverId }` |
| `trip:seats` · `trip:updated` · `trip:event` · `trip:manifest` | community / driver | `{ tripInstanceId, … }` |
