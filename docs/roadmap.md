# Roadmap — TRINETRA BMS (Ion Exchange Enterprise EMS line)

> **Product line:** TRINETRA for Ion Exchange (India) Ltd. per ADR 0013;
> phases below predate the fork and keep their original Eskom-era names.
> **Active phase:** Part 2 / Phase 5 Sprint J/K/L/M/N — Location and
> Access hardening is open.
> **Pending scope:** [`BACKLOG.md`](./BACKLOG.md) (single managed backlog).
> **Source of truth for rules:** `AGENTS.md` (active), `docs/AGENTS.production.md` (target).

This roadmap has two parts:

1. **Prototype phase** — week-by-week plan to ship the seven-screen
   demo on the local laptop.
2. **Add-on phases** — numbered post-prototype phases. Each one
   graduates a chunk of `AGENTS.md` §6 (Out of Scope) into the active
   rulebook via the Promotion Process in `AGENTS.md` §10.

Calendar weeks are nominal. Schedule is open per `D-0001`; quality
beats the calendar.

UI rule for all remaining module work: each module must map to the
closest route / renderer in `ESKOM_SMOC.html` and match that UX as
strictly as the active React architecture and available data allow.
The promoted Control Room extension and the dedicated completed-page
UI/UX revisit pass are complete. Future completed pages should continue
using the aligned shell, page header, card, table, status, and disabled
command patterns.

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
- **Status:** complete
- **Graduates:** Docker Compose / CI/CD, Prometheus / Grafana / Loki,
  Keycloak / OIDC, Redis pub/sub for Socket.IO fan-out.
- **Goal:** deployable to a single VM for an internal pilot.
- **Highlights:** Dockerfiles per app, `docker-compose.yml`, GitHub
  Actions CI, Keycloak realm + OIDC integration replacing local JWT,
  Redis adapter on Socket.IO, OpenTelemetry SDK in every service,
  Prometheus + Grafana + Loki stack, basic SLO dashboards.
- **Development note:** laptop development remains supported. Heavy
  services should be run through compose profiles or on a small remote
  dev VM so an 8 GB development laptop does not need to keep the full
  pilot stack running at all times.

#### Phase 1 Sprint A — Container foundation and CI
- **Status:** complete
- **Goal:** make the prototype reproducible outside the current native
  WSL setup.
- **Deliverables**
  - Dockerfiles for `apps/api`, `apps/web`, and `apps/sim`.
  - `docker-compose.yml` with profiles for minimum local development,
    pilot-like local stack, and optional support services.
  - Environment variable inventory for API, web, database, and
    simulator configuration.
  - GitHub Actions workflow for install, typecheck, lint/build, and
    basic migration validation.
  - README or local setup updates for compose-based development and
    single-VM pilot startup.
- **Exit criteria:** a fresh machine can start the core app through
  compose, and CI proves the repo still builds from a clean checkout.

#### Phase 1 Sprint B — Redis-backed realtime
- **Status:** complete
- **Goal:** prepare realtime for more than one API process.
- **Deliverables**
  - Redis service added to compose.
  - Socket.IO Redis adapter wired into the telemetry and alarm gateways.
  - Configuration for Redis URL, reconnect behaviour, and local fallback
    expectations.
  - Smoke test or manual test script showing realtime broadcasts still
    reach clients when more than one API instance is running.
- **Exit criteria:** telemetry and alarm events still update the UI when
  the API is scaled beyond one process in the pilot-like compose profile.

#### Phase 1 Sprint C — Keycloak / OIDC authentication
- **Status:** complete
- **Goal:** replace prototype local JWT login with pilot-ready identity.
- **Deliverables**
  - Keycloak service and realm export for local/pilot development.
  - API JWT validation against Keycloak-issued tokens.
  - Web login flow updated to OIDC while preserving the existing app
    shell and route guards.
  - Role mapping for the current prototype roles.
  - Migration notes for retiring or bypassing the prototype local auth
    path.
- **Exit criteria:** a user can log in through Keycloak, open the app,
  and call protected API routes with the expected role claims.

#### Phase 1 Sprint D — Observability baseline
- **Status:** complete
- **Goal:** make the pilot stack diagnosable before real users touch it.
- **Deliverables**
  - OpenTelemetry SDK added to API and other long-running Node services.
  - Prometheus, Grafana, and Loki compose services behind an optional
    observability profile.
  - Structured logs routed to Loki.
  - Basic dashboards for API health, request latency, websocket activity,
    alarm volume, and telemetry ingest rate.
  - Minimal runbook for checking service health during a demo or pilot.
- **Exit criteria:** a developer can start the observability profile and
  use Grafana to confirm the API, websocket, and simulator are healthy.

### Phase 2 — Real ingestion (~4 weeks)
- **Status:** paused after Sprint 0 — Path B selected for now
- **Graduates:** Real protocol adapters (BACnet, Modbus, SNMP, OPC-UA,
  REST poller), EMQX broker, MQTT subscriber.
- **Goal:** replace the simulator with at least one real device per
  protocol.
- **Highlights:** EMQX with TLS + ACL, `apps/ingest/mqtt` first, then
  one adapter per protocol; gateway model + `bms.gateways` filled in;
  buffer + backpressure rules from `docs/AGENTS.production.md` §7.

#### Phase 2 Sprint 0 — Real ingestion readiness
- **Status:** complete — Path B selected for now
- **Goal:** prepare for real ingestion without adding protocol adapters,
  brokers, or live-device dependencies before access is confirmed.
- **Outcome:** no real device, gateway, broker, API, file export, protocol
  details, credentials, network route, or sample payload/register/object
  list is available yet. Current simulator-to-telemetry baseline,
  point-key model, mapping questions, and source-health targets are
  documented in `docs/phase-2-ingestion-readiness.md`. Phase 2
  implementation is paused until real access exists.
- **Deliverables**
  - Candidate data source inventory covering REST, MQTT, BACnet/IP,
    Modbus TCP, SNMP, OPC-UA, and CSV/manual export fallbacks.
  - Readiness checklist for each candidate: host/IP, network path,
    credentials, protocol details, sample payload/register/object list,
    polling/message rate, point names, units, and security constraints.
  - Mapping plan from external gateway/device/point identifiers to the
    current `bms.assets` and `telemetry.point_values` model.
  - Source-health and stale-data rules for future ingestion services.
  - Decision record for the first Phase 2 implementation path:
    **Path A** when real access exists, or **Path B** when only contract
    and mock-gateway work is possible.
- **Non-goals**
  - No EMQX broker.
  - No BACnet, Modbus, SNMP, OPC-UA, MQTT, or REST adapter code.
  - No schema migration unless the readiness analysis proves it is needed
    before Sprint 1.
- **Decision:** Path B selected. Do not add EMQX, protocol adapters, or
  live-device dependencies. Resume Phase 2 implementation only when a
  reachable source, credentials, sample payload/register/object list, and
  source owner are confirmed.

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
- **Status:** Sprint J/K/L/M/N Location and Access hardening open
- **Graduates:** Maintenance / work orders, basic rule-engine UI, energy
  reports. MinIO / object storage graduates only when report files need
  persisted storage.
- **Goal:** add operational workflows on top of existing assets, alarms,
  simulator telemetry, and Energy Centre data while real ingestion remains
  paused.
- **Highlights:** work orders linked to alarms/assets, maintenance tasks,
  simple rules and execution history, energy report previews and exports,
  optional stored report history.
- **UX source:** `ESKOM_SMOC.html` Operations sidebar. Work orders map to
  `R.mt` ("Maintenance Kanban · Work Orders"). The Schedule Centre is a
  companion management screen in the same Maintenance domain so the Kanban
  remains work-order focused. Rules map to `R.rl`, and reports map to
  `R.rp`.

#### Phase 5 Sprint A — Work order foundation
- **Status:** complete
- **Goal:** create the operational backbone for alarm-driven and
  asset-driven work.
- **Deliverables**
  - `bms.work_orders` and supporting task/status schema.
  - Work order statuses: open, assigned, in progress, resolved, closed.
  - Priority/severity and links to assets and alarms.
  - API endpoints for list, create, update status, and close.
  - Seed/demo data.
- **Exit criteria:** complete — live Compose migration/seed, API route
  mapping, and authenticated create/status/close smoke passed.

#### Phase 5 Sprint B — Work order UI
- **Status:** complete
- **Goal:** make work orders usable from the web app while matching
  `ESKOM_SMOC.html` Operations → Maintenance (`R.mt`) as closely as the
  Sprint A API allows.
- **Deliverables**
  - Work Orders page placed under the Operations / Maintenance concept
    from the mockup.
  - Create/edit/close workflows.
  - Drag/drop Kanban ticket ordering persisted by
    `bms.work_orders.sort_order`.
  - Filters for status, asset, and priority.
  - "Create work order from alarm" action in Alarm Centre.
  - Audit entry for work order state changes.
  - Layout, labels, status colours, and actions aligned with the mockup's
    "Maintenance Kanban · Work Orders" screen where data exists.
- **Exit criteria:** complete — an operator can create a work order from
  an alarm, track it in the Maintenance Kanban, persist drag/drop order,
  and close it from the UI. Build, migration, compose migration, route
  mapping, and persistence smoke checks passed.

#### Phase 5 Sprint C — Maintenance Schedule Centre
- **Status:** complete
- **Goal:** support scheduled maintenance, not only alarm-driven work, while
  keeping the existing `R.mt` Maintenance Kanban focused on work-order
  execution.
- **Deliverables**
  - Dedicated Maintenance Schedule Centre at `/maintenance-schedules`.
  - Maintenance task templates, including UI creation and management.
  - Recurring schedule model with category and trigger metadata.
  - Asset-linked maintenance history.
  - Upcoming and overdue maintenance view with asset, category, due-state,
    and priority filters.
  - Schedule categories for preventive, predictive, condition-based,
    compliance, AMC, calibration, runtime, seasonal, inspection,
    corrective follow-up, deferred backlog, outage, energy optimization,
    and safety-critical work.
  - Work-order generation from schedule rows into the Maintenance Kanban.
- **Exit criteria:** complete — maintenance schedules can be created and
  managed in a dedicated Schedule Centre, viewed per asset/category, and
  converted into work orders while the Work Orders page remains Kanban-only.
  Build, migration, compose migration, route mapping, database category,
  and manual UI smoke checks passed.

#### Phase 5 Sprint D — Basic rule engine
- **Status:** complete
- **Goal:** introduce rules carefully without a complex visual builder,
  using the mockup's Rule Engine (`R.rl`) as the UX reference.
- **Deliverables**
  - Rule model for simple threshold and time-based rules.
  - Rule execution log.
  - UI to view, enable, and disable rules.
  - Clear distinction between simulator thresholds and future real-source
    rules.
  - Rule cards/table/actions aligned with `ESKOM_SMOC.html` where the
    active scope supports them.
