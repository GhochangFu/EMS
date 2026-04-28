# AGENTS.md — Eskom SMOC BMS (Part 2 / Phase 1 Complete)

> **Status:** ACTIVE — Phase 1 complete; Phase 2 ready.
> **North star:** see `docs/AGENTS.production.md` for the full production
> rules we will promote from as the system grows.

This file is the rulebook humans and AI agents must follow **right now**.
The seven-screen prototype is complete. Phase 1 Sprint A added
container foundations and CI. Sprint B added Redis-backed Socket.IO
fan-out. Sprint C added Keycloak/OIDC authentication for the web app and
protected API routes. Sprint D added an optional observability baseline
for local/pilot diagnostics. Phase 2 real ingestion is ready next, but
protocol adapters and brokers remain out of scope until that phase is
explicitly promoted.

---

## 1. Goal

The prototype has completed the seven-screen end-to-end pipeline:

`simulated device → Postgres/Timescale → NestJS API → WebSocket → React UI → user`

Phase 1 Sprint D made the pilot stack diagnosable:

1. API and simulator metrics exposed for Prometheus.
2. OpenTelemetry SDK bootstrap in the API.
3. Optional Prometheus, Grafana, Loki, and Promtail compose profile.
4. Basic Grafana dashboard as code.
5. Minimal runbook for checking service health during demos.

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
| Realtime     | NestJS WebSocket gateway over Socket.IO with Redis adapter when `REDIS_URL` is set |
| Auth         | Keycloak/OIDC for pilot compose; local JWT fallback only for native WSL development |
| Observability | Optional Prometheus, Grafana, Loki, Promtail, and OpenTelemetry baseline |
| OLTP DB      | PostgreSQL 16 |
| Telemetry DB | TimescaleDB extension on the same Postgres |
| Migrations   | Drizzle ORM for tables; raw SQL for one Timescale hypertable |
| Simulator    | Node script in `apps/sim` generating fake meter + sensor values |
| Containers   | Dockerfiles and Docker Compose profiles for API, web, simulator, and DB |
| CI/CD        | GitHub Actions for install, build/typecheck, and migration validation |
| Cache / pub-sub | Redis 7 for Socket.IO adapter fan-out |
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
├── infra/
│   ├── keycloak/              ← Phase 1 Sprint C realm export
│   └── observability/         ← Phase 1 Sprint D Prometheus/Grafana/Loki config
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
    ├── observability-runbook.md ← Sprint D local/pilot health checks
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
- MFA / SSO / AD federation
- Real protocol adapters (BACnet, Modbus, SNMP, OPC-UA, MQTT)
- EMQX broker
- MinIO / object storage
- Two-way commanding with approval workflows
- Audit hash-chaining (we keep a simple audit table only)
- Maintenance / work orders / rule-engine UI
- Energy reports (PDF / XLSX)
- Three.js Control Room 3D
- AI Copilot
- NERSA / ISO compliance reports
- Kubernetes production manifests

Docker Compose, Dockerfiles, GitHub Actions CI, Redis-backed Socket.IO
pub/sub, Keycloak/OIDC authentication, and the observability baseline are
now in scope for Phase 1 only. Redis must not be used for unrelated
caching or job queues until a later promotion. Keycloak is limited to
local/pilot OIDC authentication; MFA, SSO federation, and advanced
identity governance remain out of scope. Observability is limited to
optional local/pilot diagnostics. Real protocol adapters and brokers
remain out of scope until Phase 2 is promoted. When any other item above
is needed, follow §10 (Promotion Process).

---

## 7. Definition of Done (Current Sprint)

A task is done when:

1. Native WSL development still works.
2. Compose can start the core app path against Postgres/TimescaleDB.
3. Redis-backed Socket.IO starts when `REDIS_URL` is configured.
4. Missing `REDIS_URL` falls back to in-process Socket.IO for native WSL.
5. Keycloak starts from a committed realm export in compose.
6. Web login uses OIDC Authorization Code + PKCE when OIDC env is enabled.
7. API protected routes accept Keycloak-issued bearer tokens with mapped
   prototype roles.
8. API and simulator expose Prometheus metrics.
9. Optional observability compose profile starts Prometheus, Grafana, Loki,
   and Promtail without being required for the core app.
10. A Grafana dashboard can show API health, request latency, websocket
    activity, alarm volume, and simulator ingest rate.
11. A local-auth fallback remains documented for native WSL development.
12. CI installs dependencies and builds/typechecks from a clean checkout.
13. Migration validation runs against a real Postgres/TimescaleDB service.
14. README/local setup are updated for any new env var or command.
15. `docs/adr/` captures non-obvious architecture choices.

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
7. Optional Phase 1 compose profiles, including Keycloak and
   observability, are documented in `README.md`.

No protocol broker yet. Just Postgres, Redis for realtime fan-out,
Keycloak for local/pilot OIDC, optional observability services, Node, and
Docker Compose for reproducible development.

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
7. Do not introduce EMQX, MinIO, or any item from §6 without a Promotion
   PR (see §10). Redis is only approved for Socket.IO fan-out; Keycloak is
   only approved for local/pilot OIDC; observability is only approved for
   optional local/pilot diagnostics.
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
