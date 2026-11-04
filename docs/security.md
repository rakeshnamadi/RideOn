# Security

## Authentication and sessions

- **Passwords:** Argon2id (19 MiB, t=2, p=1 — OWASP baseline), min 10 chars with letters and digits. Unknown accounts still run a dummy verify so timing doesn't reveal which phone numbers exist.
- **Lockout:** 5 failed attempts lock the account for 15 minutes (`423`).
- **Access tokens:** HS256 JWT, 15 minutes, issuer/audience checked, carry the session id. Each request also checks that the **session is still live** and reloads roles from the database, so logout, suspension and role removal take effect immediately rather than at token expiry.
- **Refresh tokens:** 48 random bytes in an `HttpOnly`, `SameSite=Strict`, `Secure` (production) cookie scoped to `/api/v1/auth`. Only an HMAC (peppered) is stored. Tokens rotate on every refresh with an absolute 14-day lifetime; **presenting a rotated token revokes the whole session family** (stolen-token detection, covered by tests).
- **Access token storage:** in memory only on the client — never `localStorage`.
- **CSRF:** the only cookie-authenticated endpoints (refresh, logout) require `X-Requested-With: rideon`. Browsers can't send that cross-origin without a CORS preflight, which the explicit CORS allow-list rejects. All other endpoints use Bearer tokens, which are not sent automatically.
- **Recovery:** single-use, 30-minute reset tokens (SHA-256 stored); identical responses whether or not the account exists; successful reset revokes all sessions. **No SMS/email provider is integrated yet** — in non-production the token is returned in the API response for testing; in production it is only logged as issued. A delivery provider must be added before launch.

## Authorisation

- Global permissions via `roles`/`permissions`; community permissions via `community_admins.role` → `COMMUNITY_ROLE_PERMISSIONS`.
- `requireCommunity(perm)` guards every `/communities/:communityId/*` route, and **every query is additionally scoped by the URL's community id**, so a valid id from another community returns `404` (tests: `isolation.test.ts`).
- Object-level checks on bookings (passenger, assigned driver, or authorised staff), driver documents (owner, super admin, or staff of a community the driver applied to), manifests, payments and offers.
- Super admins hold every permission in every union and assign all roles. Local admins can only manage roles and permissions below their own (`assertCanManageRole`, `DELEGABLE_PERMISSIONS`), cannot change their own role, and the last super admin cannot be removed.
- The server never trusts client-supplied roles, community ids, fares, driver ids or amounts: fares come from server quotes, amounts from the database, community from the quote/trip/service area.

## Input, output and transport

- Zod validation on every body, query and param; unknown/invalid input → `400` with field details.
- Prisma parameterised queries; the few raw queries use tagged templates (`$queryRaw\`…${id}\``), never string concatenation.
- `helmet` headers on the API (CSP `default-src 'none'`); the nginx config adds CSP and framing protection for the SPA.
- CORS restricted to `WEB_ORIGIN`; JSON body limit 100 kB.
- Rate limits: global 600/min/IP; auth 30/15 min/IP; geocoding 40/min/user; quotes and estimates 30/min/user.
- CSV exports neutralise spreadsheet formula injection and contain no passenger contact details.

## Files

- Uploads are held in memory (5 MB, one file), **type detected from magic bytes** (PDF/JPEG/PNG only), stored under a random key in `UPLOAD_DIR` outside any web root, and streamed only through an authorised endpoint with `nosniff`, `no-store` and a sanitised filename. Every document view is audited.

## Privacy

- Driver location: stored only while online (one latest row, no history), deleted when the driver goes offline, purged after 15 minutes without updates; visible to the passenger only during their active trip, to community operators on the live queue, and to trusted contacts only through an expiring share link.
- Passengers see the driver's first name, rating and vehicle — never phone numbers. Drivers see passenger first names only.
- Logs redact authorisation headers, cookies, passwords, tokens, PINs, phone numbers and emails; audit snapshots redact secret-like keys.
- Consents (terms, privacy, location) are recorded with version and timestamp.

## Payments

- No card data touches the system. The provider abstraction expects hosted checkout + signed webhooks.
- A payment becomes `SUCCEEDED` **only** through a webhook whose HMAC signature and amount verify. Duplicate webhooks are no-ops; `successKey` makes double-charging a booking impossible at the database level.
- The mock provider is development-only: its pages are labelled as simulations, return `404` in production, and the API refuses to start with `PAYMENT_PROVIDER=mock` in production.

## Integrity and audit

- `audit_logs` and `fare_history` are append-only (DB triggers reject UPDATE/DELETE).
- `activity_logs` records every API request (user, path, status, IP, user agent) for 90 days, viewable by super admins only. Tracking tokens and gateway references are masked in stored paths, and query strings and bodies are never stored. Treat it as personal data under your privacy notice.
- Sign-ins, failures, blocked attempts and lockouts are written to the audit log.
- Sensitive actions audited: logins anomalies (token reuse), registrations, password resets, every community decision (membership, documents, vehicles, routes, schedules, areas, policy, admins, queue removals), fare proposals/votes/reviews/publication, bookings created/accepted/completed/cancelled, payments, refunds, statements, exports, user/driver/community status changes, SOS.

## Production checklist

- [ ] Strong unique `JWT_ACCESS_SECRET`, `JWT_REFRESH_PEPPER`, `PAYMENT_WEBHOOK_SECRET` from a secret manager.
- [ ] `NODE_ENV=production`, `COOKIE_SECURE=true`, HTTPS everywhere, correct `TRUST_PROXY`.
- [ ] Real payment provider adapter + webhook secret; `PAYMENT_PROVIDER` ≠ `mock`.
- [ ] SMS/email provider for password reset and notifications.
- [ ] Do not run the demo seed; create the first super admin via a controlled script.
- [ ] Hosted tile, geocoding and routing providers under appropriate agreements.
- [ ] Encrypted backups of MySQL and `UPLOAD_DIR` (or move documents to encrypted object storage).
- [ ] Legal review of fare caps, data retention, and consent texts for each state.