- **Exit criteria:** complete — a simple rule can be enabled, evaluated,
  and traced through an execution log. Build, migration, seed, and
  browser-based Rule Engine smoke checks passed.

#### Phase 5 Sprint E — Energy reports
- **Status:** complete
- **Goal:** generate useful reports from current Energy Centre data,
  using the mockup's Reports & Analytics (`R.rp`) as the UX reference.
- **Deliverables**
  - Report preview screen.
  - Date range selection.
  - Energy summary: kWh, peak demand, PUE, indicative cost.
  - CSV export first; PDF only after the report content stabilizes.
  - Report template cards and preview layout aligned with
    `ESKOM_SMOC.html` where current report scope allows.
- **Exit criteria:** complete — a user can preview and export an energy
  summary CSV for a selected date range. Build, API smoke, and
  browser-based Reports smoke checks passed.

#### Phase 5 Sprint F — Report storage
- **Status:** skipped for now — revisit later if persisted report history is needed
- **Goal:** persist generated report files only after reports are useful.
- **Deliverables**
  - Promote MinIO/object storage if persisted report files are required.
  - Store generated report files.
  - Report history page.
  - Download previous reports.
- **Exit criteria:** generated reports can be persisted and downloaded
  from history. Skip this sprint if report storage is not needed.

#### Phase 5 Sprint G — Control Room foundation
- **Status:** complete
- **Goal:** bring the first IBMS Control Room 2D screens into the React app
  with seeded assets and simulator telemetry before broader UI alignment or
  future 3D work.
- **UX source:** `ESKOM_SMOC.html` Control Room routes `R.crOv`,
  `R.crSld`, and `R.crIT`.
- **Deliverables**
  - Seed DB assets for the Control Room electrical path, UPS/battery
    equipment, rack PDUs, Network Rack, and Videowall Server Rack.
  - Extend the simulator so these Control Room assets emit live electrical,
    UPS/battery, rack, and PDU telemetry.
  - Add `/cr-overview` for CR Main Dashboard with KPI ribbon, mini-SLD,
    UPS/HVAC tiles, rack summaries, energy snapshot, active rule warnings,
    and drilldowns for the completed CR modules.
  - Add `/cr-sld` for CR Electrical SLD with metering banner, detailed SLD,
    and Q1-Q12 breaker status/energy table driven by live telemetry and
    enabled rules.
  - Add `/cr-it` for CR IT & Rack Load with rack cards, PDU statuses,
    server inventory, and rule-driven UPS source mapping.
  - Keep the existing `/schematic/sld` DC1 electrical SLD unchanged.
- **Non-goals**
  - No CR UPS Monitoring, Battery Bank, HVAC System, Environment, Security,
    Alarm Management, or Trends pages in this sprint.
  - No Three.js Control Room 3D.
  - No two-way commanding, setpoint changes, breaker operations, or approval
    workflow.
  - No real ingestion/protocol adapters.
- **Exit criteria:** complete — Control Room assets exist in DB, simulator
  telemetry is present for those assets, and browser smoke verifies
  `/cr-overview`, `/cr-sld`, and `/cr-it` render live values.

#### Phase 5 Sprint H — Guided visual rule builder
- **Status:** complete
- **Goal:** let operators create and edit simple rules from the UI without
  introducing a free-form node graph or unsafe command automation.
- **Prerequisites**
  - Phase 5 Sprint D rule model, execution log, and enable/disable flow are
    complete and stable.
  - The available rule inputs are known from current assets and telemetry
    point keys.
  - Rule actions remain limited to notification, review, trace-only, or
    other explicitly promoted non-commanding actions.
- **Deliverables**
  - Guided IF/THEN builder for threshold and time-window rules.
  - Asset and telemetry-point picker backed by current API data.
  - Rule create, edit, duplicate, archive, and draft/publish API endpoints.
  - Server-side validation for asset/point compatibility, supported
    operators, threshold ranges, time windows, and action payloads.
  - Preview/test action that evaluates a draft rule against latest
    available telemetry without enabling it.
  - Audit rows for create, edit, publish, archive, enable, and disable.
  - UI states for draft, enabled, disabled, archived, invalid, and
    never-evaluated rules.
  - Clear copy separating operator-created rules from simulator alarm
    thresholds and future real-source rules.
- **Non-goals**
  - No two-way commands, setpoint changes, breaker actions, or approval
    workflow.
  - No real protocol adapter rules until Phase 2 resumes with confirmed
    source access.
  - No job queue or scheduler dependency unless a later sprint promotes it.
  - No complex drag-and-drop node graph until the guided builder proves the
    model and UX.
- **Exit criteria:** complete — an operator can create a draft threshold or
  time-window rule, preview it against current data, publish it,
  enable/disable it, duplicate/archive it, and see execution traces with
  audit history. Compose migration/seed, API/browser smoke, audit checks,
  duplicate-code cleanup, and build/lint verification passed.

#### Phase 5 Control Room Extension — Remaining 2D CR modules
- **Status:** complete
- **Goal:** promote selected Sprint G non-goals before Sprint I so the 2D
  Control Room covers UPS Monitoring, Battery Bank, HVAC System,
  Environment, and their effect on the CR Main Dashboard.
- **UX source:** `ESKOM_SMOC.html` Control Room routes `R.crUps`,
  `R.crBat`, `R.crHvac`, `R.crEnv`, and `R.crOv`.
- **Completed sub-sprints**
  - **G.1 — CR UPS Monitoring:** added `/cr-ups` with UPS-1, UPS-2, combined
    summary, live UPS KPIs, dynamic UPS block diagram, rule-driven status,
    and disabled/non-commanding Manual Bypass and Battery Test controls.
  - **G.2 — CR Battery Bank:** added `/cr-battery` with two battery strings,
    cell-level simulated telemetry, dynamic cell grid, per-bank
    temperature, battery alerts, rule-driven status, and disabled/non-
    commanding Equalize Charge and Capacity Test controls.
  - **G.3 — CR HVAC System:** added `/cr-hvac` with two precision AC units,
    lead/standby status, animated airflow/indoor-unit diagrams, setpoint,
    return/supply air, compressor/fan, run-hour balance, rule-driven
    status, and disabled/non-commanding Force Changeover and Set Schedule
    controls.
  - **G.4 — CR Environment:** added `/cr-env` with zone temperature/humidity,
    sensor floorplan markers, water leak and smoke sensor tables,
    rule-driven status where data exists, and disabled/non-commanding Test
    Sensors and Calibrate controls.
  - **G.5 — CR Dashboard Integration:** activated CR Dashboard drilldowns
    for UPS, Battery, HVAC, and Environment; added dynamic summary cards
    and included those modules in active warning rollups.
- **Data and simulator notes**
  - Keep feeder breakers such as `CR-Q10` and `CR-Q11` electrical.
  - Promote `CR-HVAC-1` and `CR-HVAC-2` to proper HVAC assets or add
    explicit CR HVAC point generation without losing breaker telemetry.
  - Add seeded environment/leak/smoke assets and simulator point keys only
    for local/pilot diagnostics; no real protocol adapters.
- **Non-goals**
  - No two-way commands, setpoint changes, manual bypass execution, battery
    test execution, equalize charge execution, HVAC force-changeover
    execution, sensor test/calibration execution, or approval workflow.
  - No CR Security, CR Alarm Management, CR Trends, Three.js 3D, or real
    ingestion/protocol adapters in this extension.
- **Exit criteria:** complete — operators can open all four promoted CR
  pages, see live simulated values and rule-driven statuses, drill into
  them from the CR Dashboard, and verify the existing CR SLD/IT pages
  remain stable. Shared, web, DB, API, CR smoke, lints, and simulator
  syntax verification passed.

#### Phase 5 Sprint I — Completed-page UI/UX alignment
- **Status:** complete
- **Goal:** revisit all completed pages and bring their UI/UX closer to
  `ESKOM_SMOC.html` after the Phase 5 operational workflows are complete.
- **Deliverables**
  - Compared every completed page against its closest mockup route /
    renderer (`R.dash`, `R.alm`, maps, `R.sld`, `R.crac`, `R.en`, `R.mt`,
    `R.rl`, `R.rp`).
  - Aligned navigation labels, sidebar grouping, page headers, action bars,
    cards, tables, status pills, and spacing.
  - Preserved existing API contracts and working data flows.
  - Updated `docs/demo-script.md` after visual changes.
- **Exit criteria:** complete — completed pages read as one coherent
  implementation of the original mockup without destabilising Phase 5
  functionality. Shared, web, DB, API, CR smoke, and simulator syntax
  verification passed.

#### Phase 5 Sprint J/K/L/M/N — Location and Access
- **Status:** active — reopened for focused hardening and demo inventory cleanup
- **Goal:** add canonical operational locations, DB-backed access scopes,
  location dashboard drill-down, and scoped UX before the next feature sprint.
- **Current sprint changes**
  - Bottom status bar aligned with `ESKOM_SMOC.html` powered-by copy:
    "Powered By: Euphoria Infotech India Limited".
  - Existing SMOC Pretoria North schematic/demo assets and their asset-group
    memberships moved under `CSMOC Gauteng`.
  - `CSMOC Gauteng` added to the focused simulator scope so those moved
    assets continue to emit live telemetry.
  - `SMOC Pretoria North` and its remaining inventory-only dummy assets were
    removed from seeded data and existing databases; the location no longer
    appears on the Main Dashboard or Sites Map after migration.
  - `/sld` Electrical SLD and `/crac` HVAC-CRAC are temporarily hidden from
    the left module menu while direct routes remain available for validation.
  - Final product branding set to `TRINETRA` across the login flow, app
    shell, browser title, and Executive Dashboard copy; the login screen now
    follows the `TRINETRA.html` split hero/sign-in card direction, uses the
    supplied `Trin.jpeg` logo, and includes
    "Powered By: Euphoria Infotech India Limited".
- **Next planned modification**
  - Replace the Location Dashboard "Top assets" table with a more informative
    paginated all-assets telemetry and risk panel that combines per-asset
    telemetry, freshness/staleness, alarm severity, warning state, and
    work-order context. Every scoped asset for the selected location must be
    reachable in the table; assets without telemetry should still appear as
    inventory rows marked "No telemetry".
