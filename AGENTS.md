# AGENTS.md — TRINETRA BMS (formerly Eskom SMOC) (Part 2 / Phase 5 Location and Access + Onboarding & PHE Ingest)

> **Status:** ACTIVE — Phase 5 Sprint J/K/L/M/N Location and Access
> hardening is open. In addition, the hierarchical master-data admin, the
> scoped AI onboarding wizard, and the PHE MQTT real-ingestion pilot are
> merged to `main` (ADR 0007–0012) and are now in scope. General site-wide
> AI copilot, EMQX, and multi-protocol adapters remain deferred.
> **Product brand:** TRINETRA (earlier: Eskom SMOC / InfraPulse). Powered by
> Euphoria Infotech India Limited.
> **North star:** see `docs/AGENTS.production.md` for the full production
> rules we will promote from as the system grows.
> **Recent scope changes:** see `docs/adr/0007`–`0012` and `git log`; those
> ADRs promoted work that post-dates parts of §3 and §6 below, so where this
> file's status/scope conflicts with a newer ADR, the ADR is authoritative.

This file is the rulebook humans and AI agents must follow **right now**.
The seven-screen prototype is complete. Phase 1 Sprint A added
container foundations and CI. Sprint B added Redis-backed Socket.IO
fan-out. Sprint C added Keycloak/OIDC authentication for the web app and
protected API routes. Sprint D added an optional observability baseline
for local/pilot diagnostics. Phase 2 Sprint 0 selected Path B because no
real device/source information is available yet. Real protocol adapters
and brokers remain out of scope until a future Phase 2 implementation
sprint promotes one confirmed source/protocol. Phase 5 Sprint A added the
work order foundation: schema, seed/demo data, and protected API endpoints
for listing, creating, and transitioning work orders. Phase 5 Sprint B
added the web UI for operators to create, track, reorder, and close work
orders. Phase 5 Sprint C added maintenance schedule templates, recurring
schedules, asset-linked history, and conversion into work orders from a
dedicated Schedule Centre companion screen. Phase 5 Sprint D added the
basic rule engine: simple threshold/time-window rules, execution history,
and enable/disable UI without a complex visual builder. Phase 5 Sprint E
added Energy report previews plus CSV export only. Phase 5 Sprint F report
storage is skipped for now and can be revisited later. Phase 5 Sprint G
added the first 2D IBMS Control Room foundation screens: CR Main Dashboard,
CR Electrical SLD, and CR IT & Rack Load. Phase 5 Sprint H added a guided
IF/THEN visual rule builder for the existing simple
threshold/time-window rule model. The Phase 5 Control Room extension added
the previously deferred UPS Monitoring, Battery Bank, HVAC System,
Environment, and CR Dashboard integration screens before Sprint I.
Phase 5 Sprint I aligned completed pages to the `ESKOM_SMOC.html` shell,
headers, cards, status pills, disabled command affordances, and demo flow
without changing backend contracts. The later Location and Access work
introduced canonical locations, scoped users, location dashboards,
asset-group UI guards, focused simulator settings, telemetry dashboard
indexing, and shell/sidebar refinements. Phase 5 Sprint J/K/L/M/N is now
open for focused Location and Access hardening, demo inventory cleanup,
clean migration/seed verification, Keycloak checks, automated access tests,
and role-walkthrough hardening.

Beyond the Location and Access sprint, three feature streams have since been
merged to `main` and are in scope. The **hierarchical master-data admin**
(ADR 0008–0010) introduced the `Organization → Location → RTU → Asset → Point
Key` catalog with scoped `admin`, `organization_admin`, and `location_admin`
roles and CRUD screens under `/admin/*`. The **scoped AI onboarding wizard**
(ADR 0011) adds an admin-only conversational ingestion flow backed by OpenAI
chat completions with a deterministic rule-based fallback. The **PHE MQTT
real-ingestion pilot** (ADR 0007, 0012) added `apps/ingest`, a single-RTU MQTT
TLS subscriber for West Bengal PHE pump houses, plus AES-256-GCM encrypted RTU
connection credentials. These promotions are partial and scoped: general
site-wide AI copilot, EMQX, and non-MQTT protocol adapters remain out of scope.

---

## 1. Goal

The prototype has completed the seven-screen end-to-end pipeline:

`simulated device → Postgres/Timescale → NestJS API → WebSocket → React UI → user`

The current planning direction is:

