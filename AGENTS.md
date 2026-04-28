# AGENTS.md — Eskom SMOC BMS (Part 2 / Phase 1 Sprint A)

> **Status:** ACTIVE — Phase 1 Sprint A container foundation and CI.
> **North star:** see `docs/AGENTS.production.md` for the full production
> rules we will promote from as the system grows.

This file is the rulebook humans and AI agents must follow **right now**.
The seven-screen prototype is complete. We are now promoting the first
add-on slice from the production north star: container foundations and
CI for a pilot-ready single-VM deployment path.

---

## 1. Goal

The prototype has completed the seven-screen end-to-end pipeline:

`simulated device → Postgres/Timescale → NestJS API → WebSocket → React UI → user`

Phase 1 Sprint A now makes that prototype reproducible outside the
original native WSL setup:

1. Dockerfiles for API, web, and simulator.
2. Docker Compose profiles for local development and a single-VM pilot.
3. GitHub Actions CI for install, build/typecheck, and migration
   validation.
4. Environment inventory and setup docs that keep laptop development
   practical.

The completed prototype screens are:

1. **Login** — simple JWT
2. **Executive Dashboard** — live KPIs + trend chart
3. **Alarm Centre** — live alarms + ack
4. **World Map** — Eskom stations + SMOC campuses on Leaflet
5. **Electrical SLD** — animated single-line diagram with live power flow
6. **CRAC / Cooling** — animated HVAC schematic, supply/return temps,
   chilled-water loop, fan speeds
7. **Energy Centre** — energy KPIs, source mix, peak demand, top
   consumers (charts only, no schematic)

Everything else from the mockup or production north star is out of scope
until the corresponding add-on phase begins (see §6).

Rationale for the seven-screen scope is captured in `docs/decisions.md`
entry **D-0001**.

---

## 2. Stack (active)

| Layer        | Technology |
|--------------|------------|
| Frontend     | React 18, TypeScript 5, Vite, Tailwind CSS, TanStack Query, Zustand, React Router, Leaflet, ECharts |
| Backend API  | NestJS (Node 20 LTS, TypeScript) |
| Realtime     | NestJS WebSocket gateway over Socket.IO (in-process, no Redis adapter yet) |
| Auth         | Local JWT, hardcoded users in DB. **No Keycloak / MFA / SSO yet.** |
| OLTP DB      | PostgreSQL 16 |
| Telemetry DB | TimescaleDB extension on the same Postgres |
| Migrations   | Drizzle ORM for tables; raw SQL for one Timescale hypertable |
| Simulator    | Node script in `apps/sim` generating fake meter + sensor values |
| Containers   | Dockerfiles and Docker Compose profiles for API, web, simulator, and DB |
| CI/CD        | GitHub Actions for install, build/typecheck, and migration validation |
| Local dev    | WSL2 Ubuntu 22.04; native Postgres remains supported, Docker Compose is optional |

No new dependencies may be added without an ADR in `docs/adr/`.

---

## 3. Repository Layout

```
bms/
├── AGENTS.md                  ← this file (active)
├── README.md
├── ESKOM_SMOC.html            ← UX reference (do not edit)
├── package.json               ← pnpm workspace root
├── pnpm-workspace.yaml
├── docker-compose.yml         ← Phase 1 local/pilot compose entrypoint
├── .github/
│   └── workflows/             ← GitHub Actions CI
├── apps/
│   ├── web/                   ← React SPA
│   ├── api/                   ← NestJS REST + WebSocket
│   └── sim/                   ← telemetry simulator (Node script)
├── packages/
│   ├── shared/                ← cross-cutting TS types & constants
│   └── db/                    ← Drizzle schema, migrations, seeds
└── docs/
    ├── adr/                   ← Phase 1+ architecture decisions
    ├── AGENTS.production.md   ← future-state rulebook (reference)
    ├── decisions.md           ← lightweight ADR log for prototype
    ├── env-inventory.md       ← committed environment variable inventory
    ├── roadmap.md             ← phase plan (prototype + add-ons)
    └── local-setup.md         ← WSL + Postgres setup steps
```

Do not add top-level folders without updating this section.

---

## 4. Code Rules (lightweight)

### 4.1 TypeScript
- `strict: true`. No `any`. Use `unknown` and narrow.
- Exported functions get a one-line JSDoc.

### 4.2 React
- Functional components only. One component per file.
- Data fetching via TanStack Query hooks in `apps/web/src/api/`.
- UI state via Zustand stores. No Redux.
- Styling via Tailwind utilities. Inline `style` only for dynamic values.

### 4.3 NestJS
- Module-per-domain: `auth`, `assets`, `alarms`, `telemetry`, `audit`.
- Controllers thin → services do work → repositories touch the DB.
- Validate every DTO with Zod. Never trust input.