- **Implemented before this hardening pass**
  - `bms.locations`, `assets.location_id`, asset groups, group membership,
    user-location grants, and user-asset-group grants.
  - Idempotent seed/backfill from `map_locations`, preserving `site_name`
    compatibility while moving APIs toward stable `locationId`.
  - Minimal demo assets cloned into empty RSMOC locations with unique
    location-prefixed codes.
  - Demo local users: global admin, Western Cape all-asset location admin,
    and Western Cape HVAC asset-group admin.
  - DB-backed `GET /api/v1/auth/me`, scoped asset/map/dashboard/telemetry,
    report, alarm, work-order, maintenance, and rule APIs.
  - Authenticated, per-socket telemetry and alarm WebSocket filtering.
  - Main Dashboard location KPI cards and
    `/locations/:locationId/dashboard` drill-down with denied/empty states.
  - App shell scope badge, limited-scope banner, scoped landing behavior,
    and sidebar hiding for asset-group-only module gaps.
  - OIDC logout redirect repair for the local/pilot Keycloak client and
    app logout flow.
  - Simulator throttling/focus for demo performance:
    `SIM_RATE_HZ=0.2`, `SIM_ASSET_COUNT=all`, and
    `SIM_SITE_NAMES=RSMOC Western Cape,CSMOC Gauteng,RSMOC KwaZulu-Natal`.
  - Telemetry maintenance/performance cleanup: `telemetry.point_values`
    cleared during diagnostics and an index added for dashboard latest-kW
    lookups.
  - `PV-INV-01` moved from RSMOC Western Cape, then grouped with the
    live schematic/demo assets now under `CSMOC Gauteng`.
  - Fixed schematic access guards so Pretoria-only SLD/CRAC pages require
    the complete bound asset set.
  - Control Room overview cards, quick drilldowns, and statuses made
    asset-group aware so WC HVAC users see only HVAC as active.
  - Main Dashboard location cards now mark locations with live telemetry,
    and the left module sidebar is collapsible while preserving mockup
    grouping/active-state language.
- **Hardening checklist**
  - Run a fresh DB migration/seed from empty native and compose databases.
  - Re-run Keycloak realm import/update checks for `admin`, `wc-admin`, and
    `wc-hvac-admin`.
  - Complete page-by-page role walkthrough for global, location, and
    asset-group admins, including direct URL access.
  - Decide whether RSMOC demo assets should become real reusable location
    schematics or remain dashboard/list-only demo assets.
  - Add focused automated tests for access-control helpers, route/page
    visibility, and scoped WebSocket filtering.
- **Previous focused validation:** latest focused checks passed for
  `pnpm --filter web build`, `pnpm --filter @bms/db build`, relevant
  lints, and Docker `web` rebuild/restart. Full clean migration/seed and
  all-role walkthrough remain pending for the revisit.

