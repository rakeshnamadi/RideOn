# RideOn — community-governed auto transportation

> **Your city. Your people. Your ride.**

RideOn is a booking platform for auto-rickshaws in India where **local driver communities govern their own networks**: they manage members, stands, service areas, shared-auto routes and fare proposals, while the platform provides booking, maps, payments, verification, reporting and support.

It has four consoles:

| Console | Path | Who |
|---|---|---|
| Passenger | `/app` | Book regular autos and shared-auto seats, track trips, pay, rate, complain |
| Driver | `/driver` | Go online, accept trips, run shared departures, see earnings and every deduction |
| Community admin | `/community/:id` | Members, documents, vehicles, zones, stands, routes, fares and governance, queue, complaints, statements |
| Platform admin | `/admin` | Communities, verification, fare reviews, fees, flags, users, support, audit, reports |

Published fares and routes are browsable without an account at `/fares`.

## Positioning

| | Message | Where it shows up in the product |
|---|---|---|
| Core | **Your city. Your people. Your ride.** | Landing hero and closing call to action, sign-in panel, every console sidebar, footer |
| Passengers | **The freedom to travel your way** | Whole auto or one seat, fare shown and locked before you go, public fare tables, start PIN / trip sharing / emergency button, English or Hindi. Shown on the landing page, sign-up, and above the booking form. |
| Drivers | **Respect for the people who move your city** | Fares set by the community (not an algorithm), every rupee shown per trip, first-come turns at the stand, recorded decisions and appeals. Shown on the landing page (with a live fee breakdown), driver sign-up, and the driver home banner. |

The landing page’s example trip and earnings breakdown use live data — a real fare estimate between two published stops and the real platform and community fees — never invented figures. The visual system (“Marigold Transit”: ink green, auto-rickshaw marigold, warm paper; Bricolage Grotesque over Inter) lives in `apps/web/src/index.css`.

## Stack

- **Web:** React 19, TypeScript, Vite, Tailwind CSS 4, React Router 7, TanStack Query, React Hook Form + Zod, Leaflet + OpenStreetMap tiles, Socket.IO client
- **API:** Node.js 24 LTS, TypeScript, Express 5, Zod, Prisma 6, MySQL 8.4, Socket.IO, Argon2id, JWT + rotating refresh cookies, pino
- **Tests:** Vitest, Supertest (against real MySQL), Testing Library

```
apps/api     Express API, Prisma schema/migrations/seed, jobs, sockets, tests
apps/web     React app (four consoles + public pages), tests
e2e/         Playwright browser journeys (isolated database, API and web server)
docs/        architecture, database, API, security, deployment
scripts/     local MySQL start/stop helpers
```

## Quick start (local development)

Requirements: Node.js 24+, MySQL 8.0+ (any local install, Docker, or the portable setup below).

```bash
npm install
```

```bash
cp .env.example .env
```

Edit `.env`: set `DATABASE_URL`, `TEST_DATABASE_URL` and generate the three secrets. Then create the schema and demo data:

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

Start the API (port 4000) and the web app (port 5173) in two terminals:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Open http://localhost:5173. The Vite dev server proxies `/api` and `/socket.io` to the API, so cookies work same-origin.

### Portable setup used to build this project (Windows)

This repository was developed with a project-local Node.js and MySQL in `.tools/` (git-ignored):

- `.tools/node/` — Node.js 24.22.1 (official zip, SHA-256 verified)
- `.tools/mysql/` — MySQL 8.4.13 (official zip, MD5 verified), data in `.tools/mysql-data`, config in `.tools/my.ini`, listening on `127.0.0.1:3307`

```bash
sh scripts/db-start.sh
```

Add `.tools/node` to `PATH` in your shell before running `npm`. Stop MySQL with `sh scripts/db-stop.sh`.

## Demo accounts (development seed only)

All seeded accounts use the password **`Demo@12345`**. They exist only when you run the development seed, which refuses to run with `NODE_ENV=production`. Never use these credentials anywhere else.

