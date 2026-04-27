# Roadmap — Eskom SMOC BMS

> **Active phase:** Prototype (Sprint 8).
> **Source of truth for rules:** `AGENTS.md` (active), `docs/AGENTS.production.md` (target).

This roadmap has two parts:

1. **Prototype phase** — week-by-week plan to ship the seven-screen
   demo on the local laptop.
2. **Add-on phases** — numbered post-prototype phases. Each one
   graduates a chunk of `AGENTS.md` §6 (Out of Scope) into the active
   rulebook via the Promotion Process in `AGENTS.md` §10.

Calendar weeks are nominal. Schedule is open per `D-0001`; quality
beats the calendar.

---

## Part 1 — Prototype phase (~7–8 weeks)

End goal: a credible, demo-able BMS running entirely on the developer's
laptop. Pipeline:

`apps/sim → Postgres+Timescale → apps/api (NestJS) → WebSocket → apps/web (React) → user`

### Sprint 0 — Documentation & decisions (this week)
- **Status:** complete
- **Deliverables**
  - `AGENTS.md` (active rulebook) ✅
  - `docs/AGENTS.production.md` (north star) ✅
  - `docs/decisions.md` opened with `D-0001` ✅
  - `docs/roadmap.md` (this file) ✅
  - `docs/local-setup.md` ✅
  - `README.md` at repo root ✅
- **Exit criteria:** local laptop ready to run Sprint 1 (Postgres up,
  pnpm + Node installed, repo cloned into WSL).

### Sprint 1 — Foundation (Week 1)
- **Status:** complete
- **Goal:** monorepo skeleton + AppShell + login working end-to-end.
- **Deliverables**
  - pnpm monorepo: `apps/web`, `apps/api`, `apps/sim`,
    `packages/shared`, `packages/db`.
  - Postgres 16 + TimescaleDB running locally; first Drizzle migration
    creates `bms.users`, `bms.assets`, `bms.alarms`,
    `telemetry.point_values` (hypertable, 1-day chunk).
  - Seed: 1 admin user, ~6 sample assets, a few historical alarms.
  - NestJS API: `/health`, `/api/v1/auth/login` (JWT, bcrypt, hardcoded
    user table).
  - React app shell matching the mockup chrome — dark top bar, green
    nav, left module sidebar, KPI ribbon placeholder, dark status bar.
  - Login screen → stores JWT → routes to empty dashboard.
- **Exit criteria:** user can log in and see the empty AppShell with
  their name and role in the top bar.

### Sprint 2 — Telemetry pipeline (Week 2)
- **Status:** complete
- **Goal:** prove the live data path before any feature screen is
  built on top of it.
- **Deliverables**
  - `apps/sim` Node script generating electrical telemetry for ~6
    assets: voltage, current, kW, kVAR, power factor, breaker states.
    Configurable rate (default 1 Hz).
  - API: `GET /api/v1/assets`, `GET /api/v1/telemetry/points/:id/recent?window=15m`.
  - NestJS WebSocket gateway: `/ws/telemetry` namespace, broadcasts
    new readings keyed by asset/point.
  - React hook `useTelemetryLive(pointId)` (TanStack Query + Socket.IO
    listener).
  - Smoke test: simulator running → values visible in browser dev
    console via the hook.
- **Exit criteria:** live kW value for one asset ticks in the browser
  console, sourced from the simulator via DB → API → WS.

### Sprint 3 — Executive Dashboard (Week 3)
- **Status:** complete
- **Goal:** first user-facing screen, fully live.
- **Deliverables**
  - KPI tile row: total kW, sites online, alarms open, PUE estimate.
  - One ECharts trend chart bound to the live telemetry hook.
  - Layout matches mockup (`R.dash`).
  - Loading, empty, and error states for each tile.
- **Exit criteria:** numbers tick in real time; pulling the simulator
  out makes tiles go to "stale" within 10 s.

