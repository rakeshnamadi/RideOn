# Architecture

## Overview

```
Browser (React SPA) ──HTTPS──▶ nginx / Vite proxy ──▶ Express API (/api/v1) ──▶ MySQL 8 (Prisma)
        │                                   │                │
        └────────── WebSocket (Socket.IO) ──┘                ├──▶ Routing provider (OSRM)
                                                             ├──▶ Geocoding provider (Nominatim)
                                                             └──▶ Payment provider (mock in dev)
```

- **One SQL database is the source of truth** for users, communities, drivers, vehicles, routes, fares, bookings, payments and audit records.
- **The API is authoritative** for every business rule: fares, seat allocation, state transitions, eligibility, permissions. The web app never computes a price it charges; it displays server quotes.
- **Real-time is an enhancement.** Socket.IO pushes booking updates, offers, queue changes and notifications. Every screen also polls through TanStack Query (`useLiveInterval`: faster when the socket is down), so the booking flow works without a WebSocket.

## Backend layout (`apps/api/src`)

| Path | Responsibility |
|---|---|
| `config/` | Environment validation (Zod) and structured logging (pino, with redaction) |
| `middleware/` | Auth (Bearer JWT + live session check), community scope guard, rate limits, CSRF header check, error mapping |
| `modules/auth` | Registration, login, refresh rotation with reuse detection, password reset, permission model |
| `modules/communities` | Public community pages, profile, policy, service areas, admins, announcements, operations (members, drivers, documents, vehicles, queue, stands, routes, schedules, bookings, stats) |
| `modules/drivers` | Driver profile, documents (private storage), memberships, vehicles, eligibility, availability, location, offers, earnings |
| `modules/fares` | **Pure fare engine**, rule lookup, quotes, governance (proposals, votes, platform review, publication) |
| `modules/bookings` | **Pure state machine** and cancellation rules, regular booking service (create, dispatch, accept, trip progress, cancel, share, SOS) |
| `modules/shared-trips` | Trip-instance generation, atomic seat holds, confirmation, manifests, boarding, departures |
| `modules/payments` | **Pure fee split**, provider abstraction (mock hosted checkout + signed webhooks), cash confirmation, refunds |
| `modules/support` | Ratings, complaints/disputes/appeals, support tickets |
| `modules/admin`, `modules/reports` | Platform console APIs, statements, CSV export |
| `services/` | Routing, geocoding, private file storage |
| `jobs/` | In-process scheduler: dispatch sweeps, request expiry, seat-hold expiry, departure generation, reminders, location purge |
| `sockets/` | Socket.IO server with authenticated rooms |

The "repository" layer is Prisma itself; services take a Prisma client or transaction (`Db`/`Tx`) so the same function can run inside a caller's transaction.

## Frontend layout (`apps/web/src`)

| Path | Responsibility |
|---|---|
| `app/` | Auth context (session restore from refresh cookie), router with role and community guards |
| `layouts/` | Public, passenger (bottom tab bar on mobile), and a shared console layout used by the driver, community and admin consoles, each with its own navigation |
| `components/ui` | Buttons, form controls, cards, badges, tables, pagination, tabs, modal, confirm dialog, loading/empty/error states, toasts |
| `components/map` | Leaflet base map (configurable tiles + attribution), pins, route lines, polygons, map click, bounds fitting, address search |
| `features/` | Cross-console pieces (fare summary, complaints board, audit table) |
| `pages/` | One file per screen, lazy-loaded per console |
| `services/` | API client (in-memory access token, single-flight refresh, CSRF header), Socket.IO client |
| `i18n/` | Dictionary-based translations (English, Hindi for the passenger flow); add a language by adding a file |

## Key flows

### Regular booking