| Role | Phone | Notes |
|---|---|---|
| Super admin | 9000000001 | Control over everything; assigns roles. Also a passenger |
| Local admin, Ainavilli | 9000000002, 9000000003 | Runs the union: drivers, prices, points, master data, team |
| Approver, Ainavilli | 9000000004 | Votes on fare proposals, answers fare feedback |
| Local admin, Amalapuram | 9000000005 | Different union (isolation demo) |
| Reporter, Ainavilli | 9000000006 | Reports, driver approval, area geolocation |
| Drivers, Ainavilli (verified) | 9000000010–12 | Approved members with approved vehicles |
| Driver applicant | 9000000013 | Pending membership and verification |
| Driver, Amalapuram | 9000000014 | |
| Passengers | 9000000020, 9000000021 | |

The seed centres on the primary service area, **pincode 533211: Ainavilli mandal, Dr. B.R. Ambedkar Konaseema district, Andhra Pradesh**. It creates two active unions (Ainavilli, Amalapuram Town) and one pending one (Kothapeta), service areas, auto stands, two shared routes with schedules (AV-1, AM-1), approved fare tables, fee schedules, and 12 historical completed trips (clearly marked sample data). Union names and details are placeholders, not real organisations.

## Roles

| Role | Scope | Can do |
|---|---|---|
| **Super admin** | Platform | Assign platform and union roles to anyone registered; update or delete configured data; every union permission in every union |
| **Local admin** | One union | Approve drivers; fix prices; add or delete pickup and drop points; edit union master data (name, logo, colour, contacts); give roles and individual permissions to the people below them |
| **Reporter** | One union | Prepare, view and edit reports; approve new drivers; set area geolocation |
| **Approver** | One union | Vote on fare proposals; read and answer driver fare feedback |
| **Operator** | One union | Live queue and departures; bookings; complaints |
| **Driver** | Own account | Give feedback and price suggestions on union fares; raise tickets; run trips |

Local admins can switch individual permissions on or off for each delegate under **Team & permissions**. Each person sees only the pages their permissions allow, and the API enforces the same rules. Every API request is recorded in the local database's activity log (**Activity log** in the platform console, kept 90 days); decisions are kept permanently in the audit log.

### Trying a full trip locally

Drivers need a location to receive offers. In the driver console choose **Set on the map** (labelled *Manual location*) when going online, or use device GPS. Then sign in as a passenger in another browser profile and book a ride inside the Ainavilli area.

## Tests

```bash
npm test
```

This runs the API suite (unit + integration against the `TEST_DATABASE_URL` MySQL database, which is migrated automatically and truncated per test file) and the web suite.

Browser end-to-end tests (Playwright, driving your installed Google Chrome — no browser download):

```bash
npm run test:e2e
```

They start their own isolated stack — a `rideon_e2e` database (created, migrated and reseeded on every run), an API on port 4100 and the web app on port 5174 — so they never touch development data and can run while `dev:api`/`dev:web` are up. MySQL must be running. On failure, traces and screenshots are kept in `e2e/test-results/`; open the HTML report with `npx playwright show-report e2e/report`. See `BUILD_STATUS.md` for the latest recorded results.

## Useful scripts

| Command | What it does |
|---|---|
| `npm run dev:api` / `npm run dev:web` | Run API / web in watch mode |
| `npm run build` | Production build of both apps |
| `npm run typecheck` | Type-check both apps |
| `npm run lint` | ESLint (TypeScript + React Hooks rules) over both apps and the E2E suite |
| `npm run test:e2e` | Playwright browser journeys against an isolated stack |
| `npm run db:migrate` | Apply migrations (`prisma migrate deploy`) |
| `npm run db:seed` | Load development demo data |
| `npm run db:reset` | Drop and recreate the dev database (destructive; Prisma asks for confirmation) |

## Documentation

- [Architecture](docs/architecture.md)
- [Database design](docs/database-design.md)
- [API documentation](docs/api-documentation.md)
- [Security](docs/security.md)
- [Deployment](docs/deployment.md)
- [Build status, test results and known limitations](BUILD_STATUS.md)
