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

### MQTT ingest beyond one RTU (F1.7) — five of twelve, measured
- **Status:** ✅ **2026-08-22** on `feat/F1.7-mqtt-fleet`, eight commits.
  **Not merged** — the PR is not open and merge approval is the owner's gate.
  **ADR 0007 Amendment 1 accepted 2026-08-22** at the §10 gate, superseding
  decision 4's "one pilot RTU only".
- **Delivered:** per-RTU liveness on the health endpoint (a device that has
  never published is listed, not omitted); payload-to-topic binding, closing an
  impersonation path where one message both falsified a station's telemetry and
  silenced its outage alarm; a seed that asserts the enabled set **once**,
  stamps `meta.enabledSetVersion`, then defers to the operator in both
  directions; a read-only fleet probe that reports which keys arrive **empty**,
  not merely which arrive.
- **The set is five, not nine, and that is the substance of the item.** A 600 s
  probe found nine of twelve publishing. Four of those nine then failed a second
  filter: Salkumarhat I/II send all 27 keys with **17 carrying no reading** (the
  Modbus block, including the `kw` the dashboard counts), and Mora Nodir Kuthi
  II / Bhutnirghat II run **−3:02:36** and **−0:21:34** behind, so their rows
  land outside every recency window. Enabling an RTU makes `apps/sim` skip its
  assets, so a station that cannot deliver a readable value goes from simulated
  to **dead** — worse than leaving it on catalog data.
- **What this cost to learn:** an early diagnostic bounded on `now() -
  15 minutes` reported two *healthy* stations as writing nothing at all. They
  were the two lagging by more than fifteen minutes. Any dashboard doing the
  same omits them the same way — recorded as `F4.57`.
- **Two false greens, both found by review and killed by mutation:** the entire
  seed mechanism could be reverted verbatim with 145 tests still green, and the
  enabled set could change without the version stamp moving. Closed by a
  **two-pass** seed integration test (one pass cannot reach the branches that
  matter, because CI seeds a fresh database once) and by deriving the stamp from
  a digest of the set *and* pinning the five by name.
- **Verified:** 133 files / 495 tests serially, exit 0; live at `rtus=5
  stale=0`, all five writing and all seven held-back writing zero; API checked
  at query level (OIDC mode blocks local login), `apps/web` N/A.
- **Unblocks:** nothing directly — no row lists `F1.7` as a whole-token
  dependency. `F3.16` and `E1.1` carry the `F1.x` wildcard, and `F3.16` overlaps
  the two rows below.
