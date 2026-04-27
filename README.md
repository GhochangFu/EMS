# Eskom SMOC BMS

A real-time Building Management System for Eskom's Smart Metering
Operating Centres. Currently in **prototype phase** — a working,
demo-able laptop build covering seven core screens. Production
hardening follows after sign-off.

## Repository tour

| Path | What it is |
|------|------------|
| [`AGENTS.md`](./AGENTS.md) | **Active rulebook.** Read this before editing anything. |
| [`ESKOM_SMOC.html`](./ESKOM_SMOC.html) | UX reference mockup. Single-file SPA prototype. Treat as read-only. |
| [`docs/AGENTS.production.md`](./docs/AGENTS.production.md) | North-star rulebook for the production target. Reference, not enforcement. |
| [`docs/roadmap.md`](./docs/roadmap.md) | Prototype week-by-week plan + numbered post-prototype phases. |
| [`docs/local-setup.md`](./docs/local-setup.md) | Exact WSL2 + Postgres + Timescale + Node setup steps. |
| [`docs/decisions.md`](./docs/decisions.md) | ADR-lite log of non-obvious choices made during the prototype. |

## Quick start

The prototype runs entirely on a single laptop (Windows 11 + WSL2). No
Docker required. See **[`docs/local-setup.md`](./docs/local-setup.md)**
for the full installation walkthrough; once dependencies are in place:

```bash
pnpm install
pnpm db:migrate && pnpm db:seed

# In three terminals:
pnpm --filter api dev    # NestJS on :4000
pnpm --filter web dev    # Vite on :5173
pnpm --filter sim start  # telemetry simulator
```

Open `http://localhost:5173`.

## Stack (prototype)

React 18 + Vite · Tailwind · TanStack Query · Zustand · Leaflet ·
ECharts · NestJS (Node 20) · Socket.IO · PostgreSQL 16 · TimescaleDB ·
Drizzle ORM · pnpm monorepo.

Full stack table and rationale: [`AGENTS.md`](./AGENTS.md) §2.

## Working in this repo

1. Read [`AGENTS.md`](./AGENTS.md) — it defines the active scope, code
   rules, and what is **out of scope** for the prototype.
2. Match the style of existing modules. When in doubt, copy the
   nearest pattern.
3. Capture non-obvious choices as a one-liner in
   [`docs/decisions.md`](./docs/decisions.md).
4. Anything from `AGENTS.md` §6 (Out of Scope) requires a Promotion PR
   per `AGENTS.md` §10 before it can land.

## Status

Sprint 0 — Documentation & decisions. See
[`docs/roadmap.md`](./docs/roadmap.md) for the active sprint and
upcoming work.
