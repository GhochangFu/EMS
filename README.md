# TRINETRA — Enterprise EMS for Ion Exchange (India) Ltd.

A real-time enterprise monitoring platform (BMS/EMS) for electrical, HVAC,
UPS/battery, water and environmental telemetry. Product brand **TRINETRA**,
powered by Euphoria Infotech India Limited. This repository is the **Ion
Exchange (India) Ltd. Enterprise EMS product line** (ADR 0013); it was forked
from the Eskom SMOC engagement, whose demo data and UX reference mockups it
still carries.

Prototype and pilot-hardening history: the seven-screen prototype is complete;
**Part 2 / Phase 1 pilot-ready hardening** is done; Phase 5 Sprint A–I are
complete and **Sprint J/K/L/M/N — Location and Access** is open. Pending scope
(including the Ion Exchange SOW delta) is tracked in
[`docs/BACKLOG.md`](./docs/BACKLOG.md); protocol adapters, brokers, and the
broader AI layer remain out of scope until explicitly promoted.

## Repository tour

| Path | What it is |
|------|------------|
| [`AGENTS.md`](./AGENTS.md) | **Active rulebook.** Read this before editing anything. |
| [`ESKOM_SMOC.html`](./ESKOM_SMOC.html) | UX reference mockup. Single-file SPA prototype. Treat as read-only. |
| [`docs/AGENTS.production.md`](./docs/AGENTS.production.md) | North-star rulebook for the production target. Reference, not enforcement. |
| [`docs/roadmap.md`](./docs/roadmap.md) | Prototype week-by-week plan + numbered post-prototype phases. |
| [`docs/BACKLOG.md`](./docs/BACKLOG.md) | **Live pending-feature backlog** (F/E ids, waves, dependencies, status). |
| [`docs/local-setup.md`](./docs/local-setup.md) | Exact WSL2 + Postgres + Timescale + Node setup steps. |
| [`docs/windows-vm-docker-deploy.md`](./docs/windows-vm-docker-deploy.md) | Windows VM + Docker Desktop pilot deploy (compose only; no host Postgres). |
| [`docs/env-inventory.md`](./docs/env-inventory.md) | Environment variables for native and compose-based development. |
| [`docs/security/encryption-at-rest.md`](./docs/security/encryption-at-rest.md) | **Read before deploying.** What is and is not encrypted at rest, and the host/platform encryption a deployer must configure. |
| [`docs/observability-runbook.md`](./docs/observability-runbook.md) | Sprint D Prometheus/Grafana/Loki health-check steps. |
| [`docs/phase-2-ingestion-readiness.md`](./docs/phase-2-ingestion-readiness.md) | Phase 2 Sprint 0 source inventory, mapping, and Path A / Path B decision workbook. |
| [`docs/ingest-host.md`](./docs/ingest-host.md) | The `apps/ingest` adapter host — why there are two entry points, its environment, and the ADR 0016 parallel-run procedure. |
| [`docs/decisions.md`](./docs/decisions.md) | ADR-lite log of non-obvious choices made during the prototype. |
| [`docs/adr/`](./docs/adr) | Phase 1+ architecture decisions. |

## Quick start: native WSL

Native WSL remains the lightest day-to-day development path. See
**[`docs/local-setup.md`](./docs/local-setup.md)** for the full
installation walkthrough; once dependencies are in place:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

pnpm install
pnpm db:migrate && pnpm db:seed

# In three terminals:
pnpm --filter api dev    # NestJS on :4000
pnpm --filter web dev    # Vite on :5173
pnpm --filter sim start  # telemetry simulator (Sprint 2: live data)
```

Open `http://localhost:5173`. Seeded local demo users:

- Global admin: `admin@bms.local` / `admin123`
- Western Cape all-asset location admin: `wc-admin@bms.local` / `admin123`
- Western Cape HVAC asset-group admin: `wc-hvac-admin@bms.local` / `admin123`