- **Owed:** the `F4.37` ingest-side clamp, **owner-gated** — holding four RTUs
  back closed the never-online half, but all five enabled stations run **+8:11
  to +34:31 ahead**, so each still reads online for as long as its clock leads
  after it dies. Plus the AGENTS.md §6 sweep in its own `chore(agents):` PR
  (§9.10), and seven new rows: `F1.15`, `F4.57`–`F4.62`.

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
- **Unblocks:** F1.8, F1.9 — both merged 2026-08-20.
- **F1.8 (manual telemetry entry) merged 2026-08-20** — PR
  [#110](https://github.com/GhochangFu/EMS/pull/110): `POST
  /admin/telemetry-entry/manual-readings` and the Manual Entry admin screen
  (`/admin/manual-readings`), composing with `TelemetryWriteService` (Phase A,
  merged in PR #108) rather than re-implementing its catalog/unit-precedence/
  retention logic. **Notable:** a live Docker-stack verification pass (real
  Keycloak logins as all three seeded roles, not a mock) found a real bug in
  the shared `HierarchyFilterBar` component — the locations query was gated on
  the raw, never-set `organizationId` instead of the resolved locked-org id,
  silently emptying the whole location→RTU→asset cascade for every
  non-global-admin user on any screen using the picker. Fixed via TDD
  (`resolveEffectiveOrganizationId`); this was not caught by any prior review
  pass, only by driving the UI as a scoped user.
- **F1.9 (CSV/Excel telemetry bulk import) merged 2026-08-20** — PR
  [#109](https://github.com/GhochangFu/EMS/pull/109): `POST
  /admin/telemetry/import/preview` and `.../commit`, a pure row parser plus
  asset-code resolution composed with the same shared write path,
  scope-checked at both preview and commit so an out-of-scope `asset_code`
  and a nonexistent one are indistinguishable. **Notable:** rebasing onto
  ADR 0035's `xlsx` CDN pin (0.18.5 → 0.20.3) surfaced a second real bug —
  `cellDates: true` silently shifted every imported timestamp by the host's
  local UTC offset, for both CSV and genuine binary XLSX date cells, and
  the existing "real Excel date cell" unit test missed it because its own
  fixture builder wrote dates through the same buggy conversion on the write
  side, cancelling the read-side bug out. Fixed by decoding date-typed cells
  as raw numeric serials via `XLSX.SSF.parse_date_code` + `Date.UTC`, and
  text cells via `Date.parse` — both host-timezone-independent. Confirmed
  live: an explicit-offset timestamp uploaded through the real page landed
  in the database at the exact correct UTC instant.
- **Merge conflict:** #109 and #110 both independently edited
  `apps/api/src/admin/admin.module.ts`, `packages/shared/src/index.ts`,
  `vitest.config.ts` and `docs/BACKLOG.md` (each ratcheting coverage
  thresholds from their own isolated measurement). Resolved by hand after
  #110 merged first; coverage thresholds re-measured against the combined
  codebase (94 files / 286 tests: 47.5/43.34/48.55/47.61%) rather than
  trusting either PR's pre-merge number.
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
  and never been readable. Global admin only as shipped — widened to
  `organization_admin` for its own organizations' rows by **ADR 0046**
  (`E7.1e`, PR #188), which also rules that a scoped reader never sees a
  `NULL`-organization row. **The projection narrowed with the audience**
  (Amendment 2, `E7.1h`, PR #191): a scoped reader keeps `actorEmail` — the
  answer to *"who changed this"*, which the ledger exists to give — and never
  sees the acting operator's `oidcSubject`, removed in SQL. The writers still
  record it; the global admin's view is the forensic record.
  Offset-paginated with a `(created_at, id)`
  tie-break so pages are stable, export bounded by a required ≤366-day window
  and a 50,000-row cap that **refuses rather than truncates**. `E7.1i` (PR #196)
  added `audit_log_organization_created_idx` on
  `(organization_id, created_at DESC, id DESC)` to match that filter and
  tie-break, keeping the original chronological index for the unscoped read —
  though at present data volume the planner still prefers the old index plus an
  incremental sort, so the benefit is banked against growth rather than realised
  today.
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

### Alarm enrichment schema (`E2.1`, ADR 0034) — done

- **Status:** merged 2026-08-19 (PR #102).
- **What it was.** The backlog row named seven fields — root cause, impact,
  affected assets, corrective actions, energy/water/production impact, ETR,
  skills. `E2.1` shipped the full row: a companion table to `bms.alarms`
  (`bms.alarm_enrichments`, one row per alarm, `ON DELETE CASCADE`), a join
  table for affected assets (`bms.alarm_affected_assets`), and a fourth open
  vocabulary — `bms.alarm_skills` — in the ADR 0031/0032 shape. Two endpoints:
  a read-time `GET /api/v1/alarms/:id/details` pairing the current value
  beside its threshold (the backlog row's cheapest useful piece, needing no
  schema at all), and `PUT /api/v1/alarms/:id/enrichment` to author the rest.
- **Companion table, not new `alarms` columns.** `F3.10`'s pending
  `bms.alarms.cleared_at` addition was the reason: two backlog items altering
  the same table around the same time is exactly the collision a separate
  table avoids.
- **`skill` is coded; the rest stays free text.** Nothing today routes a work
  order by skill or aggregates impact numerically — the owner ruled that
  `E2.1`'s own reason for existing (telling an operator which trade to call)
  is what closes `skill`, not the amended §4.8 "engine must understand it"
  test alone. `TemplateAlarmPhilosophy.skill` (ADR 0019) tightened the same
  way, from free text to the same vocabulary — safe with no backfill, since
  no seed content had ever populated it.
- **Review found a real security gap, not a hypothetical one.** The
  enrichment write's affected-asset "replace" scoped the *insert* side against
  the caller's readable assets but not the *delete* side: a scoped caller's
  edit was silently destroying links to assets outside their access before
  re-inserting their own set. Reproduced with a failing integration test
  first, then fixed — the delete is now scoped the same way the pre-write
  check is. Three more findings, each with a test: the `PUT` route was
  missing from the OpenAPI registry (found independently by three of four
  reviewers); the request-body schema was declared in `packages/shared`
  rather than `apps/api`, against AGENTS.md §3; and two tests asserted on a
  caught error's message alone rather than `instanceof BadRequestException`
  first, the same weak-catch class caught once already mid-build.
- **The panel shipped short of the ADR's own decision, and the gap is
  recorded rather than hidden.** ADR 0034 decision 1 was to ship the full row
  in one PR. Compliance and code review both caught the web panel rendering
  only 3 of 8 enrichment fields and no affected-asset editor; extended to all
  8 read/write fields in the same fix pass. An add/remove editor for affected
  assets is still not built — the API and its scope guard are, and tested —
  called out inline in the panel rather than silently absent.
- **The affected-asset picker landed 2026-08-19** (PR #104): a search-and-toggle
  checkbox list over `GET /api/v1/assets` — already scoped server-side to the
  caller's readable assets, the same set the write endpoint independently
  checks `affectedAssetIds` against — with `filterAssetsByQuery`/
  `toggleAssetSelection` in `lib/`, tested first. No existing multi-select
  pattern existed anywhere in the repo to reuse; a checkbox list sidesteps the
  `F4.44` no-matching-`<option>` trap entirely rather than needing to guard
  against it. `docs/BACKLOG.md`'s `E2.1` row is flipped to `✅`.
- **Nothing still owed on `E2.1` itself.** `E2.2` (template alarm philosophy
  knowledge base) lists `E1.7` (✅) and `E2.1` (✅) as its dependencies and is
  now unblocked. `E2.3` (AI-assisted root-cause suggestions) also needs `E1.2`
  (multi-variate anomaly detection), still `⬜`, so it stays blocked
  regardless.

### Calculation formula DSL + definition schema (`F2.3`, ADR 0036) — done

- **Status:** merged 2026-08-20 (PR #113).
- **What it was.** `E1.7`/ADR 0019 left `kpis[].expression` as an opaque
  string — `dialect: "unvalidated"` until a formula grammar existed to parse
  it against — and `template_points` had no formula column at all, so a
  derived point's *how* was undeclared. `F2.3` closes both gaps with one
  grammar: `bms-calc-v1`, a hand-rolled scalar-arithmetic DSL (numbers,
  `{pointKey}` brace references, `+ - * /`, parens, and five whitelisted
  functions — `min`, `max`, `abs`, `round`, `clamp` — each with a fixed,
  owner-ruled arity).
- **No evaluator, on purpose.** This item defines and validates the grammar;
  it computes nothing against live telemetry. That is `F2.4`'s scope, along
  with what "the current value of `{X}`" means (latest sample vs. rolling
  window) and null/stale-input/divide-by-zero handling.
- **Parser lives in `packages/shared`, not `apps/api`.** Both the API
  (write-time validation) and the authoring UI (`F2.5`, live preview —
  **shipped 2026-08-21, PR #120**) need the same grammar; a shared,
  hand-rolled parser avoids the duplication
  ADR 0026 had to clean up for CSV escaping. No new npm dependency in any
  workspace — `eval`/`new Function`/`vm` are never used, checked by a source
  scan over the `calc-dsl` directory and independently confirmed by mutation
  testing during review (a temporary `Function(...)` call was proven to fail
  the guard, then removed).
- **`template_points` gains two nullable columns**, `formula`/
  `formula_dialect` — additive, forward-only, no `CHECK` constraint. The
  `kind === "derived"` ⟺ `formula` present invariant is enforced at the Zod
  layer instead, mirroring the existing `rtuId`/`locationId` exclusivity
  precedent in the same schema file.
- **A derived point may reference measured points only, never another
  derived point — including itself.** Chaining would need dependency
  ordering and cycle detection, which is execution-engine complexity `F2.4`
  may or may not ever need; deciding it now would have been inventing
  `F2.4`'s scope on its own behalf.
- **Review found and fixed five issues, none Critical/High.** A numeric
  literal long enough to overflow to `Infinity` passed silently (now caught
  lexically); the no-eval regression test hardcoded its file/token list
  rather than scanning the directory (a future `evaluator.ts` could have
  slipped past it); a dead assertion inside an unreachable `catch`; the
  parser's own `formatCalcError` renderer was written but not yet wired into
  either validation site (fixed, so a malformed formula now names its real
  `code`/`position` instead of one generic sentence per site); and two
  overclaims in the ADR's Consequences section, narrowed during review rather
  than left standing.
- **Verified against the running stack, including a stale-container catch.**
  Integration suites ran against the live database with real derived-point
  fixtures, specifically covering `createDraftFrom` — the one write path that
  passes raw `PointRow[]` and would otherwise silently drop the new columns
  on "edit a published template". A follow-up live HTTP pass through the
  user's already-authenticated browser session caught the running `api`
  container serving code from *before* the review-round-2 fix commit — a
  well-formed 400 with a plausible but stale error message, indistinguishable
  from a real one without diffing the exact string against the source tree.
  Rebuilt and restarted before trusting the result; all five scenarios
  (valid create, malformed formula, unknown function, self-reference,
  derived-referencing-derived) then matched the current code, and the test
  rows were deleted afterward.
- **Not included, by this repo's own convention:** the `chore(agents):`
  sweep — AGENTS.md status line, §2/§3/§6, this file — is a separate
  follow-up PR filed after merge, not bundled into the feature branch (see
  `docs/BACKLOG.md` §5, "Owed `chore(agents):` promotions", ADR 0036 row).
- **Unblocks `F2.4`** (calc execution engine), which lists `F2.3` as its only
  dependency and is now eligible to start.

### Calc execution engine — streaming + scheduled (`F2.4`, ADR 0037) — done

- **Status:** merged 2026-08-21 (PR #116; the ADR alone had already merged
  separately as PR #115).
- **What it was.** `F2.3`/ADR 0036 froze `bms-calc-v1`'s grammar and parser
  but built no evaluator, no trigger, and no write path — three things ADR
  0036 named and explicitly declined to decide. `F2.4` builds all three.
- **The evaluator.** `packages/shared/src/calc-dsl/evaluate.ts`, pure — no
  clock, no I/O. Refuses a non-finite result **at the node that produced
  it**, not only the expression's root (`min({A}*{B}, 5)` refuses at the
  multiply, since a root-only check would let `min` silently absorb an
  overflowed `Infinity` back down to a finite `5`), and normalises `-0` to
  `0` everywhere, including a bare `{A}` reference. Required adding
  `position: number` to `CalcUnary`/`CalcBinary`/`CalcCall` in the AST
  (`CalcPointRef` already had one) — recorded as **ADR 0036 Amendment 1**
  rather than silently applied, since decision 4 calls the AST a component
  of a "frozen" package. What's actually frozen is the grammar (decision 1's
  production rules), which this does not touch.
- **Two trigger modes, per formula, never per engine.** `template_points`
  gains three nullable columns (migration `0036`): `calc_trigger`
  (`streaming`/`scheduled`), `calc_interval_seconds`, and
  `max_input_age_seconds` (default 300s, deliberately loose). Streaming
  mirrors `AlarmEngineService` — `hub.on("readings")`, a 60s-cached
  definition loader, one `try`/`catch` per formula. Scheduled is one
  self-scheduling `for (;;) { sweep; await sleep(...); }` loop — **never
  `setInterval`**, the same shape `apps/ingest`'s `runPollLoop` already
  uses, so no scheduling library and no §9.4 trigger.
- **The write path is the engine's own**, `CalcWriteService` — not
  `TelemetryWriteService`. No JWT (nothing to authorise), no
  `MasterDataAuditService`/`bms.audit_log` row (auditing every
  machine-generated sample would flood `F4.14`'s read API), computed
  provenance (`source_kind: 'computed'`, `rtu_id: null`), and
  `onConflictDoNothing`-only value writes — a recompute of the same instant
  is a database no-op, never an overwrite. Re-entrancy is closed twice:
  the streaming host's own input filter can never match the engine's own
  output (ADR 0036 decision 7 forbids a derived point referencing another
  derived point), and a same-instant recompute is a no-op regardless.
- **Review found and fixed a High and several correctness gaps, across two
  rounds.** First round (four agents in parallel): security found the
  scheduled host's `lastRunMs` keyed on the bare `templatePointId`, so a
  template instantiated on multiple assets let the first one processed each
  sweep starve every other one sharing it, silently, forever — no counted
  skip. Code review independently found the same line stored raw wall-clock
  time rather than a bucketed one, which drifts under variable sweep cost;
  a streaming double-evaluation bug when a batch carried fresh readings for
  more than one of a formula's refs; and the evaluator's `ref` node
  bypassing the finiteness gate every other node used. All fixed. **Second
  round, against the fix commit itself**, found by mutation-testing the
  fixes rather than reading them: the streaming double-eval regression test
  didn't actually gate (it counted `writeValues` calls, which is 1 either
  way, not values within the call); an invariant-test wiring check's regex
  matched a function's own declaration as well as its real call site; and
  the null-interval guard caught `null` but not `0` or a negative value,
  both of which hit the identical NaN trap. Also fixed, migration-reviewer
  found a latent bug (a synthesised `source_data_key` can overflow its own
  column even though the point key alone is valid, aborting a whole write
  batch instead of skipping one pair) — fixed with a pre-check.
- **Verified live, not only in tests.** Rebuilt and recreated the `api`
  container from the branch, then ran a fixture with two assets
  instantiated from one template specifically to reproduce the fixed
  cross-asset scheduler bug: both fired their scheduled derived value at
  every 15s bucket across 3 consecutive ticks, correctly isolated. Fixture
  cleaned up afterward.
- **Not included, by this repo's own convention:** the `chore(agents):`
  sweep is this document plus the AGENTS.md edits landing in the same
  follow-up PR that flips `docs/BACKLOG.md`'s `F2.4` row to done — filed
  after `F2.4`'s own PR merged, not bundled into the feature branch.
- **Unblocks `F2.5`** — since re-scoped from "calc configuration UI" to the
  full **template authoring UI** (ADR 0038), and **delivered 2026-08-21 in
  PR #120** — and `F2.6` (whose other dependency `F2.2` was already done),
  since re-scoped from "template calc-tags wired into the engine" to the
  **template version lifecycle** (ADR 0039) and **delivered 2026-08-22 in
  PR #130** — both now done. **Does not unblock `F2.8`** in practice
  despite `Depends: F2.4` being satisfied: `bms-calc-v1` still has no asset
  qualifier and no aggregate function, so `estimatePue()`'s cross-asset sum
  stays inexpressible as a derived tag without an ADR 0036 amendment or a
  site-level rollup asset — recorded on `F2.8`'s own `docs/BACKLOG.md` row.

### Template authoring UI + formula editor (`F2.5`, ADR 0038) — done

- **Status:** merged 2026-08-21 (PR #120, 36 commits squashed as `9cdc410`;
  the rulebook sweep followed as PR #121).
- **What it was.** `F2.1` shipped the template schema, `F2.3` the formula
  grammar and `F2.4` the engine that runs it — and none of the three had a
  screen. There was **no template UI in `apps/web` at all**: no client, no
  page, no reference. The row's old `4–5` estimate was sized against a host
  page that did not exist, which is why ADR 0038 re-scoped it from a
  calc-only editor to the full authoring surface at `16–20`.
- **Five tabs, and the count is the decision.** Details · Points ·
  Calculations · KPIs · Alarms, over one template *version*. The three closed
  `content` sections — `health`, `optimisation`, `dashboards` — get no tab,
  and that is held by a **source scan** rather than a type: a type cannot
  stop a sixth entry being added, and a behavioural test reading the registry
  would simply agree with whatever it found.

  > **This bullet is `F2.5`'s record and stands as written** — it is what was
  > true when `F2.5` shipped, and rewriting it would falsify the record of that
  > day (the convention `docs/BACKLOG.md:254` sets). Two things have since
  > changed, recorded here rather than edited into the sentence above:
  > **the count is six**, because `F3.1e` made `dashboards` the sixth tab under
  > ADR 0038 Amendment 4 — so `health` and `optimisation` are the two closed
  > sections now; and **the count is held in three places, not one**, the
  > extra two being `template-tabs.spec.ts` and `template-tab-guard.spec.ts`.
  > See *The template Dashboards tab* below.
- **One editor, two contexts.** A derived point's `formula` and a KPI's
  `expression` share the `bms-calc-v1` parser, so they share a component —
  but they share nothing else, so the rules are a discriminated union rather
  than a flag. Trigger policy belongs to Calculations and never to KPIs: a
  KPI is a read-time display value with no write path and no staleness
  policy, so ADR 0037's fields do not apply to it.
- **CodeMirror 6, and it never reaches a page that does not open it.**
  Composed from `minimalSetup`, never `basicSetup` (Amendment 1), through a
  single lazy module. **This is the first `React.lazy` boundary in an app
  that statically imports every page.** Decision 7 owed a measurement and
  gets one: the entry chunk contains **no CodeMirror at all**, the editor
  sits in its own 341.42 kB chunk, and `@codemirror/search` tree-shakes out
  of both. The scan has a positive control — swapping to `basicSetup` fires
  all five markers and costs 47,033 bytes — so the zero is evidence rather
  than a broken grep. Two traps are recorded with it: Vite mangles the
  identifier names, so only string literals survive minification, and six
  plausible markers are false positives that ship in `@codemirror/view`'s
  `baseTheme` regardless of which extensions are enabled.
- **Every rule lives in `apps/web/src/lib/` with a spec — eighteen modules.**
  Not tidiness. `apps/web`'s Vitest project runs `environment: "node"` over
  `src/**/*.test.ts`, so a `.tsx` is unreachable by every test in this
  repository, and the coverage `include` stops at `src/lib/**`. Logic left in
  a component is invisible to both gates.
- **Section 7 earned its place.** A green suite is not a deployment, and the
  browser pass found **four defects that all 483 tests could not reach**: a
  tab switch discarding unsaved edits silently across all five tabs; the new
  guard **disarming itself after a *failed* lifecycle action**, so the next
  click discarded the edit with no dialog; every server message rendering as
  its raw JSON envelope rather than the sentence; and the authoring forms
  being offered to a role that cannot save them. Each is fixed with the test
  that would have caught it.
- **The role defect is the one worth remembering.** `editable` asked "is this
  version frozen?" and never "who is looking?", so a `location_admin` saw all
  five forms editable on a draft. The lifecycle buttons *were* correctly
  hidden, so the page looked right — and pressing Save returned a correct 403
  that `clearSessionOnAuthFailure` treats as a 401, clearing the session and
  discarding the work. Found by the owner signing in as `wc-admin@bms.local`,
  which is the one check the agent could not run. Half of decision 10 had
  shipped.
- **Coverage** ratcheted three times as those defects were found and fixed,
  never lowered: 49.9/45.3/50.6/50.0 → **53.7/50.0/55.3/53.8**, measured at
  54.04 · 50.32 · 55.61 · 54.11 with **131 files / 483 tests and none
  skipped**. The gate was checked in both directions — raising statements to
  99 confirms it exits 1 rather than passing silently.
- **No API change, no migration, no seed** (decision 8), verified by filtering
  the diff rather than asserted. Three reviewers — correctness, security and
  AGENTS.md compliance — found **no Critical, High or Blocking** issue.
- **Raised rather than smuggled in.** `F4.52`: a 403 clears the session,
  shared across 42 `adminFetch` call sites, which also makes decision 10's
  residual case impossible as written — the org-scope 403 cannot render
  inline because the user is logged out first. `E2.4`: template alarms reach
  no rule engine, deliberate per ADR 0019 §3 and verified in code here,
  mitigated for now by turning the Alarms banner from a disclaimer into an
  instruction.
- ~~**Still unverified:** the org-scope 403 in the browser.~~ **Verified
  2026-08-22 by `F4.52`** (see that section below). Opening an out-of-scope
  template by URL as `phe-admin@bms.local` now renders *"Template is outside
  your access scope"* inline with the session intact — and since `F4.63`
  (2026-08-23) it does so after **one** request rather than four. The blocker was not the
  second sign-in but the session clear — and decision 10's residual case is
  the **read** path, while D10's own text quotes the **write** path.

### Template version lifecycle (`F2.6`, ADR 0039) — done

- **Status:** merged 2026-08-22 (PR #130, 18 commits squashed as `9f56e46`;
  the rulebook sweep followed as PR #131).
- **What it was, and what the row's old title got wrong.** The row said
  "template calc-tags wired into the calc engine" — work `F2.4` had already
  shipped, since ADR 0037 put the calc columns on `template_points` and the
  engine resolved them at runtime. Nothing was left to wire. What actually
  remained is what ADR 0037 *Consequences* and ADR 0038 *Not in this ADR*
  both hand over in the same words: **how a new version's formula changes
  reach assets already built from the old one**. `F2.5` shipped the surface
  that creates version N+1 and nothing consumed it — an author could publish
  an edit and it reached no asset, by construction.
- **Two mechanisms, deliberately separate.** *Migration* re-pins
  `assets.template_id` between published versions of the same code:
  explicit, previewed as a version delta, audited. Not follow-the-latest,
  which is far less code but lets a publish silently change what a live
  plant computes. *Overrides* let one asset depart from its version on one
  point, in five nullable columns on `asset_points`.
- **It refuses rather than reconciles.** A delta that removes or re-keys a
  `measured` point is refused by name — that `asset_points` row is physical
  wiring `apps/ingest` and the rule engine read, and no automatic
  reconciliation of it is honest. So are a required measured addition whose
  pattern needs a token beyond `{asset_code}` (instantiation takes the rest
  per request and never stores them), a domain change, and a measured
  addition onto a point key the asset already has a row for. **No backfill,
  and no marker on history** — a series whose formula changed midway is an
  accepted, recorded hazard.
- **The asymmetry that made it tractable.** `template_points.kind` splits
  the problem. `measured` points become physical `asset_points` rows, so
  reaching them means touching live ingest wiring. `derived` points are not
  instantiated at all — their formula is read at evaluation time from the
  pinned version, so **re-pinning is the whole mechanism**.
- **The highest-risk line, and why a test scans for it.** Resolution is
  `coalesce(asset_points.<col>, template_points.<col>)`, per column,
  asset-first, over a LEFT JOIN. Every way of getting it wrong computes a
  wrong number *silently*: an INNER join drops every derived point with no
  `asset_points` row — the normal state; a reversed coalesce makes every
  override inert; a whole-row coalesce lets one override blank four
  inherited values. None throws, and every calc unit test constructs its
  dependencies directly, so reverting the query to a template-only `SELECT`
  leaves the whole suite green. `tests/adr-0039-resolution-merge.test.ts`
  scans the source for it, and the nine-case matrix was mutation-tested
  column by column.
- **What review caught.** Four reviewers found five real defects. The
  sharpest: an override formula could reference a **derived** point,
  including itself — the template authoring path forbids exactly that, and
  this endpoint is a second author for the same engine. On a `scheduled`
  trigger it compounds every interval until non-finite, because the
  scheduler stamps a fresh wall-clock bucket each tick so
  `ON CONFLICT DO NOTHING` never dedupes the series. Also: a raw 23505
  inside the transaction of a service whose contract is that every fallible
  decision precedes it; a read-then-insert race that turned a first computed
  value into a 500; a `computed` row that could be re-keyed from the mapping
  surface; and a join missing its `source_kind` filter — behaviour-neutral
  today, which is exactly why nothing caught it.
- **The `.tsx` gap was closed by hand.** `apps/web`'s Vitest project runs
  `environment: "node"` and the coverage `include` stops at `src/lib/**`, so
  a component is unreachable by every test in this repository. Both surfaces
  were therefore driven against the running stack, and the wiring that no
  test can see — query keys, invalidation, disabled reasons — was verified
  by clicking it.
- **Not included, by this repo's own convention:** the `chore(agents):`
  sweep is AGENTS.md (PR #131) and this document plus the `docs/BACKLOG.md`
  flip, filed after the feature PR merged rather than bundled into it.
- **Five follow-ups raised rather than smuggled in:** `F4.54` (the seed
  sweeps transient test assets into asset groups, making them permanently
  undeletable), `F4.55` (the `F4.1` aggregate teardown deadlocks against its
  own refresh policy and wedges the database), `F4.56` (the instantiate
  dialog collects no `sourceDataKeyVars`, so a tokenised pattern cannot be
  instantiated from the browser at all), new evidence appended to `F4.53`,
  and a comment-only correction to migration `0037`'s header that the
  drizzle hook correctly refuses to let an agent make.


### A 403 keeps the session (`F4.52`, ADR 0038 D10) — done

- **Status:** merged 2026-08-22 (PR #136, three commits squashed as
  `952165b`). No ADR — no new dependency, no schema change, no §10
  promotion; a defect fix inside merged `F2.5` / ADR 0038 scope.
- **The defect.** `clearSessionOnAuthFailure` treated **403 exactly like
  401** and cleared the session, so an authorization refusal logged the user
  out of a valid session and discarded whatever they had typed. The two do
  not mean the same thing: 401 is *we do not know who you are*, where
  dropping the token is the repair; 403 is *we know exactly who you are and
  you may not do this*, where the session is fine. Found during the `F2.5`
  section 7 browser pass and confirmed from two roles — a refused **save**
  as `wc-admin@bms.local`, and a refused **read** as `phe-admin@bms.local`
  opening an out-of-scope template by URL.
- **The ruling.** Option A: narrow the helper to 401 only, rather than
  pushing the decision out to each of the 42 `adminFetch` call sites.
- **Why the narrowing is safe, checked before any code was written.** No 403
  in this API becomes a success by signing in again. `JwtAuthGuard` is the
  only `CanActivate` in the app and throws `UnauthorizedException` for a
  missing, malformed, expired or unverifiable token in both the local and
  the OIDC path; there is no global guard and no exception filter that could
  remap a status. **One 403 carries no principal at all** — `audit.service.ts`
  refuses a valid token whose subject matches no `users` row — and it argues
  *for* the change, because re-authentication cannot provision an account and
  clearing the session there would loop the login. That case is why the first
  docblock wording ("every 403 is an authorization decision about a known
  user") was wrong and was narrowed.
- **It made ADR 0038 decision 10 reachable, then had to finish the job.** D10
  says the organization-scope case "falls through to the API's 403, rendered
  inline". The renderer was always there; the session clear was what stopped
  it running. Making the path reachable exposed a second defect nobody could
  previously see — the branch rendered the whole body,
  `{"message":"…","error":"Forbidden","statusCode":403}`, not the sentence.
  D10 asks for the message, so that belonged to this item rather than a
  follow-up. **D10 is now true as written, with no amendment owed** — though
  the two halves were verified by different routes: D10's text quotes the
  *write* path, while what was measured in the browser is the *read* path.
- **What the reviews caught, and both were real.** Three reviewers returned no
  Blocking, Critical or High finding. They did find that the premise the whole
  fix rests on was **prose in a docblock**, and that the render fix **shipped
  with no gate at all** — proved by reverting the line and watching 312 tests
  stay green. Both are now mutation-proved gates:
  `tests/f4.52-auth-failure-status.test.ts` (the guard throws no
  `ForbiddenException`, and no global guard or filter can remap a status) and
  a D10 scan in `tests/adr-0038-template-authoring-ui.test.ts` scoped to the
  load-error branch so the tab handlers cannot satisfy it.
- **Verified:** `pnpm typecheck` and `typecheck:tests` clean, **145 files /
  586 tests with none skipped**, coverage 56.73 · 52.97 · 58.75 · 56.71
  against thresholds 53.7/50.0/55.3/53.8. Both directions were run against
  the **rebuilt container**, with the served bundle checked for `===403`
  after each rebuild rather than assumed.
- **Known cost, accepted.** The API authorizes on the *database* role while
  the UI gates on the role claim stored at login, so a mid-session downgrade
  now leaves a stale menu until the token expires. The old behaviour resynced
  it only by destroying a valid session on every ordinary refusal.
- **Three things raised rather than smuggled in** — two of them now closed.
  `F4.63` (the `QueryClient` default `retry: 3` made a 403 cost four requests
  and ~40s before the message rendered) — **done 2026-08-23**, see below.
  `F4.64` (a 403 body interpolated an out-of-scope asset code,
  `asset-templates-migrate.service.ts:393`) — **done 2026-08-23**, see below.
  Still open: two sibling render sites showing a raw envelope
  (`asset-templates-page.tsx:192`, `alarm-details-panel.tsx:205` — neither
  newly reachable, so neither was folded in).


### A refusal costs one request (`F4.63`) — done

**2026-08-23, PRs #141, #142, #143.** `main.tsx` built a bare `new
QueryClient()`, so every query took the library default `retry: 3`. An
out-of-scope template read cost **four** 403s and ~40s of "Loading…" before the
refusal rendered. Invisible before `F4.52` — the first 403 ended the flow at
`/login`.

- **`ApiError` at the one `adminFetch` throw site.** The row called this the
  42-call-site chokepoint `F4.52` declined to touch; it is not. That declined a
  *breaking* change, and a subclass whose `message` is byte-identical breaks
  none of them. Owner ruled it on that basis, and ruled no ADR.
- **The predicate is conservative by ruling.** Only an `ApiError` with a 4xx
  other than 408/429 stops retrying. The ~20 clients that throw a statusless
  `Error` — `alarms.ts`, `dashboard.ts`, `energy-dashboard.ts`, `locations.ts`,
  `assets.ts` — behave exactly as before. The tidier rule would have changed
  every dashboard query for a defect measured on one admin path.
- **The retry budget was read, not assumed.** `failureCount` is `0` on the
  first failure (`query-core@5.100.5` `retryer.js`: read at line 89, incremented
  at line 94). The spec helper modelled it 1-based first; the library settled it.
- **Measured in the browser, same account and route as the defect.** As
  `phe-admin@bms.local`, after hard-reloading until DOM and server agreed on
  `index-Cs6Mz63G.js`: **exactly one 403**, message in under 3s, still one after
  13s. The session survived, so `F4.52` holds too.
- **Three gates, all mutation-proved**, because the predicate's own spec is a
  tautology — deleting `defaultOptions` restores the defect and leaves it green.
  The request-count gate's mutant reproduces the defect exactly: *"got 4"*.

### A refusal counts, it does not name (`F4.64`) — done

**2026-08-23, PR #140.** `asset-templates-migrate.service.ts` refused an
out-of-scope asset by naming its code — the human-readable identifier of a row
the caller was being told they may not touch. Low severity (the ids are
caller-supplied UUIDs, so no enumeration path); the argument was consistency,
since `asset-templates-instantiate.service.ts` already collapses the same
information to a count and explains its own withholding.

- **Owner ruled (b), count rather than name** — and the row's claim that both
  fixes were one line was wrong: counting means the loop cannot short-circuit.
- **Review caught a latency claim and it was fixed in the code.** Losing the
  short-circuit is not free — `canManageAsset` costs three lookups per call and
  batches reach 200. Resolving `writableLocationIds` **once** and filtering in
  memory is one query instead of N, fewer than before on both paths.
- **The gate already existed** — the spec asserted the code *is* in the
  message. A second out-of-scope asset makes the count a count, and a
  `forbidden` regex catches what a positive match cannot: a body that satisfies
  the sentence and names the assets anyway.

### Email + webhook notifications (`F3.8`, ADR 0041 + ADR 0042) — done

**2026-08-23, PR #147, merged as `c79b770`.** The last open ⭐ enabler in slot
2, and the thing `F3.7`, `F3.9` and `F3.10` were all waiting on: rules have
stored a `notify` action since `F3.6` with nothing on the other end of it.
Nine plan units, all four §4.6 layers, one migration adding four tables.

- **Inline and fire-and-forget, deliberately.** Decision 1 rejected a queue and
  Redis for this row. The load-bearing consequence is that `dispatch()` never
  rejects: a transport failure becomes a `failed` delivery row rather than an
  exception thrown back into the alarm path that raised it.
- **A delivery row for every attempt, including the ones that send nothing.**
  Three of the five statuses are skips. "No notification arrived" and "no
  notification was attempted" are different answers to an operator, and only
  the ledger can distinguish them.
- **The owner ruled against deferring the UI**, so the channel screen, the
  deliveries view and the readiness banner shipped inside the row — an item
  closed with its browser layer marked N/A is not closed. Effort moved `4–6` →
  `7–9` to pay for it.
- **The review gates found four defects the build did not.** An IPv4-mapped
  IPv6 bypass of the webhook egress guard, where the existing tests asserted the
  dotted form `new URL()` never produces and were exercising an unreachable
  branch; both `/rules/:id/notifications` routes missing the §4.7 scope check,
  so a location-scoped admin could redirect or silence another site's alarms;
  the channel admin gate reading the role from the token rather than
  `bms.users`; and no audit row for channel writes. Each fix has a test that
  fails without it.
- **CI found a fifth, and it could not have been found locally.** ADR 0042 named
  `jsdom` without a version; pnpm took `30.0.1`, which needs Node ≥ 22 through
  `undici@8`. This repository ships **Node 20** — both CI jobs and all four
  Dockerfiles. The build machine runs Node 24, so the local suite reported 636
  passing while CI could not start the two component workers at all. Pinned to
  `jsdom@^29.1.1`, whose `undici@7` guards the call rather than merely declaring
  a floor.
- **A version in one package did not bound the workspace.** `vitest` lists
  `jsdom` as an optional peer and `autoInstallPeers` gave the *root* importer
  the newest one regardless — and the root is the `vitest` CI runs. The
  resolution survived `install`, `dedupe`, `--force` and deleting
  `pnpm-lock.yaml` outright, because it was never stale. Only a root
  `pnpm.overrides` entry moved it. ADR 0042 Amendment 1 records it so the next
  bump does not rediscover it.
- **Left open on purpose:** the kind vocabulary is a lookup table, but the admin
  UI hardcodes two `<option>`s and the transport lookup is a `switch`, so `sms`
  needs no DDL and does need code — that is `F3.9`. **Raised, not fixed:** no
  `package.json` in the repository declares `engines`, which is the general
  defect behind the jsdom failure.

### Non-superuser table owner — makes `FORCE ROW LEVEL SECURITY` bind (`F4.16`, ADR 0043 decision 8 + ADR 0044) — done

**2026-08-24, PR #151.** `bms_app` (the database owner) stopped being the
API's runtime role — `bms_tenant` (policy-filtered) and `bms_fleet`
(`BYPASSRLS`, for reads a scope filter already covers) took over, split by a
`DATABASE_URL_TENANT`/`DATABASE_URL_FLEET` pair and a second `pg.Pool` in
`DatabaseModule`. Amendment 1 added a third role, `bms_auth`, for the
pre-tenant identity read login needs before an organization is known — there
is no `SET LOCAL` target during authentication — and moved the
`password_hash` revoke from `bms_tenant` into this migration rather than
leaving it for `E7.1`.

- **The closing review found and fixed a pre-existing fail-open gap** in
  `resolveDbUser`: an unprovisioned `admin` JWT claim resolved to unrestricted
  access rather than refusing. Closed as its own ADR, **ADR 0044**, because the
  fix reaches every `/admin/*` endpoint, not only this one.
- **Real-role RLS coverage was added for `locations`/`point_keys`**, both
  previously zero-coverage against a non-owner role.
- **Unblocked `E7.1`** — ADR 0043 decision 4 makes this a hard prerequisite:
  RLS without a non-owner connection role is theatre, since an owner bypasses
  every policy regardless of `FORCE`.

Mirrored into: AGENTS.md status line and §2 *Database roles* row (the role
inventory only — see the section below for the tenancy semantics this
migration made possible but did not itself add).

### Multi-tenant architecture — RLS, role split and org scoping (`E7.1a`–`E7.1d`, `E7.1g`, ADR 0043) — done

**2026-08-24 through 2026-08-28, PRs #155/#162/#166/#169/#180.** ADR 0043 and
its five amendments, plus ADR 0044 and ADR 0045. Split into four children at
the §10 gate because the counted write blast radius (~65 sites across the
decision-5 tables) and ADR 0045's owner-role work did not fit the original
`14–20` estimate. **All four children are now delivered.**

- **`E7.1a`** (ADR 0045, PR #155) gave the schema a non-superuser owner,
  `bms_owner`, so `FORCE ROW LEVEL SECURITY` — a no-op under the superuser
  `bms_app` — actually binds, plus a sixth role `bms_rollup` for the four
  continuous aggregates, which `refresh_continuous_aggregate` requires
  ownership for and no `GRANT` can substitute.
- **`E7.1b`** (PR #162) added `organization_id NOT NULL` and a
  `tenant_isolation` policy to the decision-5 table set (migrations
  `0046`/`0047`), wrapped the ~65 write sites in `withTenant`, and conformed
  the five decision-1 list reads (`alarms`, `work-orders`, `maintenance`,
  `rules.listRules`/`listExecutions`) to Amendment 3's hybrid read rule —
  `withTenant` by default, `fleetDb` with a named reason. Amendment 4 gave
  `bms.users` a nullable home organization for the global admin.
- **`E7.1c`** (PR #166 slice 1, PR #169 slice 2, squash `1586c48`) closed the
  post-write read-back residual `E7.1b` deferred, moved
  `notification_channels`/`automation_rules` identity to
  `(organization_id, code)`, added `AccessControlService.canManageNotificationChannel`
  (AGENTS.md §4.7's fifth gate), and — Amendment 5 — role-scoped the
  `NULL`-organization `WITH CHECK` branch `TO bms_fleet` on the four tables
  that carried it, closing a defect where a plain `bms_tenant` `INSERT` of a
  NULL-org row succeeded although `RETURNING` made it look refused. Suites at
  merge: api 358/358, repo 320/320, web 202/202, both typechecks exit 0. Four
  reviews found no Critical, no High; two false greens and two real defects
  (a rule wirable to a foreign org's channel; the read gate wider than the
  write gate) were fixed.
- **`E7.1d`** (PR #180, squash `af40aaa`) split the `F3.8` admin UI. The gates
  were wrong in both directions: the two master-data tabs were still
  `globalAdminOnly`, so an `organization_admin` never saw screens the API had
  served it since `E7.1c`, while the routes used a bare `AdminRoute` whose
  `isMasterDataAdmin` admits `location_admin` — and `ChannelsService.list`
  returns `[]` for that role, so the page was reachable by URL and answered
  with an empty table indistinguishable from an empty tenant. Both now gate on
  `canManageNotificationChannels`. The create form gained the organization
  picker `NotificationsService.sendTest` had been naming in its own 400 since
  `E7.1c`; until then the only channel the UI could create was fleet-wide, and
  a fleet-wide channel cannot be send-tested at all. Both tables name the
  owning tenant, and the readiness banner is untouched (ADR 0041 decision 10).
  Three reviews found no Critical, no High; six findings fixed, and a seventh
  found while fixing — `isPending` is false on error too, so a *failed*
  organization list rendered "You administer no active organization", a
  tenancy claim drawn from a request that never answered.
- **`E7.1g`** (Amendment 6, PR #185, squash `437cdfc`) closed the disclosure
  the `E7.1d` security review found in the screen `E7.1d` had just shipped.
  `ChannelsService.listDeliveries` filtered on the delivery's
  `organization_id` and never tested the joined channel's own — and decision 7
  keeps a fleet-managed global *shareable*, so a global admin can wire one
  onto a tenant's rule, `record()` stamps the rule's organization, and the
  tenant then reads a fleet channel's code beside a resolved internal hostname
  out of `error`. **Redact the detail, keep the code:** `error` is blanked for
  a non-`admin` caller when the joined channel's organization is `NULL`;
  `channelCode` stays, because ADR 0041 decision 10 needs a failed delivery to
  remain identifiable. One `CASE`, in SQL, keyed on the caller's role.
- **`telemetry.*` is untouched throughout** (decision 9) — no column, no
  policy; isolation stays `readableAssetIds`, by design.

Mirrored into: AGENTS.md status line, §2 *Tenancy* row (new), *Secrets* row and
*Audit read* row, *Operations* row, §4.3/§4.4, §4.7's fifth gate and all
**three** projection rules — ADR 0043 Amendment 6, ADR 0046 Amendment 2 and ADR
0046 Amendment 3, cross-linked there because each fires on a different trigger
and none generalises alone — and §6 (narrowed,
not deleted — per-org SMTP relays, white-label branding, a `platform_admin`
rung and `telemetry.*` RLS all stay deferred).

`E7.1e` (the org-scoped `bms.audit_log` reader, gated by **ADR 0046**) landed
2026-08-28 as PR #188, and `E7.1h` (its projection half, Amendment 2) as
PR #191 the same day, and `E7.1i` (the index behind the scoped read) as PR #196.
**`E7.1f` is done** (PR [#199](https://github.com/GhochangFu/EMS/pull/199),
squash `cf5e230`), gated by **ADR 0029** Amendment 3 and its Errata 1
(PR [#198](https://github.com/GhochangFu/EMS/pull/198), squash `be19046`), so
**every child of the `E7.1` split is now closed.** The line above this one has
been wrong twice before — it once named `E7.1f` last while `E7.1i` was open and
filed in the same pass, then named two while `E7.1i` was in flight — so re-check
it whenever an `E7.1x` appears rather than trusting it.

Two things `E7.1f` produced that outlive it. **Errata 1 withdrew the premise of
the amendment that gated it**: `.strict()` changes no byte of the generated
document, because a plain `z.object` already emits `additionalProperties:
false`. That inverts the defect — the document had published the strict contract
since `F4.20` while the server accepted the key, so the server was more
permissive than its own published contract. And the audit's method was corrected
mid-flight: asking "is an unknown key a caller error?" assumes there is one
caller, and the onboarding draft has three (the PATCH, the stored draft carrying
`_secrets`, and the model's `draftPatch`). Making it strict deadlocked the
ADR 0022 pilot and silently discarded LLM patches — neither visible to
`pnpm test`, because `_secrets` needs `CREDENTIAL_ENCRYPTION_KEY` and CI does
not set it. Those seven nodes stay permissive with the reason recorded.

`E7.1e`'s own reviews raised three follow-ups, all Wave 5. **`E7.1h` is done**
(PR #191, squash `a62e707`): a non-`admin` reader keeps `actorEmail` and never
sees the acting operator's `oidcSubject`, removed in SQL and keyed on the
database role. Its own reviews then raised two more, both landed as PR #192
(`f56cb4f`) — a static guard holding the *writers* to a top-level key, since the
jsonb `-` operator reaches nothing deeper, and **`E8.6`**, which found the same
operator subject in a second table: `rule_executions.trace.evaluatedBy`, reached
by a *wider* audience, because `GET /rules/executions` has no role gate at all.
**`E8.6` is now done too** (PR #194, squash `b13db40`), ruled as **ADR 0046
Amendment 3** before any code — the third instance of one projection rule. It
**removes without replacing**: unlike the audit log, where `actorEmail` survives
because a ledger must answer *"who changed this"*, a scoped reader of a trace
gets no evaluator at all, because `F3.6` chose `sub` *instead of* the email
rather than alongside it. That asymmetry is decision 8 and is recorded so the
obvious later "fix" — mirroring Amendment 2 and adding the email — is seen for
what it would be: disclosing plaintext addresses to `operator` and `viewer`, an
audience wider than Amendment 2 ever exposed. The now-dead `F3.6` justification
was corrected in the same commit. **`E7.1i` is also done** (PR #196, squash
`196a856`): migration `0049` adds
`audit_log_organization_created_idx` on
`bms.audit_log (organization_id, created_at DESC, id DESC)` and keeps the
original chronological index for unscoped reads — availability, not disclosure.
Its own measurement is the part to carry: **at current volume the planner still
prefers the old index plus an incremental sort**, and picks the new one only
with incremental sort disabled, so this is write cost now for a read benefit
that arrives with growth. **Still open:** `E8.5` bounds or scrubs the
`rtus.meta` value space that ADR 0021 decision 6's re-measurement could not
clear by field name.

### Configurable dashboard vocabulary and schema (`F3.1a`, ADR 0047) — done

`F3.1` — *configurable dashboard schema + builder UI* — was the largest single
row left in Wave 1, and on 2026-08-28 the owner split it into five children at
the §10 gate under **[ADR 0047](./adr/0047-configurable-dashboards.md)**, on the
`E7.1` precedent. `F3.1a` is the first and the only ⭐ one: it defines the widget
vocabulary and the schema every other child hangs off. It merged 2026-08-29 as
PR [#202](https://github.com/GhochangFu/EMS/pull/202), squash `b0b4f3f`, with the
ADR landing first as PR [#201](https://github.com/GhochangFu/EMS/pull/201).

**Six decisions were put to the owner one at a time and all six were ruled
before any implementation code. Four went as recommended; two changed the
draft.** The load-bearing one is decision 2: **`widgetType` is a closed
`z.enum` with a SQL `CHECK`, not a lookup table** — deliberately the *opposite*
of what ADR 0031 and ADR 0032 decided for rule concerns, plant domains and alarm
severities. The reason is ADR 0032's own test, applied rather than reversed: *a
vocabulary is only closed if the behaviour cannot be carried as data.* A
severity's behaviour is `rank` and `tone`, which are two columns; **a widget
type's behaviour is a React component, and no column holds one.** A type
declared by an `INSERT` would pass the foreign key, the API and the save, and
then draw a blank rectangle in front of an operator with nothing in the console,
the log or the network tab. `AGENTS.md` §4.8 now carries this as its first
worked example of the *closed* answer, because every example there since ADR
0031 moves a vocabulary the other way and a reader could otherwise conclude that
open is the destination rather than an answer.

The second decision that changed the draft came from the owner asking how an
admin adds a widget to the shared palette. The answer is that a new *kind* is
always a release — so the lever that matters is absorbing chart-shaped asks into
configuration. §7's three *Key Parameters* widgets (`radial_gauge`, `tank_level`,
`value_tile`) are taken verbatim, and its "24-hour area chart" becomes one
generic **`chart`** whose `config` selects line, area, bar or scatter from
ECharts. The builder will show *Trend* / *Comparison bars* / *Scatter*, never
ECharts series names. The radial gauge is **not** merged into it despite also
being an ECharts series: its config surface (min, max, thresholds, bands) is
disjoint from a cartesian chart's, and merging would put two unrelated halves in
one form in front of a non-programmer.

**What shipped is the schema half only.** Migration `0050` creates
`bms.dashboards`, `bms.dashboard_widgets` and `bms.dashboard_widget_points` with
`organization_id NOT NULL`, a `tenant_isolation` policy and `FORCE ROW LEVEL
SECURITY` in the creating migration — ADR 0043/0045's rule, followed the first
time rather than retrofitted the way `E7.1b`'s migrations `0046`/`0047` had to
be. The third table is the point of the design: a widget binds live
`bms.asset_points` rows through a real foreign key, where ADR 0019 had to
hand-build the equivalent orphan check because template `content` is `jsonb`.
The vocabulary and the per-type `config` union live in
`packages/shared/src/contracts/dashboard-builder.ts`; the drizzle declarations in
`packages/db/src/schema/dashboard-schema.ts`.

**The security review found one HIGH and proved it on the running stack**, which
is the part of this row worth carrying forward to anything else that stamps a
denormalised `organization_id`: **Postgres runs a referential-integrity check
with row security off**, so a foreign key never consults the parent's policy. A
correctly-stamped row bound another tenant's point and the `INSERT` succeeded.
The three tables *looked* like they met the standard `bms.asset_group_members`
sets in migration `0047` §3c while enforcing strictly less than it. Every policy
now checks its org-bearing parents with an `EXISTS`, in `USING` and in `WITH
CHECK`, verified live in both directions.

`F3.1a` also **opens ADR 0019's `dashboards` content section past ordered point
keys** — the third of the five reopenings ADR 0019 predicted, after `kpis`
(`F2.3`) and `alarms.philosophy` (`E2.1`). `TemplateDashboardView` carries
`widgets[]`, and `collectContentPointRefs` walks `widgets[].pointKeys`, so the
orphan check reaches the new half on create, update and publish.

**Nothing is still open: the `F3.1` umbrella closed 2026-08-30.** `F3.1b` (the
tenant-scoped read/write API) and `F3.1c` (the four renderers) **landed
2026-08-29** — PR [#210](https://github.com/GhochangFu/EMS/pull/210), squash
`4d1cfcd`, and PR [#211](https://github.com/GhochangFu/EMS/pull/211), squash
`6692af3` — and `F3.1d` (the builder surface and the viewer route) landed the
next day as PR [#215](https://github.com/GhochangFu/EMS/pull/215), squash
`2a79a42`.

They were planned as *"a genuine two-agent batch on disjoint packages"*, and
**the file-level claim held while the vocabulary-level one did not.** Neither
branch touched a file the other did. But `F3.1e` merged between them, and it had
independently written the same four chart-series labels and four widget-type
labels that ADR 0047 Amendment 2 §4 rules once — caught in CI by `F3.1c`'s own
source scan, not by review. The labels now derive from `widget-catalog.ts`.

Worth carrying into the next parallel batch: **"disjoint files" is not
"disjoint decisions"**. Two rows in one wave can share no source file and still
restate the same ruling, and the thing that caught it was an executable scan
that a third row happened to trip.

### The dashboard read/write API and the four renderers (`F3.1b` ‖ `F3.1c`) — done

**Done 2026-08-29.** `F3.1b` gives CRUD over the three tables, tenant-scoped,
in the ADR 0017 write matrix and audit-stamped; `F3.1c` gives the four
renderers behind an exhaustive dispatcher. Both closure records, with the
findings, are in [`BACKLOG.md`](./BACKLOG.md).

**Two are worth repeating here because they are about method, not about
dashboards.** `F3.1b`'s ruling-2 authorization guard — the check ADR 0047
Amendment 2 itself names as *"the case a later refactor is most likely to
lose"* — shipped as **dead code**, short-circuited by two earlier null guards,
and deleting it left the suite green; it now throws instead of falling through,
so removing it is a named crash. And `F3.1c`'s §4.6 browser pass found two
defects that **no test in the row could reach** — a gauge readout drawn across
its own dial, and a 13-character string in a 100-unit viewBox — because both
are geometry, and every spec in that row asserts numbers and strings.

**What was still missing after both:** nothing assembled a stored dashboard into
a page. The renderers take a widget and data as props; the route, the grid
layout and the point binding were `F3.1d`, and they landed the next day.

### The template *Dashboards* tab (`F3.1e`, ADR 0038 Amendment 4) — done

**Done 2026-08-29**, PR [#207](https://github.com/GhochangFu/EMS/pull/207),
squash `898b816`; its two ADR gates landed first as PR
[#206](https://github.com/GhochangFu/EMS/pull/206), squash `61ab0c5`. The
detail page moves from five tabs to six, discharging the condition ADR 0038
decision 2 wrote for itself — *"it becomes a tab when `F3.1` gives it
widgets"* — after `F3.1a` gave it widgets.

**The count was held in three executable places, not the one every document
named.** The source scan is the famous one; `template-tabs.spec.ts` is a
second; and `template-tab-guard.spec.ts` is a third that holds it
**arithmetically**, as a count of ordered tab pairs (`n(n-1)`, so six tabs give
thirty). That file never contains the word "five", so a search for the tab
count does not find it. A compliance review found it before the amendment
merged — after the amendment's own first draft had said there were two.

**`F3.1e` also discharged ADR 0047 Amendment 2's shared obligation**, which
`F3.2` would otherwise have inherited: each arm of the template widget union
now takes `WIDGET_POINT_CARDINALITY[type]` rather than one shared cap, so a
gauge binds exactly one point and a chart up to `MAX_WIDGET_POINTS`.
**Amendment 3 recorded that no stored content needed migrating, and kept the
finding falsifiable** rather than stating it as a preference.

**Effort moved `1–2` → `3–4`**: the owner ruled the full optional config set
over the plan's smaller recommendation, and the gauge's threshold-band editor
is nearly all of the increment. A correctness review found one real defect the
browser pass had missed — four view-name errors were computed and never
rendered, so a duplicate name greyed Save out with nothing above to fix, and a
blocked Save was the only thing between that and a destroyed stored view. **Dependants of the `F3.1` umbrella — `F3.2`,
`F3.5`, `E4.2`, `F3.28`, `F3.32` — unblock when the umbrella closes, not when
`F3.1a` did.** One decision is owner-gated and deferred to `F3.1b`: migration
L2, where `dashboards.location_id` and `asset_group_id` are `NO ACTION` while
`point_id` cascades, so deleting a location a dashboard is scoped to raises a
bare `23503`. Nothing deletes a location today.

### The builder surface and the viewer route (`F3.1d`, ADR 0047 Amendment 4) — done

**Done 2026-08-30**, PR [#215](https://github.com/GhochangFu/EMS/pull/215),
squash `2a79a42`; its ADR gate landed first as PR
[#214](https://github.com/GhochangFu/EMS/pull/214), squash `2dd1ab2`. **The
`F3.1` umbrella closes with it**, clearing the `F3.1` blocker on `F3.2`, `F3.5`,
`E4.2`, `F3.28` and `F3.32`. **Four of those five are now fully unblocked;
`E4.2` is not** — it depends on `E4.1, F3.1`, and `E4.1` is still `⬜`. The row's
own closure record is in [`BACKLOG.md`](./BACKLOG.md); four things belong here
because they are about method rather than about dashboards.

**A privilege escalation that every layer below the API agreed with.**
`update()` authorized the merged *destination* scope and never the *stored* one
— it asked "may you write here" and never "may you touch this row". A
`location_admin` could list an organization-wide dashboard, which read is
organization-wide by design, PATCH it with its own `locationId`, and re-home an
ownerless tenant-wide row under its site; `remove()` then deleted it, because
the stored scope was now theirs. RLS did not stop it, because every row involved
carried the right `organization_id`. **Tenant isolation is not scope
authorization**, and the two are easy to mistake for each other while the tests
are green.

**A count that was undercounted three times.** The 12-column canvas was restated
in TypeScript in three places by the brief's reckoning, four by the plan's, six
by the build's, and seven when the scan first ran. Each correction was made by
someone looking specifically for copies. The lesson is not "search harder" — it
is that a bound with more than one home needs an **executable** rule the day it
is written, because every manual count of it was wrong.

**ADR 0047's one open dependency question closed as *not needed*.** §Dependencies
made the drag/grid library a conclusion of the build rather than an input. The
conclusion is that Pointer Events plus numeric grid inputs are enough, so no
§9.4 gate was opened for the whole umbrella.

**One §4.6 check could not be completed, and is recorded rather than implied:**
pointer drag and resize on the canvas. `left_click_drag` dispatches mouse events
and the canvas listens for Pointer Events, so the browser automation cannot
drive it. The numeric grid inputs the plan names as the required affordance are
verified.

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