1. `POST /fares/quotes` — server finds the community whose active service area contains the pickup, loads its fare rule in force, gets road distance (OSRM, or a labelled straight-line estimate on failure), prices it, stores a quote valid for 10 minutes.
2. `POST /bookings` with the quote and an idempotency key — inside one transaction: replay check, active-booking check, quote marked used with a conditional update, booking + status history + audit created.
3. Dispatch offers the request to up to 3 eligible drivers (verified, approved member, approved vehicle, online, fresh location, within 6 km), preferring drivers queued at a nearby stand in queue order. Offers expire after the community's timeout; a job offers the next batch. No candidates → `NO_DRIVER_AVAILABLE`; request timeout → `EXPIRED`.
4. Accept: transaction re-checks eligibility, flips the driver `ONLINE → ON_TRIP` with a conditional update, then moves the booking `REQUESTED → ACCEPTED` with an optimistic version check. Exactly one driver can win.
5. `ARRIVING` → `IN_PROGRESS` requires the passenger's 4-digit PIN; waiting charges are computed from the published rule. `COMPLETED` records the final fare and the fee split.
6. Payment: driver confirms cash, or the passenger pays online via the provider's hosted checkout; online success is only ever set by a verified webhook.

### Shared-auto booking

Routes have ordered stops; schedules materialise as `shared_trip_instances` for the next 3 days. A seat hold locks the trip-instance row (`SELECT … FOR UPDATE`), checks capacity, assigns the lowest free seat numbers, and writes `seat_reservations` whose `activeSeatKey` has a unique index — a second, independent guarantee against double allocation. A `CHECK` constraint keeps `seatsBooked ≤ capacity`. Holds expire after the community's hold time; the passenger confirms to keep them. Drivers board passengers with the PIN, drop them, and complete the departure; never-boarded passengers become no-shows.

### Fare governance

Proposal → validation against platform fare caps and community policy → votes by authorised approvers (with optional self-approval ban and veto on reject) → optional platform review (forced when an increase exceeds the community's limit) → publication as a new fare-rule version effective from the proposed time. The previous rule is closed at that instant; bookings keep the rule and fare they were created with. Every change writes `fare_history` and `audit_logs`, both append-only by DB trigger.

## Background jobs

| Job | Interval | Purpose |
|---|---|---|
| dispatch-sweep | 5 s | Expire unanswered offers, offer the next batch |
| expire-requests | 15 s | `REQUESTED` past the request timeout → `EXPIRED` |
| expire-seat-holds | 20 s | Release unconfirmed shared holds |
| generate-departures | 30 min | Materialise schedules into trip instances |
| departure-reminders | 1 min | Notify passengers 30 min before departure |
| purge-locations | 5 min | Delete stale driver locations, take vanished drivers offline |

All jobs use conditional updates, so running more than one API instance is safe; see deployment notes for moving them to a single worker.

## Decisions and documented defaults

- **Monorepo with npm workspaces.** No extra build tool needed.
- **Prisma 6 (not 7/8)**: Prisma's newest major was a release candidate at build time; 6.19 is stable and well understood.
- **Polygons as JSON `[lat,lng]` arrays** with point-in-polygon in application code, because Prisma has no MySQL spatial type support. Fine for tens of polygons per city; see deployment notes for scaling.
- **Community roles** (`HEAD`, `ADMIN`, `APPROVER`, `OPERATOR`) map to permissions in code (`COMMUNITY_ROLE_PERMISSIONS`); global permissions are seeded into the `roles`/`permissions` tables.
- **Super admins have oversight, not governance**: they can view and moderate any community but cannot propose or vote on fares; they act through the separate platform-review step.
- **Default veto rule**: any authorised approver's rejection rejects a proposal. Approval needs `requiredApprovals` approvals (and platform approval where required).
- **Rules vs settings**: governance rules and passenger charges (approval mode, approvals required, self-approval, notice period, free-cancellation window, cancellation fee) change only through an approved POLICY_CHANGE proposal, decided under the rules in force when it was proposed. Operational settings (offer/request timeouts, seat-hold time) stay directly editable by the community head and are audited.
- **Route paths** come from one multi-waypoint routing request when a route is created or its stops change, are stored on the route, and are backfilled in the background when missing; maps fall back to dashed straight segments.
- **Brand**: the positioning ("Your city. Your people. Your ride.") and the two audience promises live in the i18n dictionaries (`brand.*`, `home.*`), so every surface and language uses the same words.
- **Cancellation fees are recorded** on the booking and refunds are reduced accordingly for prepaid bookings; collecting a fee from a cash passenger is out of scope for the pilot.
- **Shared fares** are per seat: a base amount for the first stop travelled plus a per-stop increment, floored by a minimum, rounded to the rupee.
- **All money is integer paise**; fares round to the nearest rupee and the rounding is shown as a line item.
