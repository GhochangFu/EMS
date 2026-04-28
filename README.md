# Eskom SMOC BMS

A real-time Building Management System for Eskom's Smart Metering
Operating Centres. The seven-screen prototype is complete; the project
is now **Part 2 / Phase 1 Sprint D ready** after completing container
foundations, CI, Redis-backed realtime fan-out, and Keycloak / OIDC
authentication.

## Repository tour

| Path | What it is |
|------|------------|
| [`AGENTS.md`](./AGENTS.md) | **Active rulebook.** Read this before editing anything. |
| [`ESKOM_SMOC.html`](./ESKOM_SMOC.html) | UX reference mockup. Single-file SPA prototype. Treat as read-only. |
| [`docs/AGENTS.production.md`](./docs/AGENTS.production.md) | North-star rulebook for the production target. Reference, not enforcement. |
| [`docs/roadmap.md`](./docs/roadmap.md) | Prototype week-by-week plan + numbered post-prototype phases. |
| [`docs/local-setup.md`](./docs/local-setup.md) | Exact WSL2 + Postgres + Timescale + Node setup steps. |
| [`docs/env-inventory.md`](./docs/env-inventory.md) | Environment variables for native and compose-based development. |
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

Open `http://localhost:5173`. Sign in as `admin@bms.local` / `admin123`
(seeded).

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

If the database volume already exists and you need a clean local compose
DB, stop the stack and remove only the compose volume:

```bash
docker compose down
docker volume rm bms_bms-postgres-data
```

## Stack (active)

React 18 + Vite · Tailwind · TanStack Query · Zustand · Leaflet ·
ECharts · NestJS (Node 20) · Socket.IO · Redis · PostgreSQL 16 ·
TimescaleDB · Drizzle ORM · Keycloak/OIDC · Docker Compose · GitHub
Actions · pnpm monorepo.

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

Prototype screen set is complete. Phase 1 Sprint B Redis-backed realtime
fan-out is complete. Phase 1 Sprint C Keycloak / OIDC authentication is
complete. Phase 1 Sprint D observability baseline is ready; see
[`docs/roadmap.md`](./docs/roadmap.md) for the full phase breakdown.