### 4.4 SQL (Postgres / TimescaleDB)
- Schema-qualified (`bms.assets`, `telemetry.point_values`).
- Snake_case columns. `TIMESTAMPTZ` everywhere.
- Parameterised queries only.
- Migrations are forward-only. Never edit a merged migration.
- Telemetry table is a Timescale hypertable; `chunk_time_interval = 1 day`.

### 4.5 Style hygiene
- File names: `kebab-case` for files, `PascalCase` for React components.
- No abbreviated domain words (`asset`, not `as`; `alarm`, not `alm`).
- Max **1000 lines per file** in the current phase.
- No `console.log` in committed code; use the shared logger (Pino).
- No emoji in code or commits unless explicitly requested.

---

## 5. Visual Reference

`ESKOM_SMOC.html` is the UX spec. Match its look and feel:

- Dark top bar, green nav, left module sidebar, KPI ribbon, dark status bar.
- IBM Plex font family.
- Green accent `#00A651`, status colour palette as defined in the file.

Do **not** copy its string-concatenation render style. Build proper typed
React components in `apps/web/src/components/`.

---

## 6. Out of Scope for the Current Sprint

These are intentionally deferred. Do not implement them yet:

- Multi-tenancy, row-level security
- Keycloak / OIDC / MFA / SSO
- Real protocol adapters (BACnet, Modbus, SNMP, OPC-UA, MQTT)
- EMQX broker
- Redis cache and pub/sub
- MinIO / object storage
- Two-way commanding with approval workflows
- Audit hash-chaining (we keep a simple audit table only)
- Maintenance / work orders / rule-engine UI
- Energy reports (PDF / XLSX)
- Three.js Control Room 3D
- AI Copilot
- NERSA / ISO compliance reports
- Kubernetes production manifests
- Prometheus / Grafana / Loki

Docker Compose, Dockerfiles, and GitHub Actions CI are now in scope for
Phase 1 Sprint A only. When any other item above is needed, follow §10
(Promotion Process).

---

## 7. Definition of Done (Current Sprint)

A task is done when:

1. Native WSL development still works.
2. Compose can start the core app path against Postgres/TimescaleDB.
3. CI installs dependencies and builds/typechecks from a clean checkout.
4. Migration validation runs against a real Postgres/TimescaleDB service.
5. README/local setup are updated for any new env var or command.
6. `docs/adr/` captures non-obvious architecture choices.

---

## 8. Local Dev Setup

Single source of truth lives in `docs/local-setup.md`. Summary:

1. Windows 11 + WSL2 + Ubuntu 22.04.
2. Inside Ubuntu: install Node 20, pnpm 9, Postgres 16, TimescaleDB.
3. Clone repo into the WSL filesystem (not `/mnt/c/...`).
4. `pnpm install`.
5. `pnpm db:migrate && pnpm db:seed`.
6. Three native terminals:
   - `pnpm --filter api dev`
   - `pnpm --filter web dev`
   - `pnpm --filter sim start`
7. Optional Phase 1 compose profiles are documented in `README.md`.

No Keycloak, Redis, broker, or observability stack yet. Just Postgres,
Node, and optional Docker Compose for reproducible development.

---

## 9. AI Agent Operating Rules (Current Sprint)

1. **Read this file and the affected source files before editing.**
2. Read `docs/AGENTS.production.md` for context on where the system is
   heading — but do **not** implement later-phase concerns yet.
3. Match the style of existing modules. If unsure, copy the closest
   pattern.
4. Never add a dependency without an ADR in `docs/adr/`.
5. Never invent file paths or library APIs.
6. Never log secrets, tokens, or full PII payloads.
7. Do not introduce Keycloak, Redis, EMQX, MinIO, or any item from §6
   without a Promotion PR (see §10).
8. Do not bypass the audit middleware.
9. Do not mass-rename or mass-format unrelated code.
10. Update this file only via a PR prefixed `chore(agents): ...`.

---

## 10. Promotion Process (prototype → production rules)

When an add-on phase begins (e.g. "introduce Keycloak", "wire MQTT
ingestion"):

1. Open a PR titled `chore(agents): promote <section> from production`.
2. Copy the relevant section from `docs/AGENTS.production.md` into this
   file (replacing or extending the current rules).
3. Remove the same item from §6 (Out of Scope).
4. Update `docs/roadmap.md` to mark the phase as active.
5. Land the PR before any feature code for that phase is merged.

This keeps the active rules in lockstep with the codebase and ensures AI
agents are never asked to enforce rules that do not yet apply.

---

## 11. Glossary (short)

- **SMOC** — Smart Metering Operating Centre.
- **BMS** — Building Management System.
- **SLD** — Single-Line (electrical) Diagram.
- **CRAC** — Computer Room Air Conditioner.
- **PUE** — Power Usage Effectiveness.

Full glossary lives in `docs/AGENTS.production.md`.

---

## 12. Living Document

This file evolves with the system. Every sprint exit reviews `AGENTS.md`
for accuracy. Every promotion PR updates it.