1. Keep the simulator as the active source until real access is available.
2. Treat Phase 5 Sprint A work order foundation as complete.
3. Treat Phase 5 Sprint B work order UI as complete.
4. Treat Phase 5 Sprint C Maintenance Schedule Centre as complete.
5. Treat Phase 5 Sprint D basic rule engine as complete.
6. Treat Phase 5 Sprint E Energy report previews and CSV export as
   complete.
7. Skip Phase 5 Sprint F report storage for now; revisit only if persisted
   report files/history are needed.
8. Treat Phase 5 Sprint G Control Room foundation as complete: 2D React
   screens backed by seeded assets, simulator telemetry, and rule-driven
   status where current data exists.
9. Treat Phase 5 Sprint H guided visual rule builder as complete without
   two-way commanding, free-form node graphs, schedulers, or real-ingestion
   rules.
10. Treat the Phase 5 Control Room extension as complete for CR UPS
   Monitoring, Battery Bank, HVAC System, Environment, and CR Dashboard
   integration.
11. Treat Phase 5 Sprint I completed-page UI/UX alignment as complete.
12. Treat Phase 5 Sprint J/K/L/M/N Location and Access hardening as open:
   keep the implemented migrations, scoped API/WebSocket reads, scoped UI
   guards, location dashboard work, simulator focus settings, telemetry
   index, and collapsible shell, and do not call the sprint complete until
   a clean migration/seed run, Keycloak realm verification, automated access
   tests, and page-wise role walkthrough are done.
13. Defer MinIO/object storage until persisted report files are actually
   needed.
14. Plan Phase 6 as Three.js Control Room only.
15. Keep general AI Copilot / chatbot out of scope for site navigation. The
   **scoped AI onboarding wizard** (admin ingestion only, ADR 0011) is merged
   to `main` and in scope.
16. Treat the **hierarchical master-data admin** (ADR 0008–0010) as in scope:
   Organization → Location → RTU → Asset → Point Key CRUD under `/admin/*`
   with `admin`, `organization_admin`, and `location_admin` roles. Org-level
   read RBAC and hard deletes remain out of scope (deactivate/reactivate only).
17. Treat the **PHE MQTT real-ingestion pilot** (ADR 0007, 0012) as in scope
   for the single pilot RTU only via `apps/ingest`. EMQX and non-MQTT protocol
   adapters remain deferred; the simulator stays the source for all other
   assets.

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
| Real ingestion | `apps/ingest` MQTT TLS subscriber for the PHE pilot; writes `telemetry.point_values` and `pg_notify('bms_telemetry', …)` like the simulator (ADR 0007). One pilot RTU only; no EMQX |
| Master data  | Organization → Location → RTU → Asset → Point-key catalog + `/admin/*` CRUD with `admin`/`organization_admin`/`location_admin` roles (ADR 0008–0010) |
| AI onboarding | Scoped admin ingestion wizard using OpenAI chat completions with structured JSON, and a deterministic rule-based fallback when `OPENAI_API_KEY` is unset (ADR 0011) |
| Secrets      | AES-256-GCM encrypted RTU connection credentials via `CREDENTIAL_ENCRYPTION_KEY`; never returned decrypted by the API (ADR 0012) |
| Operations   | Work orders, maintenance schedules, basic rules, Energy CSV reports, completed 2D Control Room foundation screens, completed guided rule builder, and completed Control Room extension |
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
│   ├── web/                   ← React SPA (incl. /admin master-data + onboarding wizard)
│   ├── api/                   ← NestJS REST + WebSocket (incl. src/admin, src/security)
│   ├── sim/                   ← telemetry simulator (Node script)
│   └── ingest/                ← PHE MQTT TLS subscriber (ADR 0007), one pilot RTU
├── packages/
│   ├── shared/                ← cross-cutting TS types & constants
│   └── db/                    ← Drizzle schema, migrations, seeds (incl. phe-catalog.json)
└── docs/
    ├── adr/                   ← Phase 1+ architecture decisions
    ├── AGENTS.production.md   ← future-state rulebook (reference)
    ├── decisions.md           ← lightweight ADR log for prototype
    ├── env-inventory.md       ← committed environment variable inventory
    ├── observability-runbook.md ← Sprint D local/pilot health checks
    ├── phase-2-ingestion-readiness.md ← Sprint 0 source readiness workbook
    ├── roadmap.md             ← phase plan (prototype + add-ons)
    ├── windows-vm-docker-deploy.md ← Windows VM + Docker Desktop pilot
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