### Sprint 4 — Alarm Centre (Week 4)
- **Status:** complete
- **Goal:** live alarms with acknowledgement.
- **Deliverables**
  - Threshold engine in API: simulator values exceeding limits insert
    rows into `bms.alarms`.
  - REST: `GET /api/v1/alarms` (cursor pagination),
    `POST /api/v1/alarms/:id/ack` (requires reason).
  - WebSocket: `/ws/alarms` for new + state changes.
  - UI: live alarm table with severity colours, ack button, reason
    modal, audit-light record (who/when/why) into `bms.audit_log`.
- **Exit criteria:** simulator fault → alarm row appears in UI within
  2 s without refresh; ack persists and updates state for all clients.

### Sprint 5 — World Map (Week 5)
- **Status:** complete
- **Goal:** geographic view of Eskom stations and SMOC campuses.
- **Deliverables**
  - Leaflet, dark tile theme, Eskom station + SMOC campus markers
    sourced from `ESKOM_STATIONS` data shape (re-modelled into Postgres).
  - Marker colour reflects live aggregate status (sum of asset alarms
    + comm health) per site.
  - Click marker → popover with KPIs + drilldown link.
- **Exit criteria:** map shows live status; pulling a simulator asset
  flips its parent site to a degraded colour live.

### Sprint 6 — Electrical SLD (Week 6)
- **Status:** complete
- **Goal:** animated single-line diagram, telemetry-bound.
- **Deliverables**
  - Hand-laid SVG schematic (transformer, main breaker, busbars,
    feeders) matching mockup `R.sld`.
  - Component-to-point binding layer: each SVG node subscribes to its
    telemetry point.
  - Animated power-flow lines (CSS dash animation, speed scales with kW).
  - Status colours: running / fault / offline.
  - Click a component → side drawer with read-only detail. **No
    commanding** — that ships in production Phase 4.
  - Reusable `<LiveSvgComponent>` pattern documented in
    `apps/web/src/components/live-svg/README.md`.
- **Exit criteria:** SLD looks like the mockup, animates with live
  data, and the component pattern is reusable for CRAC.

### Sprint 7 — CRAC / Cooling (Week 7)
- **Status:** complete
- **Goal:** second domain proves the pipeline generalises.
- **Deliverables**
  - Simulator extended with HVAC domain: 4–6 CRAC units, supply &
    return air temps, fan RPM, chilled-water flow & temps.
  - New telemetry points alongside the electrical points; same
    `point_values` hypertable.
  - SVG schematic for the cooling loop (mockup `R.crac`).
  - Reuse `<LiveSvgComponent>` from Sprint 6.
- **Exit criteria:** CRAC schematic animates with live HVAC telemetry;
  no architectural changes to API, only new data points.

### Sprint 8 — Energy Centre + polish (Week 8)
- **Status:** complete
- **Goal:** breadth of narrative + demo readiness.
- **Deliverables**
  - Energy Centre dashboard (mockup `R.en`), pure ECharts:
    - Tile row: total kWh, peak demand, PUE, indicative cost.
    - Stacked area: source mix (grid / solar / DG split).
    - Bar: top 10 consumers.
  - Aggregations computed in API from the same electrical telemetry
    (no new simulator domain needed).
  - Polish pass: navigation, status bar accuracy, all loading / empty /
    error states, demo script in `docs/demo-script.md`.
  - Dry-run demo with a stakeholder.
- **Exit criteria:** end-to-end demo runs for ~15 minutes without a
  manual reload, simulator restart, or visible error.

---

## Part 2 — Add-on phases (post-prototype)

Each phase is a separate decision. None of them auto-trigger. Each
graduates the listed items out of `AGENTS.md` §6 via the Promotion
Process (`AGENTS.md` §10).

### Phase 1 — Pilot-ready hardening (~3 weeks)
- **Status:** pending
- **Graduates:** Docker / Kubernetes / CI/CD, Prometheus / Grafana /
  Loki, Keycloak / OIDC / MFA / SSO, Redis cache & pub/sub.