## Quick start: Docker Compose

Phase 1 adds a reproducible compose path for fresh machines and pilot
VMs. Use profiles so an 8 GB laptop does not need to run every service
all day.

```bash
# Build and start Postgres/TimescaleDB, Redis, Keycloak, migrations/seed, API, and web.
docker compose --profile core up --build

# Optional: run migrations and seed data explicitly.
docker compose --profile migrate run --rm migrate

# Optional: start live telemetry; this also waits for migrations/seed.
docker compose --profile sim up --build sim
```

Open `http://localhost:5173`. The compose database is exposed on
`localhost:5432`; the API is exposed on `localhost:4000`; Keycloak is
exposed on `localhost:8080`.

With the compose path, sign in through Keycloak as `admin@bms.local` /
`admin123`. Native WSL can still use the local login form when
`VITE_AUTH_MODE=local` and `AUTH_MODE=local`.

For a demo-like run with API, web, simulator, and migration/seed ordering:

```bash
docker compose --profile pilot up --build
```

To verify Redis-backed Socket.IO fan-out across two API processes:

```bash
docker compose --profile realtime-smoke up -d --build api api-replica
pnpm --filter web smoke:realtime
```

To start the optional Sprint D observability stack alongside the core app:

```bash
docker compose --profile core --profile sim --profile observability up --build
```

Open Grafana at `http://localhost:3000` (`admin` / `admin`) and use the
**BMS Pilot Overview** dashboard. Prometheus is exposed on
`localhost:9090`, Loki on `localhost:3100`, and simulator metrics on
`localhost:9101`.

If the database volume already exists and you need a clean local compose
DB, stop the stack and remove only the compose volume:

```bash
docker compose down
docker volume rm bms_bms-postgres-data
```

## Stack (active)

React 18 + Vite · Tailwind · TanStack Query · Zustand · Leaflet ·
ECharts · NestJS (Node 20) · Socket.IO · Redis · PostgreSQL 16 ·
TimescaleDB · Drizzle ORM · Keycloak/OIDC · Prometheus · Grafana · Loki ·
OpenTelemetry · Docker Compose · GitHub Actions · pnpm monorepo.

Full stack table and rationale: [`AGENTS.md`](./AGENTS.md) §2.

## Working in this repo

1. Read [`AGENTS.md`](./AGENTS.md) — it defines the active scope, code
   rules, and what is **out of scope** for the current sprint.
2. Match the style of existing modules. When in doubt, copy the
   nearest pattern.
3. Capture Phase 1+ non-obvious choices as ADRs in
   [`docs/adr/`](./docs/adr).
4. Anything from `AGENTS.md` §6 (Out of Scope) requires a Promotion PR
   per `AGENTS.md` §10 before it can land.

## Status

Prototype screen set is complete. Phase 1 hardening and Phase 5 Sprint I
UI alignment are complete. Phase 5 Sprint J/K/L/M/N — Location and Access
is open:
canonical locations, RSMOC demo assets, DB-backed user scopes, scoped
realtime/API reads, location dashboard drill-down, live-location markers,
schematic access guards, Control Room asset-group UI gating, focused
simulator settings, telemetry dashboard indexing, and the collapsible shell
sidebar have been added. This hardening pass moves live Pretoria demo
assets under `CSMOC Gauteng`, keeps Pretoria North inventory-only dummy
assets without telemetry, and hides the prototype `/sld` and `/crac` menu
entries temporarily. It still needs a clean migration/seed pass,
Keycloak realm verification, automated access-control coverage, and a
page-by-page role walkthrough before it can be called complete. Phase 2
real ingestion is **live for the single PHE MQTT pilot RTU** (ADR 0007) and
paused for everything else — no EMQX, and every other protocol still needs its
own ADR; Phase 6 Three.js visuals remain later and
AI Copilot remains deferred. See [`docs/roadmap.md`](./docs/roadmap.md)
for the full phase breakdown.