`ESKOM_SMOC.html` is the UX spec. Match it as strictly as the current
React architecture allows:

- Dark top bar, green nav, left module sidebar, KPI ribbon, dark status bar.
- IBM Plex font family.
- Green accent `#00A651`, status colour palette as defined in the file.
- For every new module, identify the closest original route / renderer
  before implementation (for example `R.mt` for Maintenance Kanban · Work
  Orders, `R.rl` for Rule Engine, `R.rp` for Reports).
- Match the original screen's information architecture first: sidebar
  section, page title, actions, card/table/Kanban layout, status pills,
  counts, and empty/loading/error states.
- If backend scope is smaller than the mockup, keep the same layout
  language and clearly omit only the unavailable controls/data.

Do **not** copy its string-concatenation render style. Build proper typed
React components in `apps/web/src/components/`.

Phase 5 Sprint I completed the dedicated UI/UX revisit pass. Future
completed pages should continue using the shared shell, page header,
card, status pill, and disabled command affordance language introduced in
that sprint. The current shell also includes a collapsible left module
sidebar; keep scoped visibility and active-state behaviour consistent with
`AppShell` when adding new navigation items.

---

## 6. Out of Scope for the Current Sprint

These are intentionally deferred. Do not implement them yet:

- Multi-tenancy, row-level security (org-level read RBAC still deferred)
- MFA / SSO / AD federation
- Real protocol adapters for BACnet, Modbus, SNMP, OPC-UA (the **MQTT PHE
  ingest pilot is promoted for one RTU** via ADR 0007; all other protocols
  remain out of scope)
- EMQX broker (PHE pilot connects directly over MQTT TLS; no broker)
- MinIO / object storage
- Two-way commanding with approval workflows
- Audit hash-chaining (we keep a simple audit table only)
- Energy reports (PDF / XLSX)
- Complex drag-and-drop node graph rule builders
- Three.js Control Room 3D
- General site-wide AI Copilot / chatbot (the **scoped admin onboarding
  wizard is promoted** via ADR 0011; general copilot remains out of scope)
- NERSA / ISO compliance reports
- Kubernetes production manifests

Docker Compose, Dockerfiles, GitHub Actions CI, Redis-backed Socket.IO
pub/sub, Keycloak/OIDC authentication, and the observability baseline are
now in scope for Phase 1 only. Phase 2 Sprint 0 promoted documentation
and readiness analysis only, then selected Path B because real access is
not available. Redis must not be used for unrelated caching or job queues
until a later promotion. Keycloak is limited to local/pilot OIDC
authentication; MFA, SSO federation, and advanced identity governance
remain out of scope. Observability is limited to optional local/pilot
diagnostics. Real protocol adapters and brokers remain out of scope until
a later Phase 2 implementation sprint selects and promotes a specific
source/protocol. Work-order UI is complete for Phase 5 Sprint B. Phase 5
Sprint C Maintenance Schedule Centre is complete. Phase 5 Sprint D basic
rule-engine UI is complete for simple threshold/time-window rules,
enable/disable controls, manual evaluation, and execution history. Phase 5
Sprint E Energy report preview and CSV export are complete. Phase 5 Sprint
G 2D Control Room foundation is complete for CR Main Dashboard, CR
Electrical SLD, and CR IT & Rack Load. Phase 5 Sprint H guided visual rule
builder is complete for simple threshold/time-window rule creation, draft
preview, publish, archive, duplicate, enable/disable, preview, and audit
history. The Phase 5 Control Room extension is complete for CR UPS
Monitoring, Battery Bank, HVAC System, Environment, and Dashboard
integration only. Phase 5 Sprint I UI/UX alignment is complete for all
completed pages and did not add backend contracts. Phase 5 Sprint J/K/L/M/N
Location and Access hardening is open: canonical locations, scoped users,
scoped REST/WebSocket reads, live-location dashboard markers, schematic
guards, Control Room asset-group UI gating, simulator focus settings, and
the telemetry dashboard index may remain, but the sprint is not complete
until the hardening checklist in `docs/roadmap.md` is finished. Report PDF/XLSX output,
persisted report storage, CR
Security, CR Alarm Management, CR Trends, Phase 6 3D, two-way commands,
setpoint changes, manual bypass, battery tests, equalize charge, HVAC
force-changeover, sensor calibration/test execution, real-ingestion rules,
scheduler/job queues, and complex node graph builders remain out of scope
until their specific sprint is promoted. General site-wide AI Copilot /
chatbot remains deferred, but the scoped admin onboarding wizard (ADR 0011),
the hierarchical master-data admin (ADR 0008–0010), and the single-RTU PHE
MQTT ingest pilot (ADR 0007, 0012) are promoted and in scope. When any other
item above is needed, follow §10 (Promotion Process).

