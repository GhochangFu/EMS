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

### Ingest adapter framework (F1.1) — cut over, commit 4 pending
- **Status:** ADR 0016 §6 **commits 2 and 3 landed** (PR #13, then PR #19 on
  2026-08-06). `F1.1` stays `⬜` in `docs/BACKLOG.md` — commit 4 has not.
- **Delivered:** `apps/ingest/src/host/` — supervisor (one per endpoint, owning
  every timer), exponential backoff with jitter, bounded drop-oldest sample
  queue, ADR 0018-axis binding plan, normaliser, the NOTIFY chunker that the
  two surviving copies (`apps/ingest/src/index.js`, `apps/sim/src/index.js`)
  collapse into at commit 4 / `F1.11`,
  plain-text health endpoint on `INGEST_HOST_HEALTH_PORT` (9103, separate from
  the legacy 9102 so both can run at once) — plus `src/adapters/mqtt.ts`,
  `src/adapter/registry.ts`, and a shared adapter conformance suite. `src/main.ts`
  is wiring only. `src/index.js` is **frozen, not one line edited**, and
  `pnpm start` still runs it — but **compose and the pilot run the host** since
  the commit 3 cutover. Operator notes: `docs/ingest-host.md`.
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
- **Owed — commit 4:** an owner for deleting `apps/ingest/src/index.js`, pointing
  `"start"` at `dist/main.js`, removing the compose `command:` override and
  deleting the `INGEST_NOTIFY` flag with it. Until someone does, the
  two-entrypoint window stays open — the realistic failure mode of a strangler
  migration, and **more likely now, not less**: the cutover removed the
  operational pressure that would have forced the issue. It also stopped being
  tidying-up. `INGEST_NOTIFY` defaults off, which was the safe direction while
  two processes ran and is the dangerous one now that the host serves alone:
  compose's `INGEST_NOTIFY: "on"` is the only thing keeping realtime alive, and
  losing that line means rows keep landing while every dashboard goes silently
  dead. Commit 4 removes that failure mode. **ADR 0016 Resolved decision 4
  records that this has no named owner.**
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