### Test & CI foundation (F4.4) — active
- **Status:** done (ADR 0014, PR #1)
- **Goal:** a test gate that actually runs, so work can be delegated without
  reading every diff (`docs/build-operating-model.md` §4). Wave 0 of
  `docs/BACKLOG.md`; the first item of the parallel run plan.
- **Delivered**
  - **Vitest** as the runner (the choice `docs/AGENTS.production.md` §10 already
    named), one project per app — `api`, `web`, `ingest`, plus a repo-wide
    `repo` project. `apps/web` inherits its own Vite resolution.
  - Assertions stay in `*.spec.ts`; thin `*.test.ts` wrappers call them. The
    migration was assertion-neutral by construction: 45 deletions, 0 additions
    against the spec files, all of it CLI bootstrap.
  - `tests/repo-invariants.test.ts` fails if any `.spec` file lacks a `.test`
    wrapper — Vitest excludes `*.spec.*` from coverage, so neither the runner
    nor the coverage gate would otherwise notice an orphan.
  - CI now runs `typecheck:tests`, **`db:seed`**, and `test:coverage`. Tests run
    last so a failing unit test cannot abort the job before `db:seed`.
  - Coverage thresholds set to the measured baseline (statements 3.60 /
    branches 1.86 / functions 3.37 / lines 3.72) and ratcheted upward as
    features land. §10's 80%/70% targets are **not** yet adopted.
- **Notable:** the CI `db:seed` step is the first end-to-end verification of the
  repaired drizzle journal (`0018`/`0021`/`0022`) on a genuinely fresh database.
  It passed.
- **Unblocks:** F4.5, F4.7, F4.8, F4.10 (Wave 1) and F3.21 (Wave 2).
- **Owed:** ~~a `chore(agents):` commit adding a testing section to `AGENTS.md`
  and correcting its §2 CI/CD row~~ — **done**, AGENTS.md §4.6.

### Access control hardening (F4.11, F4.12) — done
- **Status:** done (ADR 0017, PR #2)
- **Delivered:** the operations write matrix. Sixteen mutating endpoints across
  rules, alarms, work orders and maintenance carried `JwtAuthGuard` and **no
  role check** — any authenticated user, `viewer` included, could author rules
  and close work orders. `assertOperationsWriteRole(jwt, class)` now gates them
  before the scope check, resolving the role from `bms.users` rather than the
  JWT claim.
- **Notable:** `rules/preview` was exempted in an earlier draft as
  "verified non-persisting". That was wrong — it inserts a `rule_preview` row
  into `bms.audit_log` on every call. Two independent reviews caught it. A
  `viewer` could otherwise have driven unbounded audit growth with
  caller-chosen strings.
- **Mirrored into:** AGENTS.md §2 Operations row and §4.7.

### Encryption at rest (E8.1) — partial by design
- **Status:** software scope done; the rest is permanently out of repo scope
- **Delivered:** AES-256-GCM for RTU connection credentials (ADR 0012),
  fail-closed on an unset `CREDENTIAL_ENCRYPTION_KEY`.
- **Deliberately not built:** full-disk / volume / KMS encryption is a deployer
  action and not implementable in this repo. **Object-storage bucket encryption
  (`F3.3`, ADR required) and automated encrypted backups (`E8.2`) are deferred
  to their own backlog items, not cancelled** — see the ownership table in
  `docs/security/encryption-at-rest.md`. Its review raised **E8.3** and **E8.4**
  as new backlog scope.
- **Owed:** a retro ADR recording the boundary, or an explicit documented
  exemption. Tracked in `docs/BACKLOG.md` §5 as an open human decision — so the
  "permanent" half of this boundary is **not** settled yet.

### Access-control integration tests (F4.10) — done
- **Status:** done (PR #4)
- **Delivered:** all four `scopeFromSource` branches and the ADR 0017 write
  matrix, asserted against a **real** database with every expectation computed
  by independent SQL rather than read back from the service.
- **Notable:** two assertions shipped in a state where they *could not fail*,
  and only measurement found it — a fresh database had 147 assets and **zero**
  gateway-less, plus 16 locations and **zero** inactive, so two filters were
  indistinguishable from no filter. Fixed at the fixture
  (`packages/db/src/access-fixtures-seed.ts`), not the assertion.

### Asset templates (F2.1, F2.2) — done
- **Status:** done (ADR 0015 + Amendment 1, PRs #5 and #7)
- **Delivered:** `bms.asset_templates` + `bms.template_points`, where a row
  **is** a version and `assets.template_id` pins it. Published versions are
  immutable; editing one creates the next draft. Instantiation
  (`POST /admin/asset-templates/:id/instantiate`) builds assets from a
  published version and needed **no DDL** — F2.1 shipped `assets.template_id`
  ahead of it so F2.2 would not take the migration lock.
- **Amended during F2.2, both recorded in ADR 0015 Amendment 1:** the payload
  target became `rtuId` **xor** `locationId`, because ADR 0018 had since made
  `assets.rtu_id` nullable and the original RTU-only shape could not express a
  gateway-less asset; and §7's instantiate predicate was replaced, because
  `canManageTemplate AND canManageLocation` is **unsatisfiable** for
  `location_admin` — the one role §7's own prose exists to allow.
- **Notable:** a permissions rule with no caller is not verified by being
  reviewed. F2.1 defined the predicate and never exercised it; F2.2 was the
  first code to call it, and that is when the contradiction surfaced.
- **Unblocks:** nothing immediately — `F2.6` also needs `F2.4` and `F3.22` also
  needs `F3.21`. The critical path's next move was **E1.7**, below.
- **Mirrored into:** AGENTS.md §2 Asset templates row, §3, §4.7, §6.

### Template content model (E1.7) — done
- **Status:** done (ADR 0019, PR #9). No DDL, no new dependency.
- **Delivered:** `asset_templates.content` tightened from `z.record(z.unknown())`
  into a contract **tiered by whether a consumer exists**:
  - *Bound* — `alarms` and `maintenance` import their enums from
    `rules.schema.ts` and `maintenance.schema.ts` rather than restating them, so
    a template cannot author an alarm the rule engine cannot run.
  - *Anchored* — `kpis` carry an opaque `expression` behind a
    `dialect: "unvalidated"` discriminator (`F2.3` owns formula syntax);
    `dashboards` carry ordered point keys and nothing else (`F3.1` owns the
    widget vocabulary).
  - *Reserved* — `health` and `optimisation` are **rejected**, each naming its
    own blocking item (`E1.1`, `E1.6`).
  Reference validation runs on create, update and publish; publish also
  re-parses stored content, because `content` and `points` are patched
  independently and a points patch can orphan content the request never
  mentioned.
- **Deliberately not delivered:** nothing converts a template alarm into a
  `bms.automation_rules` row (that needs `ruleType`/`condition`/`action`), and
  nothing materialises a maintenance plan into `bms.maintenance_task_templates`
  (its `asset_id` is `NOT NULL`). This is the authoring surface; deploying it is
  `E2.x`/`E3.x` work with its own ADR.
- **Notable:** `E1.7`'s backlog row promises six things, and five of the six
  consumers did not exist on `main`. The item is really five reopenings gated on
  five different future items — `F2.3`, `F3.1`, `E1.1`, `E1.6`, `E2.1` — not one
  feature. Checking consumer state before designing changed the shape entirely.
- **Unblocks:** **`E5.1`** (water-treatment domain pack — P0 flagship, Ion
  Exchange's core business), plus `E5.2` and `E5.3`. `E2.2` and `E1.3` stay
  blocked on `E2.1` and `E1.1` respectively.
- **Owed:** ~~the AGENTS.md §2 promotion, in its own `chore(agents):` PR
  (§9.10)~~ ✅ **cleared** — §2 gained a *Template content* row, and §6 gained
  the two deferral bullets covering what ADR 0019 deliberately left closed.

### Ingest adapter framework (F1.1) — strangler migration complete
- **Status:** ADR 0016 §6 **commits 2 and 3 landed** (PR #13, then PR #19 on
  2026-08-06), and **commit 4 followed on 2026-08-14** — see below.
- **Delivered:** `apps/ingest/src/host/` — supervisor (one per endpoint, owning
  every timer), exponential backoff with jitter, bounded drop-oldest sample
  queue, ADR 0018-axis binding plan, normaliser, the NOTIFY chunker that the
  remaining copy (`apps/sim/src/index.js`) collapses into at `F1.11`,
  plain-text health endpoint on `INGEST_HOST_HEALTH_PORT` (9103, kept separate
  from the retired 9102) — plus `src/adapters/mqtt.ts`, `src/adapter/registry.ts`,
  and a shared adapter conformance suite. `src/main.ts` is wiring only, and since
  commit 4 it is the **only** entry point: `src/index.js` was frozen throughout
  the migration and then deleted. Operator notes: `docs/ingest-host.md`.
- **Scope promoted:** the interface, the host, and MQTT — which ADR 0007 had
  already promoted and this only ports onto the interface. Individual protocol
  adapters (F1.2 Modbus, F1.3 BACnet, F1.4 OPC-UA, F1.5 SNMP/REST, F1.6 DCS)
  each still need their own ADR under AGENTS.md §10 — unconditionally, not only
  where a protocol library has to be settled under §9.4.
- **~~Owed~~ ✅ commit 3 — done 2026-08-06, and the premise it was owed on was
  wrong.** This section said the parallel run was "not reproducible locally; no
  pilot runs on a dev machine". There was no separate deployment: the PHE pilot
  had **never been brought up anywhere**. Once the broker credentials were
  supplied it came up on this compose stack, the parallel run went ahead against
  the live Bhutnirghat I feed, and the cutover followed the same day. Full
  evidence in `docs/ingest-host.md`; in summary — an empty point-set differential
  in both directions between legacy-only and host-only windows, no duplication in
  the parallel window, `kwh_total` continuous across the handover, and
  `INGEST_NOTIFY` suppression verified against a positive control.

  *Two caveats on that evidence.* The window boundaries were derived from the
  measured device-clock skew rather than per-row process attribution, and the
  parallel window is **one message wide** — the uniformity across all three
  windows makes the conclusion robust, but that single row is the only direct
  evidence of concurrent non-corruption.

  The pre-check this section recorded — a read-only differential showing the
  legacy `assets.rtu_id` query and the host's `asset_points.rtu_id` query
  resolving an identical 22-point set — was re-run against the real feed and
  held. Its own caveat, that it proved only "like with like" and nothing about
  the pilot's data, was **dissolved rather than answered**: the local seeded
  database *is* the pilot's. Same for Resolved decision 5. Treat the 22 as
  historical — the catalog is 21 since migration `0025` dropped
  `device_timestamp`.
- **~~Owed~~ ✅ commit 4 — done 2026-08-14, four of its five actions.** The
  repository owner took ADR 0016 Resolved decision 4's named-owner gate.
  `apps/ingest/src/index.js` is deleted, `"start"` runs `dist/main.js`,
  `start:host` is gone, the compose `command:` override is gone, and the
  `INGEST_NOTIFY` flag is deleted so `pg_notify` is unconditional. That last one
  was the point rather than tidying-up: after the cutover the flag's off-default
  was the only reachable state in which telemetry lands while every dashboard is
  dead, with no error and no alarm, and for eight days compose's
  `INGEST_NOTIFY: "on"` line alone stood between the pilot and that.
  `MQTT_RECONNECT_MS` and `INGEST_METRICS_PORT` went with the entry point that
  was the only reader of either.

  **The downstream half closed on 2026-08-14 as `F4.34`** (PR #33, merged
  `c27e9c8`). Commit 4 made that dead-dashboard state unreachable *by ingest
  configuration*; the API's `LISTEN bms_telemetry` still had no error handler and
  no reconnect, so the same outage was one hop away. It was worse than the
  narrowing recorded: `pg.Client` is an `EventEmitter`, an `error` event with no
  listener throws, and with no `uncaughtException` handler in `apps/api` and no
  `restart:` on the compose service, a dropped connection took the **whole API**
  down and left it down — reproduced against a live database rather than reasoned
  about. The listener now supervises itself, and
  `bms_api_telemetry_listener_connected` on `/metrics` is the signal that a
  realtime path has died while REST keeps serving. `/health` was deliberately
  left alone: it is a liveness probe, and restarting a process that is serving
  traffic correctly is not the right response to a lost subscription.

  **`F4.36` closed the last unvalidated path into that fan-out on the same day**
  (PR #36, merged `bb37187`). The payload was `JSON.parse`d and cast straight to
  `TelemetryReading[]`, and the damage was not the one the row predicted: one
  `null` reading threw inside `AlarmThresholdService.collapseLatest`, which runs
  before any rule, and the throw is caught as a *warning* — so a single bad
  entry silently suppressed alarm evaluation for every good reading beside it.
  Invalid readings are now dropped individually and the rest of the batch is
  delivered, precisely so one malformed reading cannot blind the alarm path.
  Watch `bms_api_telemetry_readings_dropped_total`.

  **`F4.37` closed the future-dated case on the same day** (PR #39, merged
  `3c7e1ce`), and it closed it in the web client rather than the schema. A
  future timestamp made `Date.now() - lastSeenMs` negative, which is also not
  `> FRESH_MS`, so a dead asset rendered `running` — permanently, since for an
  asset that never sends again the future never arrives. The API still accepts
  such a reading **deliberately**: `resolveSamples` trusts `sample.at` and the
  PHE pilot writes 33 minutes ahead of `now()`, so rejecting it server-side
  would delete real telemetry. Re-verified rather than assumed — a reading dated
  33 minutes ahead was published against the running stack and was accepted and
  broadcast with the drop counter unmoved. The client now clamps on arrival, so
  a skewed producer costs at most `FRESH_MS` of delayed offline detection.

  Two things about this item are worth carrying forward more than the fix. The
  first is that **the clamp alone would have shipped doing nothing.** Staleness
  is computed during render, so it is only re-evaluated when something
  re-renders — and the only thing that reliably did was an incoming reading,
  which is precisely what stops in the case the guard exists for. A `staleTick`
  in the provider is what makes it observable; the consumer pages'
  `refetchInterval` is not a substitute, because TanStack v5 structurally shares
  results and notifies nobody when a refetch changes nothing. The second is
  `F4.38`, raised here and **more severe than the item that found it**: the
  seven control-room pages derive their tiles without consulting freshness at
  all, so a dead leak or smoke sensor renders `normal` indefinitely — no clock
  skew and no attacker required. It was left for the owner because `mergeStatus`
  ranks `critical` above `offline`, and whether a sensor frozen mid-alarm should
  keep escalating is a product decision in a safety path.

  **`F4.38` closed it the next day** (PR #45, merged `00d1acc`) under
  **ADR 0027**, whose four decisions were taken at the §10 gate: staleness
  outranks every value-derived state, `offline` outranks `critical` in the page
  banner, a stale tile renders `—` rather than its last numbers, and aggregates
  exclude stale slices and flag the count. The banner ranking has a known cost —
  one dead sensor can outrank a *different* live critical — so every merging page
  carries a live-critical count that nothing outranks.

  Two things from it are worth more than the fix. **It was the first item
  verified against the running Docker stack under the rule added in PR #43**, and
  that check earned its place immediately: with nothing reporting for 3.3 hours
  the main dashboard read `OK` for every domain, four leak sensors read `DRY` and
  four smoke sensors `NORMAL`. Stopping the simulator with no reload showed the
  tiles flipping inside the freshness budget — proof that `staleTick`, not the
  gate, is what makes any of it observable. The check also found a bug no test
  could reach (one tile reading "4 sensors · 8 stale") and raised **`F4.39`**:
  the SLD's `BATT-1 · 384 V` is a hardcoded literal, so no staleness gate can
  ever reach it.

  **`F4.39` closed that the same day** (PR #48, merged `816f14e`) under
  **ADR 0028**, and it turned out to be about the assumption underneath
  ADR 0027 rather than about literals. ADR 0027 answered *"is this reading
  current?"* and took for granted that the thing on screen was a reading. The
  row as raised was wrong twice: it said no other page was affected (five are,
  though most of those are legitimate nameplate data), and it missed the worst
  class entirely — values **synthesized from real telemetry and labelled as a
  different measurement**. `Voltage Y` was the measured R phase `+ 0.7`; the
  battery grid derives all 32 cell voltages from one string reading. Those pass
  the staleness gate *correctly* — they blank when the source dies and move when
  the real reading moves — which is exactly what makes them convincing. A static
  `384 V` at least sits inert.

  The rule that came out of it: **a value may be labelled a measurement of X
  only if it comes from telemetry that measures X.** `kVA` from `kW` and `pf` is
  fine; 32 cell voltages from one string voltage is not. Everything static now
  renders through a marker component as nameplate, configuration or simulated.

  **The review record is the part worth keeping.** Three rounds killed nine
  mutations a green suite had already accepted and falsified five of my own
  claims. Restoring the two literal battery voltages — verbatim the defect the
  item existed to fix — passed everything. Gutting both marker components left
  every call site correctly wrapped and no marker rendered anywhere, which is
  the `F4.37` class arriving from a new direction: every check asserted that
  call sites *use* the guard and none asserted the guard *does* anything. And
  two findings in the final round were each the same defect one call site over
  from a fix made in the round before — which is why AGENTS.md §4.4 now says
  fixing the instance is not fixing the class.

  The deployment check earned its place a second time, finding four things no
  test reached, including a **failed rebuild that went on serving the previous
  bundle** — indistinguishable from a working fix until the asset hash was
  compared with what the browser had loaded.

  **And the invariant written to hold the fix was itself defective** — it
  searched each file for `isStale(`, and two pages call it a second time for an
  unrelated header value, so deleting the status guard outright left every test
  green. That is AGENTS.md §4.4's seventh instance: a guard defeated by a decoy
  call in the same file.

  **`F4.40` came out of verifying `F4.39` and is about the test suite rather
  than the product** (PR #52, merged `d2132eb`; sweep #53, `fae282c`). Two
  suites failed on `main` with a working stack, and both assumed **the database
  has no history** — which is true of CI, whose database is created per run, and
  of nothing else. A fixture cleanup deleted through a subquery on `asset_id`, a
  **segmentby** column: a constant filter there prunes compressed batches, a
  subquery cannot be folded to one, so TimescaleDB decompressed every batch to
  evaluate the predicate. Measured **186706 tuples decompressed while matching
  zero rows** — the cost set by what the statement must examine, not by what it
  deletes. And a policy check asserted `job_stats.total_failures = 0`, a
  lifetime counter that never resets, so one transient failure reddened the
  suite for the life of that database (1 failure against 432 successes, the
  aggregate current). `DATABASE_URL=… pnpm test:coverage` now completes on an
  aged database — 56 files, 162 tests — where before it could not run at all.

  **The item's most useful output was a line in the rulebook, not in its diff.**
  AGENTS.md told the next migration that deletes telemetry to follow migrations
  `0014` and `0021` as precedents, and both use `DELETE ... USING <temp table>`
  — the join form that now fails on a compressed hypertable. They were correct
  when written; migration `0028` added compression underneath them afterwards.
  Forward-only, so they stay; the static invariant is scoped to `.ts`
  deliberately, so it cannot fail the build on two files nobody may edit — which
  is exactly why the rule for the next migration had to be written in §4.4. It
  surfaced only by chasing an overclaim in one of this item's own comments.

  **§4.6 gained the half of its asymmetry it was missing.** It covered a skipped
  suite reporting green; it did not cover CI having no history at all. A suite
  can be permanently green in CI and structurally red on every real database,
  which is the worse direction: the pipeline reports success while the people who
  run the suite learn to ignore it.

  **`F4.20` gave the API an OpenAPI document, and its real subject is how much a
  green suite does not tell you** (PR #61, merged `2645263`; sweep #62; ADR 0029
  and both amendments). The document is generated from the Zod schemas that
  already validate each request, because `@nestjs/swagger`'s decorators read
  TypeScript metadata off DTO classes and this codebase has none — the default
  approach yields a route index with every payload an untyped object *while
  looking complete*. 43 handlers are joined to their schemas by Nest
  `operationId` in one registry file, so a renamed schema is a compile error
  rather than a stale document.

  **Two amendments, both from measurement rather than review.** The first:
  `zod-to-json-schema` emits **nothing** for `.refine`/`.superRefine`, so 63
  schemas convert with zero failures while **11 refinement sites vanish** — shown
  on `telemetryReadingSchema.time`, where a payload Zod rejects is accepted by
  the generated schema. The owner's chosen fix, carrying the validator's own
  message into the document, turned out to be impossible: `.refine` captures its
  message in a closure and `_def.message` is `null`. So the marker is derived and
  the prose is authored, and because `.describe()` placed *before* a refinement
  is silently discarded, the guard checks order rather than presence.

  The second **reversed an accepted decision**. Putting the document behind the
  JWT was built, deployed, and then measured not to work: Swagger UI sends no
  `Authorization` header when it fetches a spec, so the page rendered "No
  operations defined in spec!" with nothing able to recover it. The docs are now
  absent or open, never guarded, gated by `API_DOCS_ENABLED` — and since the API
  image sets `NODE_ENV=production`, the compose stack serves nothing until a
  developer opts in through their own `.env`.

  **Three defects were found by fetching the served document, none reachable by
  the suite.** `/docs/swagger-ui-init.js` answered 200 with no token at 128 KB,
  carrying every path in the API, so the guard was protecting one copy while
  another sat in the open — the exact failure the comment two lines above it
  warned about. A `GET`'s schema was split into query parameters in a way that
  discarded the object-level refinements, so both audit routes shipped with
  their window rules stated nowhere despite carrying a `.describe()` and passing
  every check. And the UI could not read its own document. This is the fourth
  consecutive item where the deployment check found what the tests could not,
  and the sharpest case yet: a green suite, two clean typechecks and a static
  invariant, and three defects in what was actually served.

  **One guarantee did not land in the form its ADR specified, and the reason is
  now a rule.** Decision 6 asked for a runtime operation count; a Nest module
  cannot be instantiated in a test here, because vitest's esbuild transform emits
  no `design:paramtypes` and constructor injection resolves to `undefined`. No
  test in this repo has ever built one — that is why every integration suite
  constructs services directly. The count was verified manually instead, and the
  static check standing in for it says so in its own comment rather than passing
  as the gate.

  The ADR 0016 §5 backoff moved to `packages/shared/src/ingest.ts` in the same
  change, because that listener became its second consumer and the ADR states
  those numbers precisely so a second policy never gets invented. Note that
  `packages/shared` sits **outside** the coverage denominator, so the extraction
  lowered the reported percentage while removing a duplicate and adding no
  untested line.

  **The fifth action did not land, and is reassigned.** Retiring the
  `MQTT_USERNAME` / `MQTT_PASSWORD` fallback needs an encrypted credential row to
  read instead, and `bms.rtu_connection_configs` is still empty — re-measured
  2026-08-14 rather than taken from Resolved decision 5's 2026-08-04 reading,
  because AGENTS.md is explicit that the emptiness is a measurement with a date
  and E8.3 shipped a UI that can write that table. `CREDENTIAL_ENCRYPTION_KEY`
  *is* set, so the blocker is data rather than configuration. It moves to
  **`E8.4`**, which already owns the credential surface. Recorded in **ADR 0016
  Amendment 3**, which also discharges Resolved decision 5's "confirm against the
  production pilot" caveat — the database the pilot writes to is the compose
  `postgres` service, so the database needing confirmation was the pilot's.

  **Two structural guarantees are now repo invariants**, because no behavioural
  test can fail when a second entry point merely *appears* or when an
  `INGEST_NOTIFY` branch is added somewhere new: `apps/ingest/src` must hold
  exactly one entry point and it must be `main.ts`, and nothing outside the specs
  may read the flag or set it in compose. Both were mutation-tested, along with
  reinstating `notifyEnabled`, suppressing NOTIFY in `writeResolved`, rendering
  `notify=off`, and repointing `start` at the deleted file — six mutations, six
  failures.

  **One thing this closes off:** reverting the cutover used to be deleting one
  compose line, with no rebuild and no code edit. It is now reverting a commit.
  That fallback was given up deliberately — a permanent second entry point is
  precisely the strangler failure mode Resolved decision 4 named.
- **Known limits carried forward:** reload refreshes point *mappings* only (a
  new RTU or a changed endpoint needs a restart); RTUs sharing an endpoint share
  credentials until `F1.7`; a batch lost to a failed write is gone until `F1.10`
  adds disk buffering; telemetry authenticity rests entirely on broker ACLs,
  which `F1.7` should carry in its scope.
- ~~**Owed:** the AGENTS.md promotion (ADR 0016 Resolved decision 8)~~ ✅
  **cleared** — the §2 *Ingest adapters* and *Real ingestion* rows, the §3 tree,
  §6 and the §8 "also promoted" paragraph now describe the host, and §6 gained a
  second bullet holding commits 3 and 4 human-gated.

### Asset source-axis separation (ADR 0018) — done
- **Status:** done
- **Delivered:** `assets.location_id` is `NOT NULL` and `assets.rtu_id` is
  nullable; telemetry provenance moved to `asset_points.source_kind`
  (`measured` / `manual` / `computed` / `unmapped`), enforced by
  `asset_points_source_ref_check`. An asset must be *somewhere* and need not be
  *wired*, and one asset can now mix measured, hand-entered and computed points.
- **Unblocks:** F1.8, F1.9.
- **Owed:** the companion ADR on location *depth* (`locations.parent_id`,
  `parent_asset_id`, and retiring the Eskom-era `locations.type` union). The
  design question is answered — subtree inheritance is in — and F4.10 carries an
  armed tripwire (`assertLocationManagementIsFlat`) that goes red the moment
  inheritance widens `writableLocationIds`.

### Audit read API and export (F4.14) — done
- **Status:** done (ADR 0021, commit `73a9fd2`). No DDL, no migration lock, no
  new dependency — `xlsx` was already an api dependency. Landed directly on
  `main`, so unlike F2.1/F2.2/E1.7 there is no PR number to cite.
- **Delivered:** `GET /api/v1/admin/audit` and `/audit/export` (CSV + XLSX) in
  `apps/api/src/admin/audit/`. `bms.audit_log` had been written since ADR 0009
  and never been readable. Global admin only, offset-paginated with a
  `(created_at, id)` tie-break so pages are stable, export bounded by a required
  ≤366-day window and a 50,000-row cap that **refuses rather than truncates**.
- **Unblocks:** F4.15 (append-only audit + nightly hash-chaining) — the only
  item listing F4.14, and F4.14 was its only dependency.
- **Notable:** the security review found a **privilege-escalation path**, and it
  was reproduced against a real database before being fixed.
  `AccessControlService` falls back to the JWT claim when no `bms.users` row
  matches, so in OIDC mode an unprovisioned principal claiming `admin` resolved
  to an unrestricted scope and read the whole log; deleting a user's row would
  have *escalated* rather than revoked them. Every other `/admin/*` route
  survives this because a second scope check constrains it — audit read had no
  second check. ADR 0021 Amendment 1 adds a provisioning check. **The fallback
  itself is untouched** and still owes the ADR that F4.10 called for.
- **Owed:** a byte bound on the export. The 50,000-row cap was measured
  (42.6 MB / 2.47 s / 502 MB RSS) against a realistic payload, but `meta` is
  unbounded JSON, so rows can be far larger than the ones measured. Recorded in
  ADR 0021 rather than fixed, because narrowing an accepted cap is a gated
  change. Also open by design: whether audit *reads* are themselves audited,
  left to F4.15/F4.19.

### Onboarding credential capture (E8.3) — done
- **Status:** done (ADR 0022, commits `9e32b1c`…`7fa6784`). Raised by the E8.1
  security review. Landed directly on `main`, so like F4.14 there is no PR
  number to cite.
- **Delivered:** credentials leave the chat transcript entirely.
  `POST /api/v1/admin/onboarding/sessions/:id/credentials` is the only way in;
  a chat turn that appears to carry a credential is **refused** — not parsed,
  not stored, not forwarded to the model. The old `extractCredentials` parser
  and its plumbing were deleted so nothing can re-populate them. Migration
  `0026` purges `onboarding_sessions.messages` on every existing row, keeping
  the session rows because `audit_log` references them by id. The read gate was
  raised to match the write gate and moved into `loadSession`, so it covers all
  six onboarding entry points at once. `apps/web` gained the credentials
  surface it never had — a password-typed field in the preview drawer, cleared
  from component state on both success and failure.
- **Why it was a redesign, not a patch:** the wizard *actively prompted* admins
  to paste broker credentials into chat, `extractCredentials` parsed them out of
  free text, and `scrubSecrets` was a key-name denylist that cannot touch free
  text at all. Three vectors that had to close together.
- **Proved, not assumed:** the purge was demonstrated against the pilot database
  with a planted transcript inside a rolled-back transaction — `pnpm db:migrate`
  alone proved nothing, because the table held zero sessions.
- **Notable, and the most useful thing to carry forward: this took six review
  rounds, and the first five each found that the previous round's fix was
  defective or that the ADR asserted a property the code did not have.** The
  pattern was consistent — fixes landed where they were easiest to test rather
  than where they were load-bearing, and the document then described the intent
  rather than the code. Rounds found, in order: a privilege gap and an
  unredacted client path; a ReDoS introduced *by* the fix, plus a detector that
  deleted the product's own remediation copy; that the ReDoS "fix" had moved the
  quadratic rather than removed it, and the cost test guarding it measured
  nothing; a credential-misdelivery path where a whitespace-aliased RTU code
  shipped one broker's real password into another broker's connection config;
  and finally two Mediums — a widening of the redaction predicate that silently
  *narrowed* it on `clientKey`, and RTU codes able to name `Object.prototype`
  members. Every one is recorded in ADR 0022's six amendments, including the
  amendments' own corrections to each other.
- **Owed:** M1 (`safeParse(...).data ?? {}` discards an entire partial patch, so
  the OpenAI path can write nothing while reporting success — fails closed, on a
  path compose never enables), a cap on transcript length, and coverage of the
  `reconcile → attach → commit` composition through the real `mergeDraft`, which
  is currently tested function-by-function only. Key rotation, pino's unredacted
  `authorization` header, the discarded `keyVersion`, and binding a credential to
  a resolved endpoint rather than to an RTU *name* all belong to **E8.4**.

### Telemetry continuous aggregates (F4.1) — done

- **Status:** done (ADR 0023, PR
  [#21](https://github.com/GhochangFu/EMS/pull/21), merge commit `329ff31`).
  Merged as a merge commit rather than a squash so the five commits stay
  separable — the `typecheck:tests` fix, the feature, the compose pin and the
  review round each carry their own justification.
- **Delivered:** four hierarchical continuous aggregates over
  `telemetry.point_values` — `point_values_1m` ← raw, `_5m` ← `_1m`, `_1h` ←
  `_5m`, `_1d` ← `_1h` — with refresh policies, `pnpm db:refresh-aggregates`,
  read-only Drizzle `.view().existing()` declarations, the shared read helper
  `apps/api/src/telemetry/point-aggregates.ts`, and **one** converted read site
  (`DashboardService.energySummary`).
- **Three measurements each killed a decision**, which is why this ADR is worth
  reading before touching the aggregates:
  - **`avg` does not compose.** `avg(avg_value)` over minute buckets was wrong in
    **151 of 169** hourly buckets because samples per minute range 1–60. There is
    no `avg_value` column at any level; the mean is
    `sum(sum_value) / sum(sample_count)` at read time. Summed over the window
    both forms agree, so a total-level test does not catch it.
  - **`materialized_only` defaults to `true` on 2.29.1** — the opposite of what a
    real-time platform needs. A fresh aggregate returned 0 rows while raw data
    existed. It is set `false` explicitly on all four.
  - **`refresh_continuous_aggregate()` cannot run in a transaction** and
    Drizzle's migrator wraps the run in one, so backfill is a script.
- **The test that was written for the defect did not detect it.** Mutating
  `avgExpr` to the naive form left the per-bucket equality suite green: at
  1m→minute and 1h→hour each output bucket draws exactly one source row, where
  both forms are algebraically identical. A second assertion folds `_1m` up to
  hourly (60 rows per bucket) and fails by 2.97 kW under that mutation. Worth
  remembering as a pattern — a per-bucket test can still be blind if the grouping
  is 1:1.
- **Read timings are labelled, because two of them do not compare.** An hourly
  rollup over the whole 5-day dataset folding `_1m` up: 144.7 → 11.8 ms
  first-run, 32.7 → 5.4 ms second-run. The shipped `energySummary` paths reading
  a level directly, after a container recreate left caches cold: 24 h via `_1m`
  34.4 → 15.5 ms, 7 d via `_1h` 92.2 → 20.1 ms. The defensible claim is
  **2–6× on this dataset depending on window and cache state, widening with
  volume**. An unlabelled pair here caused one misreading already.
- **Three reviews ran** (security, migration, compliance). No confidentiality or
  authorization finding. The migration review found the one blocking defect: the
  window predicate moved from `time >` to `bucket >`, which is a **semantic
  change** — the old form weighted the partial leading bucket as a full one.
  Kept, bounded at one bucket's contribution, recorded as ADR 0023 Amendment 1.
  The compliance review found the suite was permanently pushing the production
  aggregates' watermarks into the future, and that the one converted read site
  had no test executing it. Both fixed.
- **Also fixed on the way:** `pnpm typecheck:tests` had been **red on `main`**
  since E8.3 — seven fixtures missing required fields. E8.3 was verified with
  `build` + `test:coverage`, neither of which runs that step. The merge commit is
  the first green run on `main` since 2026-08-09.
- **Unblocks:** `F4.2` (retention/compression) and `F4.28` (the six remaining
  rollup reads). Both had `F4.1` as their only dependency.
- **Constraint handed to `F4.2`, measured not argued:** `_1h` and `_1d` must
  outlive raw. At 0.5% of raw's footprint they are the only long-term record once
  `drop_after` runs, and `_1d` alone cannot answer "the peak hour in March two
  years ago" — what ISO 50001 baselining (`F4.19`) needs. A raw `DELETE` also
  does **not** remove the aggregate rows and no policy repairs it.
- **Deliberately not done:** the unclamped ingest `sample.at` that parks
  watermarks ahead of `now()` (belongs with `F1.7`), and the **unmeasured** lock
  level `CREATE MATERIALIZED VIEW … WITH NO DATA` takes on `point_values` — the
  ADR states that as unverified rather than implying otherwise.

### Telemetry compression and retention (F4.2) — done

- **Status:** done (ADR 0024, PR
  [#22](https://github.com/GhochangFu/EMS/pull/22), merge commit `1ef3189`).
  A merge commit again, so the ten commits stay separable — the pre-existing
  `main` failure, the migration, the tests, three review fixes and the ADR
  amendments each carry their own justification.
- **Delivered:** migration `0028` (journal idx 28). Raw `point_values`
  compresses at 7 days and drops at **730**; `_1m`/`_5m` compress at 7 days and
  drop at **735**; `_1h`/`_1d` are **never dropped and never compressed** — after
  raw's 730 days they are the only record of a period, at hourly resolution
  (ADR 0023 decision 7). Plus a lower bound on `pnpm db:refresh-aggregates`, an
  8-test probe/catalog suite, and `tests/adr-0024-retention-bounds.test.ts`.
- **Compression on real pilot data: 62.1x on heap, 29.1x on total.** Two numbers
  because compressing a chunk replaces its btrees, and uncompressed indexes here
  are 2.4x the heap — so most of the on-disk win is index elimination rather than
  column encoding. A synthetic-value probe managed only 9.6x, so the ratio is a
  property of real telemetry, not of the settings.
- **The finding that shaped the item.** `drop_chunks` on raw leaves the aggregate
  rows perfectly intact — 34,596 before, 34,596 after, bit-identical — which is
  what makes retention viable at all. But a **refresh** over the dropped range
  deletes them: 34,596 to 7,068. And `pnpm db:refresh-aggregates`, shipped by
  `F4.1` and documented as the operator's recovery tool, refreshed the entire
  history. The first time `drop_after` ran, the repair command would have
  destroyed the archive.
- **Two of this ADR's own recommendations were reversed by measurement**, both
  before the gate, and the ADR records them rather than quietly rewriting:
  - A dropped aggregate range reads as **empty**, not as a slow fallback to raw.
    Retention drops only chunks *older* than the cutoff, so the watermark stays
    high and the range sits behind it, served from stored rows that are gone.
  - And it **cannot be rebuilt** — a refresh over exactly that range with raw
    complete reports "already up-to-date" and leaves 0 rows. So the proposed
    90-day `_1m` horizon would have opened a window in which raw held the data,
    the aggregate returned nothing, and no shipped tool could repair it. The
    fine levels now expire *with* their source instead.
  - The retention-aware level selector proposed alongside them was withdrawn for
    the opposite reason: tying the horizons together closes the failure class it
    would have guarded, so it would have been a test for a closed gap.
- **A single-level test could not have caught the worst bug.** Review found the
  refresh bound applied *raw's* floor to all four levels — correct only for
  `_1m`, since `_5m` reads `_1m`, `_1h` reads `_5m`, `_1d` reads `_1h`. Because
  policy jobs lag individually, raw's floor can sit older than `_1m`'s data and
  the cascade deletes `_1h`/`_1d`. The probe ladder was one level deep, which is
  exactly the one level where the bound was right. It now runs two.
- **What CI still cannot see.** Its database is fresh every run, so no chunk ever
  reaches the 7-day threshold and **no compression policy compresses anything
  there**. A green pipeline says nothing about compressed-chunk behaviour; that is
  how "DELETE from a compressed chunk works" stayed unknown until compression had
  fired on a database with history. Retention is equally inert in CI.
- **Left to operations, not code:** per-job `job_stats` is the only real
  verification that six new background policies work — one of them failed on its
  first run here (worker starvation, fixed in compose), while an ADR fact had
  already asserted they all succeeded.
- **Owed:** whether any Ion Exchange compliance obligation needs *sample-level*
  effluent data beyond two years. `_1h` covers ISO 50001 baselining and the
  `E4.x` analytics; a regulator asking for individual readings is a different
  question and a business one. It rides with the `E5.1` client email, and the
  two-year fuse means nothing is at risk before it is answered.

### Rollup reads on the aggregates (F4.28) — done

- **Status:** done (ADR 0025, PR
  [#23](https://github.com/GhochangFu/EMS/pull/23), merge commit `beb5f2d`).
  A merge commit again, so the seven commits stay separable — the `DATABASE_URL`
  gate extraction, the runtime-build fix, the selector, the conversion and the
  review round each stand on their own.
- **What it closes:** ADR 0023 decision 6 converted exactly **one** read site to
  establish the pattern and named the other six in a new backlog row so `F4.1 ✅`
  could not be misread as "reads are on aggregates". All six are now converted, so
  it can be. Four sites in `dashboard.service.ts` (`loadTrend`, `energySummary`,
  `energySourceMix`, `energyTopConsumers`) and three in `reports.service.ts`, each
  through `apps/api/src/telemetry/point-aggregates.ts`.
- **The gate decision:** the three `reports.service.ts` sites read `_1h`, chosen by
  the repo owner. That is the client-facing Energy Consumption CSV, and the options
  fail in opposite directions — raw includes samples arriving more than 3 days late
  but **returns zeros** for ranges past ADR 0024's 730-day horizon, while `_1h` is
  never dropped and misses those late arrivals. Recorded in the ADR as chosen,
  with what would reopen it (the `E5.1` compliance answer).
- **It falsified a premise of ADR 0024**, which withdrew its own decision 8 (a
  retention-aware selector) reasoning that reports "land on `_1h`, which carries no
  retention policy at all". That holds only while level choice is hard-coded per
  site. `levelForRange` therefore keys on how far *back* a range reaches, never on
  its duration, and `end` plays no part — it is routinely in the future. **ADR 0024
  Amendment 3** records the correction, along with a second one: `parseEnergyWindow`
  caps at **720** hours, not the 168 that ADR reasoned from, and what actually keeps
  `_1m` reads shallow is the 48-hour level switch rather than the window cap.
- **What the tests do and do not prove, measured rather than assumed.** Four of the
  six sites group by the read level's own bucket width, so exactly one source row
  feeds each output group and `avgExpr` is algebraically identical to the naive
  average-of-averages there — their parity tests prove predicate translation and
  level choice, and nothing about the mean. Confirmed by mutation: replacing
  `avgExpr` with the naive form kills **only** the two bare-`avg` sites. Those two
  additionally assert their own fold is ≥ 2, because at `_1h` **8 of 37** real
  assets have a fold of 1 and agree under both forms.
- **Two guarantees no behavioural test can carry** are static invariants instead: a
  read reverting to `date_trunc` over raw is invisible, because every parity test
  compares against the raw query it replaced and a revert compares that query with
  itself (measured — a fully reverted `loadTrend` left the suite green); and a
  dropped `bucketHours` factor is invisible while the factor is 1. Both found in
  review, both closed in `tests/`.
- **Also landed here:** the `DATABASE_URL` integration gate, extracted from **six**
  verbatim copies after `F2.1` set the threshold at three and `F4.14`, `F4.1` and
  `F4.2` each deferred it.
- **Deployed at merge time: database yes, API yes, frontend N/A.** Unlike `F4.2`,
  this item changes `apps/api` runtime files, so the container genuinely needed the
  rebuild — verified end to end under a real authenticated session: all four
  converted endpoints 200, the Energy Centre rendering **695 kWh / 415 kW** against
  a database where the aggregate and raw paths both give **695.37 / 414.66** over
  1310 buckets, and the reports range matching at **870.60 kWh / 383.57 kW /
  126.04 solar** over 23 buckets. `apps/web` was never touched.
- **Still owed:** nothing. `F4.29` — the formula-injection guard this item's
  security review raised and deliberately left out — is **done** (see below).

### One CSV escaping rule for both exports (F4.29) — done

- **Status:** done (ADR 0026, PR
  [#27](https://github.com/GhochangFu/EMS/pull/27), merge commit `ad979d1`).
  Three commits: the fix, the review corrections, and the invariant scoping.
- **The defect.** `reports.service.ts`' `csvCell` quoted but did not neutralise a
  leading `=` `+` `-` `@` TAB or CR, so an asset `code`, `name` or `site_name`
  starting with one was delivered as a **live formula** to whoever opened
  `GET /reports/energy/export.csv` in Excel or Sheets. `F4.14` had already solved
  this for the audit export, so the two exports disagreed on the same rule.
  Neither write path into `bms.assets` restricts those characters — both validate
  length only.
- **Not a promotion.** The CSV export was already in scope (AGENTS.md status
  line), and no dependency was added, so §10 was not engaged and §9.4 was not
  either. ADR 0026 exists because the change alters a **client deliverable's
  bytes** and because the numeric-exemption reasoning would otherwise be
  re-litigated — the audit guard's own rationale was lost exactly that way, ADR
  0021 never mentioning formula injection at all.
- **Settled at the §10 gate on 2026-08-10:** one shared
  `apps/api/src/serialise/csv.ts`, and **numeric cells exempt**. The guard exists
  to neutralise cells whose Excel *formula* reading differs from their literal
  text; for a numeric literal it does not (`=-5` is `-5`), so guarding the
  report's numbers would import them as **text** and break the client's own
  arithmetic. Justified structurally rather than from data — `kw` has no negative
  rows but `kvar` has 750, so a sign-based argument would not have survived.
- **A coupled defect fixed in the same change:** the reports quote trigger was
  `/["\n,]/` where the audit one is `/["\n\r,]/`. Adding the apostrophe alone
  would have emitted a CR-led value as `'\rfoo` *unquoted* and split the record.
- **Latent, not live:** 0 of 148 assets and 0 of 17 locations carried a leader or
  a quoting character, so today's export is byte-identical before and after. That
  is what made the fix safe and also invisible to any test reading real data — so
  the pre-fix `csvCell` was reimplemented verbatim from `068aeae` and its output
  proved byte-identical (400 bytes) to the golden the new spec pins.
- **Eight mutations verified to fail**, including all five repo-invariant checks.
  Dropping the guard fails the *audit* spec too, which is what shows the
  extraction is load-bearing for both call sites rather than a tidy-up.
- **The branded `CsvField` was compile-tested** (`TS2322` on a raw string in a
  row), not asserted — the claim class `F4.28` got wrong with its `tsconfig`
  exclusion.
- **Reviews found four of my own claims false**, each corrected in place rather
  than quietly fixed: the finiteness justification cited `COALESCE`, which guards
  `NULL` and not `NaN`; the leader-list comment named the wrong mechanism, which
  would have made deleting `\r` look safe; the XLSX exemption rested on "it is a
  string cell" when the real safety is the absence of any `<f>` element; and the
  repo invariant's coverage story was inverted — the check advertised as catching
  a new export would not have caught this very defect. **One assertion of mine was
  invariant under the mutation it claimed to guard** and was removed rather than
  repaired, the third instance of that trap in three items.
- **Deployed:** API rebuilt and the running container *proved* to carry the
  post-review code, then the compiled serialiser run inside it against a hostile
  fixture — three untrusted cells neutralised, negatives bare, benign output
  exactly 400 bytes. **No migration and no `apps/web` change**, so there was
  nothing to deploy at the database or frontend tier; recorded that way rather
  than as three green ticks.
- **Still owed: nothing. All three closed, and two of them found real defects.**
  `F4.30` set `Cache-Control: no-store` on the energy route (`20c4a53`).
  `F4.32` moved finiteness into the database — as a **range test**, because
  Postgres defines `NaN = NaN` as true and the prescribed `CHECK (value = value)`
  is a no-op there (`6160655`). `F4.31` ran the guard past the three real import
  parsers and **found a live bypass**: Google Sheets evaluated a cell led by one
  U+0020 space, shipped in both exports since `73a9fd2` (`c7eb6cb`).
- `F4.31`'s security review then raised **`F4.50`**, which is the same lesson one
  layer out. The guard assumed every consumer reads the file as
  comma-delimited. Excel 2013 evaluated `foo<TAB>=1+1` out of its cell in **four**
  consumers that do not — two clipboard pastes, a comma+TAB file open, and a
  `;`-locale file open. TAB, `;` and `|` joined the quote trigger
  (ADR 0026 *Amendment 1*). **What it closes is bounded, and the bound was found
  by attacking the claim rather than by shipping it:** Excel honours the `"`
  qualifier only when the quote opens a field, so the deciding variable is
  whether the **comma** is still among the consumer's delimiters. Where it is,
  the cell arrives intact — a real closure. Where it is not, two separators in
  one cell put the closing quote on a later fragment and `=1+1` evaluates anyway.
  Residual filed as **`F4.51`**, with the honest note that no cell-level escaping
  in that module can repair it.
- **`F4.51` closed that residual by changing format rather than escaping**
  (ADR 0026 *Amendment 2*, 2026-08-19). The owner was shown a write-path
  enumeration and ruled option (c)+(a). Rejecting `;`/TAB/`|` at the write path
  was the intuitive fix and is **impossible to complete**: the exported columns
  are written by 13+ Zod validation points across five modules, and the audit
  export's `actor_email` comes from `users.email`, which has no write path in
  this codebase at all. A partial guard there would have read as closed. The
  chosen fix was cheaper than the row assumed — `xlsx` was already a dependency
  for the audit export, so §9.4 did not gate it, and only the reports side
  lacked the format. `GET /reports/energy/export.xlsx` now ships beside the CSV,
  whose bytes are unchanged; both render from one table so they cannot drift.
  Verified on the compiled code in the container: the multi-separator payload
  occupies one cell and the workbook carries zero `<f>` elements. **The CSV keeps
  its residual and now documents it** — that is the `(a)` half, and it is a user
  choice rather than an unrecorded defect.

### Shared API contracts with a runtime (F4.23, F4.43, F4.44) — done

- **Status:** done (ADR 0030 and its three amendments). Four PRs, CI green
  throughout: [#64](https://github.com/GhochangFu/EMS/pull/64) accepted the ADR
  (`1450909`), [#65](https://github.com/GhochangFu/EMS/pull/65) the spike
  (`8facc97`), [#66](https://github.com/GhochangFu/EMS/pull/66) the schemas
  (`1b0da54`), [#67](https://github.com/GhochangFu/EMS/pull/67) the web
  validation (`b6e18d7`); `F4.43` followed as
  [#68](https://github.com/GhochangFu/EMS/pull/68) (`89079fc`).
- **The row's premise had shifted, and reading it against `main` is what found
  that.** `F4.23` asked for `packages/contracts` (Zod), `packages/ui` and a
  `telemetry-sdk` — three names transcribed from `docs/AGENTS.production.md`,
  the north-star tree whose own header says not to assume it is enforced. But
  the shared contract was **not missing**: `packages/shared` already exported
  **100** types covering essentially every response, imported at **148** sites,
  so the API is written against the client's contract today. What was missing
  was a **runtime** — every export was a `type`, `packages/shared` declared no
  dependencies at all, and `apps/web` imported `zod` **zero** times. And two of
  the three packages had no consumer anywhere: `telemetry-sdk` has **no stated
  purpose in the repository** beyond that tree. They were split onto `F4.41` and
  `F4.42`, deferred rather than dropped, rather than building a second path
  ahead of its consumer — the pattern this repo has already paid for twice
  (ADR 0016 §6, ADR 0029 Amendment 2).
- **The spike ran before the design was committed, and changed nothing** — worth
  saying because ADR 0029's reversed a decision. Both halves: *(a)* every
  structural class converts, measured as 14 conversions against **two** bars,
  giving 3 strict-identity failures and **0** assignability failures. That gap
  is the finding — the strict bar is the only one that discriminates, so under
  assignability alone all three wrong encodings pass silently. All three are
  encoding choices with a passing sibling, and they are now §4.8. *(b)* drift
  was **zero** across 99 declared paths on 4 endpoints — but the first sample
  was not good enough, 8 of 64 paths unobserved against one location, and **an
  unobserved path is neither satisfied nor violated**; widening to all 16
  locations closed it exactly. The scope limit is the point: 4 endpoints of 93,
  so *zero drift where measured* is not *the API has no drift*.
- **The failure direction is asymmetric, and (b) is what justified it.** Throw in
  dev/test, log-and-pass in production — no longer a hedge against suspected
  chaos, but cheap insurance for the 89 routes the spike did not measure, at no
  cost on the four it did. A blank Control Room during an incident is a bigger
  outage than one drifted field.
- **The migration was proved and the proof deleted.** 81 assertions of strict
  type identity between each schema and the type it replaced, **79 identical on
  the first run**; after the switch all 81 compare `z.infer<typeof S>` with
  itself, so keeping them would have been 79 vacuous guards. The two that
  differed share one cause and it is the only contract this change altered: a
  **required `unknown` property is not expressible in Zod**, and unlike the three
  encoding rules it has no passing sibling.
- **The first run against the deployment found a defect nothing else had.**
  `GET /rules` had **never** matched its contract: 48 of 89 rows carry
  `category = "electrical"`, written directly by migration `0022` for the PHE
  pilot, and the union did not contain it. Three things had to line up to keep it
  invisible — no `CHECK` constraint, a cast in `rule-mapping.ts`, and an
  exhaustive `switch` with no `default` returning `undefined` for a value
  TypeScript said could not occur. The visible cost was 54% of rules rendering an
  **empty, unstyled** badge with no way to filter to them.
- **Superseded by `F4.45` (ADR 0031 + Amendment 1), 2026-08-16.** The paragraph
  below describes the code as `F4.43` left it and is kept as the record of that
  step. It is **no longer current**: `electrical` turned out to be a plant
  *domain* sharing a column with concerns, so the axes were split, the 48 rows
  moved to `safety`, and both vocabularies became rows
  (`bms.rule_categories`, `bms.asset_domains`) referenced by foreign keys —
  there is no `authorableRuleCategorySchema` and no derived read union any more.
- **`F4.43` fixed it structurally rather than by test.** The read union is built
  as `[...authorableRuleCategorySchema.options, "electrical"]`, so read ⊇ write
  holds by construction and the containment test would have been a tautology —
  it was therefore not written. `rules.schema.ts` re-exports the shared enum
  instead of restating it, applying its own comment (*a copied enum is a copy
  that drifts*) to itself. Widening propagated into two places the compiler found
  and the author had not, both correct objections: ADR 0019's template authoring
  surface needs the *narrow* vocabulary, and `ruleBodyFromRow` rebuilds a draft a
  seeded rule never had — its two callers were **checked**, not assumed, and
  never re-parse the category, so editing a PHE rule's threshold cannot silently
  reclassify it.
- **Verified on the rebuilt containers**, which is the whole point: drift reports
  across 9 routes went **1 → 0**, `/rules` renders 48 Electrical badges and 41
  others (89, the exact database count), and **zero** elements carry the literal
  class `undefined`. Plus `pnpm build`, `pnpm typecheck:tests`, and 62 files /
  193 tests with `DATABASE_URL` set.
- **`F4.44` closed the half `F4.43` left open** (PR
  [#70](https://github.com/GhochangFu/EMS/pull/70), merged `df6d3d8`). `F4.43`
  widened what the API may *return*; the rule builder is where an operator
  *writes*, and it still offered four values while being opened to edit rules
  carrying a fifth. The symptom was not the one predicted from source, and the
  difference is the whole lesson: a `<select>` whose value matches no `<option>`
  renders its **first** option, so the form read `Operations` for 48 rules that
  are `electrical` — plausible, and wrong. A blank control would have looked
  broken. Saving then failed on a field the operator was never shown, or
  silently reclassified the rule if they "corrected" it.
  A locked category now renders read-only and is **omitted from the payload**, so
  the server keeps what it stores — verified against the real schemas rather than
  assumed, because `mergeRuleDraft` gives `category` no `undefined` check and a
  present-but-`undefined` key would have cleared it. The preview path was checked
  **before** the design was chosen: its audit row records no category, so the
  omission writes nothing false into `bms.audit_log`.
  **Why the compiler was silent, which is the part worth carrying:** widening a
  union only errors where a consumer's type was *narrower*. The builder's field
  was already the wide type, so the change made it compile more comfortably, not
  less — "the compiler found two propagations" was mistaken for "there are two".
- **Still owed:** `F4.6` (contract tests) is now unblocked and is what this
  existed to enable; `F4.41` and `F4.42` stay deferred until each has a consumer;
  `apps/api`'s module resolution is queued in `docs/BACKLOG.md` §5 as a decision
  rather than documentation of one. The `CHECK`-constraint question was
  **absorbed into ADR 0031** — it turned out to be one question asked of two
  columns, and not answerable on its own.

### Alarm severity as a vocabulary (F4.46, ADR 0032) — done

- **Status:** merged 2026-08-18 (PRs #88, #89).
- **What it was.** `F4.46` was a three-part defect on one column. The rule
  builder rewrote a severity it did not recognise back onto the row on save
  (closed earlier by #80); the alarms page **coloured and counted** an
  unrecognised severity as the least urgent thing on the board; and `major`
  appeared in three readers while existing in no contract, no schema and no row.
- **`major` was not dead data — it was the mockup's word.** `ESKOM_SMOC.html`
  and `TRINETRA.html` both draw a `Major` card with warning styling, while the
  product stores `warning`. The page was comparing stored values against a
  *display* vocabulary. The label stayed; the comparisons went. A third reader —
  a SQL predicate in `dashboard.service.ts` — meant the collision had reached the
  API, not just the web client.
- **Then the storage question, which the backlog row had answered wrongly.** It
  asked for a `CHECK` constraint and an exhaustive `switch`, citing ADR 0031.
  ADR 0031 does not mention severity, and its Amendment 1 had moved the opposite
  way. The owner ruled for a lookup table: `bms.alarm_severities` (migration
  `0030`), keyed by `code`, carrying **`rank`** for urgency and **`tone`** for
  colour, with foreign keys on `alarms.severity` and a nullable
  `automation_rules.severity`.
- **Why `rank` and `tone` are the point.** ADR 0031 could open `category` freely
  because nothing branches on it. Severity has behaviour attached, and the row
  read that as a reason to freeze the set. It is instead a reason to make the
  *behaviour* data: a level declared with no rank and no tone would arrive
  unsortable and unstyled, which is the `F4.43` empty-badge failure again.
- **Measured, not asserted.** Before seeding, an alarm at `severity = 'high'` is
  rejected by `alarms_severity_fk`. After one `INSERT` at rank 25 with tone
  `warning`, the same write succeeds and the page draws `HIGH` amber, counted
  under Major — with no code change. That is the whole cost of answering client
  ask **B9**, against a migration and a deploy under the `CHECK`.
- **Three review passes found real defects, and one falsified the ADR itself.**
  `AlarmThresholdService.normalizeSeverity` rewrote anything outside three
  literals to `warning`, so a rule seeded at `high` passed the foreign key and
  was then downgraded on every alarm it raised — the "no code change" promise
  false on the path that matters most. Also: a preflight hardcoding the three
  codes (so a re-run aborted on a value the table already held); `varchar(32)`
  columns against a `varchar(64)` key, turning a long code into a **500** on the
  path `assertAlarmSeverity` exists to make a 400; four *more* hardcoded severity
  literals in the dashboard SQL; a `tone` default that would have made an
  untoned level silently the calmest colour; and a rule-builder effect that
  persisted `severity: null` if a rule was opened before the vocabulary loaded.
- **The lesson worth carrying, now in AGENTS.md §4.8.** *Opening a vocabulary
  invalidates every closed list that reads it, not only the ones the compiler can
  find.* Most of the above were hand-written `if`s and SQL literals; nothing in
  the type system pointed at any of them. And the closed/open test gained a third
  answer: a vocabulary is only closed if the **behaviour cannot be carried as
  data**.
- **Still owed:** nothing blocking. Two retirement gaps are recorded in ADR 0032
  rather than fixed — `duplicateRule` copies a code without re-checking `active`,
  and a rule holding a retired severity becomes uneditable. Neither is reachable
  until something retires a value, which nothing does yet. Client ask **B9** is
  still open: if Ion Exchange confirms a `High` level, someone must rule its tone
  and its rank.

### Phase 6 — Premium visuals (~3 weeks)
- **Status:** pending
- **Graduates:** Three.js Control Room 3D only.
- **Highlights:** GLB/GLTF model of the SMOC control room, live data
  bound to 3D screens, alarm indicators, and clickable zones/assets that
  navigate back to existing 2D screens.
- **Explicit deferral:** AI Copilot / chatbot remains out of scope and is
  not part of this Phase 6 plan.

#### Phase 6 Sprint A — 3D feasibility
- **Status:** pending
- **Goal:** prove Three.js fits without rewriting the React app.
- **Deliverables**
  - Choose the 3D integration approach.
  - Add one isolated 3D route/page.
  - Load a placeholder room scene or simple model.
  - Bind a few live KPIs to 3D labels/screens.
- **Exit criteria:** a prototype 3D route renders acceptably and consumes
  existing live data without destabilizing the current UI.

#### Phase 6 Sprint B — 3D control room MVP
- **Status:** pending
- **Goal:** make the 3D control-room view demo-worthy.
- **Deliverables**
  - Control-room scene.
  - Live status panels.
  - Alarm indicators.
  - Clickable zones/assets that navigate back to existing screens.
- **Exit criteria:** the 3D view can be used in a demo to show live status
  and drill back into established 2D operational screens.

#### Phase 6 Sprint C — 3D polish
- **Status:** pending
- **Goal:** make the premium visual layer stable and presentable.
- **Deliverables**
  - Performance tuning.
  - Loading and error states.
  - Browser compatibility check.
  - Demo script update.
- **Exit criteria:** the 3D view runs smoothly enough for the target demo
  machine and has clear fallback/loading behavior.

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
| Real protocol adapters (BACnet, Modbus, SNMP, OPC-UA, MQTT) | Phase 2 — MQTT promoted for one RTU (ADR 0007); the `IngestAdapter` **interface, its host and the MQTT adapter** are promoted (ADR 0016 §6 commit 2); each *further* protocol implementation still needs its own ADR |
| EMQX broker | Phase 2 |
| Redis cache and pub/sub | Phase 1 |
| MinIO / object storage | Phase 5 Sprint F only if persisted report storage is needed |
| Two-way commanding with approval workflow | Phase 4 |
| Audit hash-chaining | Phase 4 |
| Maintenance / work orders / rule-engine UI | Phase 5 |
| Energy reports (PDF/XLSX) | Phase 5 |
| Three.js Control Room 3D | Phase 6 |
| AI Copilot | Deferred; not included in the current Phase 6 plan |
| NERSA / ISO compliance reports | Phase 7 |
| Docker, Kubernetes, CI/CD, Prometheus / Grafana / Loki | Phase 1 |

When a phase opens, the corresponding row(s) above flip to "in
progress" and the matching items move out of `AGENTS.md` §6 into the
active rules.

**This crosswalk is phase-shaped; current delivery is not.** Wave 0/1 work runs
off `docs/BACKLOG.md` against the loop in `docs/build-operating-model.md`, and
lands via ADRs that cut across these phase rows. When the two disagree, the
ADRs and `docs/BACKLOG.md` are authoritative — this table describes the
original plan, not the current board.