---

## 7. Definition of Done (Phase 5 Sprint I)

Phase 5 Sprint I is done:

1. Native WSL development and the Phase 1 compose path remain unchanged.
2. `AppShell` uses the completed mockup chrome: dark top bar, green route
   nav, grouped module sidebar, KPI ribbon, and dark status bar.
3. Core prototype pages use consistent headers, KPI/card framing, status
   pills, tables, loading/empty/error states, and route labels.
4. Operations pages for work orders, schedules, rules, and reports align
   with `R.mt`, `R.rl`, and `R.rp` without changing API payloads.
5. Completed Control Room routes align with `R.crOv`, `R.crSld`,
   `R.crIT`, `R.crUps`, `R.crBat`, `R.crHvac`, and `R.crEnv`, including
   `/cr-ups` for CR UPS Monitoring and `/cr-battery` for CR Battery Bank.
6. Disabled/non-commanding controls stay visibly disabled for commands
   that remain out of scope.
7. `docs/demo-script.md` reflects the completed shell, Operations, and
   Control Room demo flow.
8. `pnpm --filter @bms/shared build`, `pnpm --filter web smoke:cr`,
   `pnpm --filter web build`, `pnpm --filter @bms/db build`,
   `pnpm --filter api build`, and `node --check apps/sim/src/index.js`
   pass.

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
   observability, are documented in `README.md`. Windows VM Docker-only
   deployment steps live in `docs/windows-vm-docker-deploy.md`.

No protocol broker yet. Just Postgres, Redis for realtime fan-out,
Keycloak for local/pilot OIDC, optional observability services, Node, and
Docker Compose for reproducible development. Phase 2 remains paused until
real source access exists. Phase 5 Sprint A used the existing API and
database stack only; Sprint B added the Maintenance Kanban UI and
`sort_order` persistence for drag/drop. Sprint C added the Maintenance
Schedule Centre, schedule metadata, history, and work-order conversion.
Phase 5 Sprint J/K/L/M/N Location and Access hardening is open; use
`docs/roadmap.md` as the source for its hardening checklist before adding
new scope-sensitive features.

---

## 9. AI Agent Operating Rules (Current Sprint)

1. **Read this file and the affected source files before editing.**
2. Read `docs/AGENTS.production.md` for context on where the system is
   heading — but do **not** implement later-phase concerns yet.
3. Match the style of existing modules and the closest matching
   `ESKOM_SMOC.html` screen. If these conflict, preserve React/codebase
   architecture but prefer the mockup's user-facing layout and labels.
4. Never add a dependency without an ADR in `docs/adr/`.
5. Never invent file paths or library APIs.
6. Never log secrets, tokens, or full PII payloads.
7. Do not introduce EMQX, MinIO, or any item from §6 without a Promotion
   PR (see §10). Redis is only approved for Socket.IO fan-out; Keycloak is
   only approved for local/pilot OIDC; observability is only approved for
   optional local/pilot diagnostics. Phase 2 may document real-ingestion
   candidates, but it must not implement adapters or brokers until real
   access exists. Phase 5 Sprint A is limited to work order foundation.
   Later Phase 5 and Phase 6 feature work requires sprint promotion before
   implementation.
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

- **SMOC** — Smart Metering Operating Centre (RSMOC / CSMOC: regional /
  central variants used in seeded location names).
- **BMS** — Building Management System.
- **SLD** — Single-Line (electrical) Diagram.
- **CRAC** — Computer Room Air Conditioner.
- **PUE** — Power Usage Effectiveness.
- **RTU** — Remote Terminal Unit; ingestion source under a location
  (`bms.rtus`). PHE RTUs are physical; Eskom RTUs are synthetic per-domain.
- **PHE / PHEWB** — West Bengal Public Health Engineering; the real MQTT
  ingest pilot source (pump houses via ThinkIoT).

Full glossary lives in `docs/AGENTS.production.md`.

---

## 12. Living Document

This file evolves with the system. Every sprint exit reviews `AGENTS.md`
for accuracy. Every promotion PR updates it.