- **Goal:** deployable to a single VM for an internal pilot.
- **Highlights:** Dockerfiles per app, `docker-compose.yml`, GitHub
  Actions CI, Keycloak realm + OIDC integration replacing local JWT,
  Redis adapter on Socket.IO, OpenTelemetry SDK in every service,
  Prometheus + Grafana + Loki stack, basic SLO dashboards.

### Phase 2 — Real ingestion (~4 weeks)
- **Status:** pending
- **Graduates:** Real protocol adapters (BACnet, Modbus, SNMP, OPC-UA,
  REST poller), EMQX broker, MQTT subscriber.
- **Goal:** replace the simulator with at least one real device per
  protocol.
- **Highlights:** EMQX with TLS + ACL, `apps/ingest/mqtt` first, then
  one adapter per protocol; gateway model + `bms.gateways` filled in;
  buffer + backpressure rules from `docs/AGENTS.production.md` §7.

### Phase 3 — Multi-tenancy (~2 weeks)
- **Status:** pending
- **Graduates:** Multi-tenancy, row-level security.
- **Highlights:** `bms.tenants`, RLS on every cross-tenant table,
  tenant scoping in JWT claims, tenant switcher in UI, per-tenant
  retention overrides on hypertables.

### Phase 4 — Two-way commanding & audit hardening (~3 weeks)
- **Status:** pending
- **Graduates:** Two-way commanding with approval workflow, audit
  hash-chaining.
- **Highlights:** `bms.commands` + `bms.command_results`, server-side
  safety gate, dual-approval flag, command audit screen, hash-chained
  `bms.audit_log` (nightly job), `Idempotency-Key` enforcement,
  end-to-end command tracing. Highest-risk surface — heaviest test
  coverage (95%).

### Phase 5 — Operations modules (~3 weeks)
- **Status:** pending
- **Graduates:** Maintenance / work orders, rule-engine UI, energy
  reports (PDF/XLSX), MinIO / object storage.
- **Highlights:** `bms.work_orders` + tasks, `bms.automation_rules` +
  rule executions, MinIO bucket for generated reports, headless PDF
  rendering for energy reports, scheduled report runs.

### Phase 6 — Premium visuals (~3 weeks)
- **Status:** pending
- **Graduates:** Three.js Control Room 3D, AI Copilot.
- **Highlights:** GLB/GLTF model of the SMOC control room, live data
  bound to 3D screens; Copilot service wired to alarms, assets, and
  energy data via tool-calling.

### Phase 7 — Compliance (~2 weeks)
- **Status:** pending
- **Graduates:** NERSA / ISO 50001 / Eskom internal audit reports.
- **Highlights:** report templates, retention policies enforced at the
  hypertable level, signed audit exports, ASVS Level 3 review of the
  command and audit modules.

---

## Crosswalk — `AGENTS.md` §6 ↔ phase

| §6 item | Graduates in |
|---------|--------------|
| Multi-tenancy, RLS | Phase 3 |
| Keycloak / OIDC / MFA / SSO | Phase 1 |
| Real protocol adapters (BACnet, Modbus, SNMP, OPC-UA, MQTT) | Phase 2 |
| EMQX broker | Phase 2 |
| Redis cache and pub/sub | Phase 1 |
| MinIO / object storage | Phase 5 |
| Two-way commanding with approval workflow | Phase 4 |
| Audit hash-chaining | Phase 4 |
| Maintenance / work orders / rule-engine UI | Phase 5 |
| Energy reports (PDF/XLSX) | Phase 5 |
| Three.js Control Room 3D | Phase 6 |
| AI Copilot | Phase 6 |
| NERSA / ISO compliance reports | Phase 7 |
| Docker, Kubernetes, CI/CD, Prometheus / Grafana / Loki | Phase 1 |

When a phase opens, the corresponding row(s) above flip to "in
progress" and the matching items move out of `AGENTS.md` §6 into the
active rules.
