# Roadmap — Eskom SMOC BMS

> **Active phase:** Part 2 / Phase 5 Sprint J/K/L/M/N — Location and
> Access hardening is open.
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
| Real protocol adapters (BACnet, Modbus, SNMP, OPC-UA, MQTT) | Phase 2 |
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
