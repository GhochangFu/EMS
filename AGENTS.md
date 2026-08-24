# AGENTS.md — TRINETRA Enterprise EMS (Ion Exchange line) (Part 2 / Phase 5 Location and Access + Onboarding & PHE Ingest)

> **Status:** ACTIVE — **SOW-driven backlog delivery** (`docs/BACKLOG.md`,
> Wave 0/1), running on the loop in `docs/build-operating-model.md`. Phase 5
> Sprint J/K/L/M/N Location and Access hardening remains open alongside it.
> Merged and in scope: the hierarchical master-data admin, the scoped AI
> onboarding wizard, and the PHE MQTT real-ingestion pilot (ADR 0007–0012);
> the Vitest gate (ADR 0014), asset templates and instantiation
> (ADR 0015), the ingest adapter framework **and its host, now the sole ingest
> entry point** (ADR 0016, §6 complete through commit 4), the
> operations write matrix (ADR 0017), the asset source-axis separation
> (ADR 0018), the template content model (ADR 0019), the audit read API
> (ADR 0021), onboarding credential capture off the chat transcript
> (ADR 0022), the telemetry continuous aggregates (**ADR 0023**), their
> compression and retention policies (**ADR 0024**), the conversion of every
> remaining rollup read onto them (**ADR 0025**), one shared CSV escaping
> rule for both exports (**ADR 0026** and its Amendments 1 and 2), the staleness
> gate in front of every
> derived status and rendered value in the web client (**ADR 0027**) and the
> provenance rule that decides which of those values is a reading at all
> (**ADR 0028**), and the OpenAPI document generated from the Zod schemas that
> validate each request (**ADR 0029**, with amendments for the refinements the
> conversion drops and for the docs being absent rather than guarded), and the
> **response** contracts that are now schemas rather than types, validated at
> the web client's boundary (**ADR 0030**, with amendments for the conversion
> spike, for what building it changed, and for the real drift its validator
> found on its first run), and the separation of a rule's **concern** from its
> plant **domain**, with both vocabularies moved out of code into
> `bms.rule_categories` / `bms.asset_domains` (**ADR 0031** and its Amendment 1,
> `F4.45`), and the alarm **severity** ladder following them into
> `bms.alarm_severities` — carrying its own `rank` and `tone`, so a level the
> client asks for is an `INSERT` rather than a migration (**ADR 0032**,
> `F4.46`), and the alarm **enrichment** schema — root cause, corrective
> actions and a fourth open vocabulary, `bms.alarm_skills`, behind
> `GET`/`PUT /api/v1/alarms/:id/(details|enrichment)` (**ADR 0034**, `E2.1`),
> and the calculation formula DSL — a hand-rolled `bms-calc-v1`
> scalar-arithmetic grammar validating `template_points.formula`/
> `.formulaDialect` and `kpis[].expression`/`.dialect`
> (**ADR 0036**, `F2.3`), and the calc execution engine that evaluates it —
> a streaming host on `TelemetryBroadcastHub` and a self-scheduling
> `for (;;)` loop (never `setInterval`), writing derived values through a
> `computed` `asset_points` row created on demand, no audit-log entry per
> decision 10 (**ADR 0037**, `F2.4`), and the **template authoring UI** that
> finally gives all of the above a screen — five tabs over one template
> version, both authored-formula surfaces on a lazily loaded CodeMirror 6
> editor with a pure in-browser preview, and a published version that renders
> read-only (**ADR 0038** and its Amendments 1–3, `F2.5`), and the
> **template version lifecycle** that finally lets a published edit reach the
> assets built from the old version — an explicit, previewed and audited
> re-pin of `assets.template_id` that refuses rather than reconciles a
> `measured` removal, re-key or domain change, plus per-asset calc overrides
> resolved as `coalesce(asset_points.<col>, template_points.<col>)` per column
> (**ADR 0039**, amending ADR 0015's identity invariant and ADR 0037
> decision 4, `F2.6`), and the **MQTT fleet** — ADR 0007 decision 4's one-RTU
> limit superseded by five RTUs *measured* publishing readable values, with
> `bms.rtus.ingest_enabled` asserted once by the seed and owned by the operator
> thereafter (**ADR 0007 Amendment 1**, `F1.7`), and the **notification
> service** — one `NotificationTransport` seam with log, email and webhook
> implementations, dispatched inline and fire-and-forget with no queue and no
> Redis, a delivery row written for every attempt *including the ones that send
> nothing*, an egress guard in front of every webhook, and the channel admin
> screens shipping inside the row rather than after it (**ADR 0041**, `F3.8`),
> which brings `nodemailer` and a Mailpit `mail` Compose profile in under §9.4
> — and, ruled mid-build once that row found the repository could not render a
> component in a test at all, **component testing for `apps/web`**: jsdom and
> Testing Library, opt-in per file, with the coverage denominator deliberately
> unchanged (**ADR 0042** and its Amendment 1, which pins the Node floor).
> General
> site-wide AI copilot, EMQX, and the **non-MQTT**
> protocol adapters remain deferred — the framework, the host and the MQTT
> adapter are promoted; each further protocol still needs its own ADR (§9.4).
> **Product brand:** TRINETRA. Powered by Euphoria Infotech India Limited.
> **Product line:** Enterprise EMS for Ion Exchange (India) Ltd. per
> **ADR 0013** — forked from the Eskom SMOC engagement (earlier branding:
> Eskom SMOC / InfraPulse). Eskom-era internal identifiers, seed demo data,
> and the `ESKOM_SMOC.html` mockups are intentionally retained; the pending
> SOW-driven scope is tracked in `docs/BACKLOG.md`.
> **North star:** see `docs/AGENTS.production.md` for the full production
> rules we will promote from as the system grows.
> **Recent scope changes:** see `docs/adr/` and `git log`. ADRs are the live
> record of what is in scope; where this file conflicts with a newer ADR, the
> **ADR is authoritative** and this file is the thing to fix. Scope moves via
> §10, and edits here move via a `chore(agents):` PR (§9.10) — which is why
> this file lags and the ADRs do not.

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
real-ingestion pilot** (ADR 0007, 0012) added `apps/ingest`, an MQTT TLS
subscriber for West Bengal PHE pump houses, plus AES-256-GCM encrypted RTU
connection credentials. **ADR 0007 Amendment 1 (accepted 2026-08-22, `F1.7`)
superseded decision 4's one-RTU limit: live ingest now covers five of the twelve
catalogued RTUs**, measured rather than chosen. These promotions are partial and scoped: general
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
   via `apps/ingest` for **the five RTUs named in
   `packages/db/src/ingest-enabled-set.ts`** — ADR 0007 Amendment 1 (2026-08-22,
   `F1.7`) superseded the one-RTU limit. **Widening that set is an owner
   decision, not an agent's**: it is a measurement about pump houses, and
   enabling a station that does not publish a readable value takes its assets
   from simulated to dead, because decision 5 makes `apps/sim` skip anything
   marked `telemetrySource='mqtt'`. Re-measure with
   `apps/ingest/scripts/fleet-probe.mjs` before proposing a change. EMQX and
   non-MQTT protocol adapters remain deferred; the simulator stays the source
   for all other assets.

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
| Frontend     | React 18, TypeScript 5, Vite, Tailwind CSS, TanStack Query, Zustand, React Router, Leaflet, ECharts, and — since `F2.5` (ADR 0038 Amendment 2) — **CodeMirror 6** on the two authored-formula surfaces only. Five declared packages (`codemirror`, `@codemirror/{state,view,autocomplete,lint}`), composed from `minimalSetup` and never `basicSetup`, reached solely through `components/asset-templates/formula-editor-lazy.tsx` so the library ships in its own chunk. Measured: the entry chunk contains no CodeMirror at all, and `@codemirror/search` tree-shakes out of both chunks. `tests/adr-0038-formula-editor.test.ts` holds all of that statically — it is the only module allowed to import `codemirror` or `@codemirror/*`, in any import form. **Whether an asset is live is decided in exactly one place since `F4.37` (2026-08-14): `apps/web/src/lib/schematic-telemetry.ts`.** `FRESH_MS`, the arrival clamp and `isStale` live there, extracted from the context component so they can be tested at all — the context imports React, TanStack Query and socket.io-client, and `vitest.config.ts` only counts `apps/web/src/lib/**` toward coverage, so anything above it is untestable *and* invisible to the gate. Put new pure logic there, not in the component. **Freshness is computed at render, so it needs something to force one**: the provider's `staleTick` is the only periodic re-render in the app, and a `refetchInterval` is not a substitute — TanStack v5 tracks accessed properties and structurally shares results, so an unchanged response notifies nobody. **Since `F4.38` (2026-08-15, ADR 0027) the gate reaches everything on screen**, not just the SVG schematics: all seven control-room pages derive their tiles through `isStale`, a stale tile renders `—` rather than its last numbers, `offline` outranks `critical` in every page banner, and aggregates (`ctx.totalKw`, the KPI averages) exclude stale slices and show the count they excluded. Two rules follow for anyone adding to these pages. **Status renderers are `if`/ternary chains whose default is the healthy branch, so a new status member compiles silently and draws as `normal`** — test `offline` first in every chain; the compiler will not find them for you. And **read the clock at render**, taking the re-render from the provider's `staleTick`: a page that starts its own interval or caches the status re-freezes the tiles. `tests/repo-invariants.test.ts` holds both, plus the live-critical count that stops a dead sensor masking a live alarm. **`F4.39` (2026-08-15, ADR 0028) closed the assumption underneath all of this — that the thing on screen is a reading at all.** Every value on a control-room page is now one of: *measured* / *derived* (gated by ADR 0027), or *nameplate* / *configuration* / *simulated*, which render through `StaticValue` / `StaticTspan` (`components/static-value.tsx`) and are visibly marked `NP` / `SET` / `SIM`. The rule that decides which: **a value may be labelled a measurement of X only if it comes from telemetry that measures X** — `kVA` from `kW` and `pf` is fine, "Voltage Y" from Voltage R is not, and 32 cell voltages from one string voltage is not. Markers qualify *values*, not headings, hints or `x / y` denominators, whose form already says they are not readings. Three more traps this drew out: **each value takes the clock of the asset it came from** — `freshValue(own ?? fallback, ownStale)` reads naturally and is wrong, because the `??` resolves before the gate, so use `ownElse`; **absent is not zero** — `(fanSpeedPct ?? 0) > 20` renders a unit that publishes no fan speed as `IDLE`, which for a standby unit is its normal reading, so use `isHvacRunning`, which returns `null`; and a box holding a gated value must be able to **render offline**, or an em-dash inside a confident green outline is the only signal. Checks live in `tests/repo-invariants-provenance.test.ts`. **Since `F4.23` (2026-08-15, ADR 0030) every response this client reads is checked against a schema before any of the above sees it** — see the *API contracts* row and §4.8; a `fetch` in `src/api/` that does not go through `checkResponse` is the gap that row exists to close |
| Backend API  | NestJS (Node 20 LTS, TypeScript) |
| Realtime     | NestJS WebSocket gateway over Socket.IO with Redis adapter when `REDIS_URL` is set. The source is `LISTEN bms_telemetry` on a dedicated `pg` connection (`telemetry-notify.service.ts` → `telemetry-listener.ts`), fanned out through `TelemetryBroadcastHub`. **That listener supervises itself since `F4.34` (2026-08-14)** — error handler, reconnect with the ADR 0016 §5 backoff, and a re-`LISTEN` on every reconnect. Before it, the listener connected once with no `error` handler, and because `pg.Client` is an `EventEmitter` an unhandled `error` event **threw**: with no `uncaughtException` handler in `apps/api` and no `restart:` on the compose service, any dropped connection took the whole API down and left it down. Watch `bms_api_telemetry_listener_connected` on `/metrics` — 0 means realtime is dead while REST still serves. **`NOTIFY` has no replay**, so readings published during an outage never reach the live push; they are still in the hypertable, and clients recover history through `GET /telemetry/points/:pointRef/recent`. **The payload is validated since `F4.36` (2026-08-14)** — `telemetry-reading.schema.ts` checks every reading, drops the invalid ones individually and delivers the rest, because one `null` entry used to throw inside `AlarmThresholdService.collapseLatest` *before any rule ran* and silently suppress alarms for the whole batch. Watch `bms_api_telemetry_readings_dropped_total` beside the gauge: non-zero means something is publishing in a shape the contract does not allow, and `NOTIFY` needs **no table privilege**, so any role that can connect can write to that channel. It counts rejected *readings* — a broken envelope (non-JSON, `readings` not an array) is log-only. The payload is capped at 500 readings because validating is far dearer than the cast it replaced and the 8000-byte `NOTIFY` limit bounds bytes, not entries. **A future-dated `time` still passes validation here, deliberately, and that is not an oversight**: `resolveSamples` trusts `sample.at`, and the PHE pilot was measured writing 33 minutes ahead of `now()` (`F4.28`), so rejecting it server-side would delete real telemetry. Verified 2026-08-14 by publishing a reading 33 minutes ahead — accepted and broadcast, `dropped_total` unchanged. **The sink is what was fixed instead (`F4.37`, PR #39)**: the web client clamps on arrival, so a skewed producer costs at most `FRESH_MS` of delayed offline detection rather than pinning a dead asset `running` forever |
| Auth         | Keycloak/OIDC for pilot compose; local JWT fallback only for native WSL development |
| Observability | Optional Prometheus, Grafana, Loki, Promtail, and OpenTelemetry baseline |
| OLTP DB      | PostgreSQL 16 |
| Database roles | **Six, and which one a process connects as is a security decision, not a configuration detail** (**ADR 0043** decision 8 + Amendment 1, `F4.16`; **ADR 0045** and its Amendments 2–3, `E7.1a`). `bms_owner` owns both schemas and every table, view, sequence and continuous aggregate in them. It is deliberately **not** a superuser, because `FORCE ROW LEVEL SECURITY` binds a table's owner and **does not bind a superuser** — the `FORCE` clauses were decorative until `E7.1a` demoted the owner, and a superuser here makes every tenant policy in the repo a no-op with nothing failing to say so. `bms_app` survives as a **provisioning identity only**: `CREATE EXTENSION timescaledb`, `CREATE ROLE`, `ALTER ROLE … BYPASSRLS`, and replaying migration `0039:33` on a fresh database. It reaches the API through nothing — its connection string is `DATABASE_URL_SUPERUSER`, it appears in exactly one compose service (`migrate`) and one `apps/api/src` file (the integration-test gate), and `tests/adr-0045-owner-and-superuser-url.test.ts` fails if either widens. The API itself never connects as an owner: `bms_tenant` (policy-filtered to `app.current_organization`), `bms_fleet` (`BYPASSRLS`, for reads that already carry their own scope filter) and `bms_auth` (the small unscoped set login needs before an organization is known). **`bms_rollup` owns the four ADR 0023 continuous aggregates and nothing else**, because `refresh_continuous_aggregate` requires *ownership* and no `GRANT` substitutes for it — a `SECURITY DEFINER` wrapper is impossible, TimescaleDB refuses to run it from a function. It holds `LOGIN` with **no password** (Timescale background workers connect as the job owner; without `LOGIN` all four refresh policies die with a `FATAL` that `job_errors` reports only generically). **The one privilege widening in ADR 0045 is its membership, and the clause is the whole boundary:** `GRANT bms_rollup TO bms_owner, bms_tenant, bms_fleet WITH INHERIT FALSE, SET TRUE`. `INHERIT FALSE` is not tidiness — PostgreSQL defaults an omitted `INHERIT` clause to the *member's* `rolinherit`, and a plain `GRANT` measurably let `bms_tenant` `DROP MATERIALIZED VIEW` with no `SET ROLE` at all. Write the clause on any future grant of it. Passwords live in the environment and in no committed file, so **`pnpm --filter @bms/db roles` runs *before* `pnpm db:migrate`** — it creates the roles the migrations then grant to. Tenancy *semantics* (what a tenant is, the `SET LOCAL`-in-a-transaction rule, `withTenant` vs `fleetDb`) are ADR 0043's, still owed to `E7.1b`/`E7.1c` and tracked in `docs/BACKLOG.md` §5 — this row is the role inventory only. |
| Telemetry DB | TimescaleDB extension on the same Postgres |
| Telemetry aggregates | Four hierarchical continuous aggregates over `telemetry.point_values` — `point_values_1m` ← raw, `_5m` ← `_1m`, `_1h` ← `_5m`, `_1d` ← `_1h` (**ADR 0023**, `F4.1`, migration `0027`). **There is no `avg_value` column at any level and there must never be one**: `avg` does not compose, and building an hourly figure as `avg(avg_value)` over minute buckets was wrong in **151 of 169** buckets on real pilot data because samples per minute range 1–60. Store `sum_value`/`sample_count`/`min_value`/`max_value`; divide at read time. A total-level test does **not** catch the error — summed over the window both forms agree. **`timescaledb.materialized_only = false` is set explicitly on all four**, which on 2.29.1 is the *opposite* of the default: leave it and every live view's right edge silently disappears. Real-time aggregation has been deprecated upstream since 2.13, which is why the compose image is **pinned**. Reads go through `apps/api/src/telemetry/point-aggregates.ts`, never inline SQL — **all seven rollup reads are converted** (**ADR 0025**, `F4.28`): four in `dashboard.service.ts` (`loadTrend`, `energySummary`, `energySourceMix`, `energyTopConsumers`) and three in `reports.service.ts`. The raw reads in `map.service.ts`, `telemetry.service.ts` and `rules.service.ts` stay on raw **by decision** — they serve individual samples, which is what a hypertable is good at. **Level choice comes from `levelForRange`, never an inline ternary**, and it is keyed on how far *back* a range reaches, never on its duration: a duration-keyed selector sends a 24-hour range dated three years ago to `_1m`, which is dropped at 735 days and reads as **empty**. `end` plays no part — it is routinely in the future, both because `reports.service.ts` sets it to `endDate T23:59:59.999Z` and because the MQTT ingest writes ahead of `now()`. **Two guarantees here are static tests, not behavioural ones, and that is deliberate**: no behavioural test can catch a read reverting to `date_trunc` over raw, because every parity test compares against the raw query it replaced and a revert compares that query with itself (measured: a fully reverted `loadTrend` leaves the suite green); and no test can catch a missing `bucketHours` factor while every converted level makes it `1`. Both live in `tests/repo-invariants.test.ts` and `tests/adr-0025-level-selector.test.ts`. Backfill is `pnpm db:refresh-aggregates`, **not** a migration: `refresh_continuous_aggregate()` cannot run in a transaction and Drizzle's migrator wraps the run in one. **Compression and retention (ADR 0024, `F4.2`, migration `0028`):** raw compresses at 7 d and drops at **730 d**; `_1m`/`_5m` compress at 7 d and drop at **735 d**; `_1h`/`_1d` are **never dropped and not compressed** — after raw's 730 days they are the only record, at hourly resolution. The 735-vs-730 gap is an invariant, not rounding: `retention(aggregate)` must be **strictly greater** than its source's, because dropping an aggregate's old chunks leaves the watermark high, so that range reads as **empty** while raw still holds the rows — and **no refresh rebuilds it**. `pnpm db:refresh-aggregates` is therefore lower-bounded at **each level's own source's** oldest surviving chunk, never at raw's for all four: only `_1m` reads raw, and using raw's floor for the levels above it deletes `_1h`/`_1d` whenever raw's retention runs ahead of `_1m`'s |
| Migrations   | Drizzle ORM for tables; raw SQL for the Timescale hypertable **and its four continuous aggregates** (ADR 0016 predates them; ADR 0023 adds them). Drizzle cannot manage a continuous aggregate: it is `relkind = 'v'`, and declaring one with `.table()` makes `pnpm db:generate` emit `CREATE TABLE` for it. They are declared `.view().existing()` in `packages/db/src/schema/telemetry-schema.ts` so generate leaves them alone — verified by running it. Their **compression and retention policies** are raw SQL too (`0028`, ADR 0024) and *can* live in a migration: the `ALTER … SET (timescaledb.compress …)` and both `add_*_policy()` functions are transaction-safe, verified by `BEGIN`/`ROLLBACK` leaving zero jobs. Use `add_compression_policy`, **not** `add_columnstore_policy` — the newer name is a *procedure* needing `CALL`, which is not what drizzle emits. `0028` also opens with `SET LOCAL lock_timeout` and **resets it before ending**: the compress `ALTER` takes an ACCESS EXCLUSIVE lock on `point_values`, and drizzle wraps **the whole run** in one transaction, so an unreset `SET LOCAL` reaches every later migration in that run |
| Simulator    | Node script in `apps/sim` generating fake meter + sensor values |
| Real ingestion | `apps/ingest` MQTT TLS subscriber for the PHE pilot; writes `telemetry.point_values` and `pg_notify('bms_telemetry', …)` like the simulator (ADR 0007). **Five RTUs since ADR 0007 Amendment 1** (2026-08-22, `F1.7`) — the set is `packages/db/src/ingest-enabled-set.ts`, measured not chosen, and the seed asserts it **once** then leaves `ingest_enabled` to the operator, stamping `rtus.meta.enabledSetVersion` to record that it did. **Enabling or disabling an RTU needs an ingest restart**: the reload swaps point mappings only, and MQTT groups a whole broker into one endpoint, so the "new endpoint" warning cannot fire for a device change — the host logs `endpoint device set changed; restart required to apply` instead. A payload is accepted only on the topic its device is bound to, so a station cannot publish another's `dev_id`. No EMQX. **One entry point since the ADR 0016 §6 strangler migration finished**: `pnpm start` → `node dist/main.js` is the adapter host, and it is what compose and the pilot run. Commit 3 cut the *deployment* over on 2026-08-06; **commit 4 on 2026-08-14 deleted `src/index.js`**, removed the compose `command:` override and the `start:host` script, so there is no longer a legacy path one line away — reverting means reverting the commit. The host needs a build before it runs and does **not** fall back to JavaScript if you skip it; the image compiles before `CMD`. **`pg_notify` is unconditional and `INGEST_NOTIFY` no longer exists** — do not add it back to `docker-compose.yml`, which a repo invariant now fails on: it would do nothing, because the flag is gone from the code. If dashboards are dead while ingest is healthy, the cause is downstream, not a missing compose line; watch `written=` on the health body, since `notify=on` there is a literal and reports intent rather than delivery. **The downstream half was `F4.34` and it is fixed (2026-08-14, PR #33)** — the API's `LISTEN` now reconnects rather than dying, so the check is `bms_api_telemetry_listener_connected` on the API's `/metrics`: ingest `written=` climbing with that gauge at 0 localises the fault to the API side in one step. See [`docs/ingest-host.md`](./docs/ingest-host.md) |
| Master data  | Organization → Location → RTU → Asset → Point-key catalog + `/admin/*` CRUD with `admin`/`organization_admin`/`location_admin` roles (ADR 0008–0010). **ADR 0018** separates the axes: an asset must have a `location_id` (`NOT NULL`) and need not have an `rtu_id` (nullable); telemetry provenance binds at `asset_points.source_kind` (`measured`/`manual`/`computed`/`unmapped`), not at the asset |
| Asset templates | `bms.asset_templates` + `bms.template_points`, where a row **is** a version and `assets.template_id` pins it (ADR 0015). Published versions are immutable; editing one creates the next draft. `POST /admin/asset-templates/:id/instantiate` builds assets from a published version — target is `rtuId` **xor** `locationId`. A `template_points.kind = 'derived'` point is still re-validated against the active catalog, but **instantiation** never creates an `asset_points` row for it. Since `F2.4` and `F2.6` two other paths do, both writing the same synthesised `computed:<pointKey>` from one shared formatter: `CalcWriteService` on the point's first computed value, and the ADR 0039 override endpoint, which creates the row **eagerly** because waiting for a first value is circular when the override may be the very thing that lets one be produced. **A version is no longer a one-way pin**: `POST /admin/asset-templates/:id/migrate` moves an asset between published versions of the same code, previewed and audited (ADR 0039) — see *Template versions & overrides* below |
| Template content | `asset_templates.content` carries the `E1.7` overlay under **ADR 0019**, tiered by whether a consumer exists on `main`. **Bound** (`alarms`, `maintenance`) import their vocabularies from `rules.schema.ts` / `maintenance.schema.ts` — never restate them. **Since `F4.45` two of them are no longer enums**: `alarms[].category` is a *code* into `bms.rule_categories` (ADR 0031 A1) and, since **ADR 0032**, `alarms[].severity` is a code into `bms.alarm_severities`. The schema bounds their shape only; the check that each names a live value lives in `AssetTemplatesAdminService.assertTemplateAlarmVocabularies`, called on create, update **and publish** — publish was added by ADR 0032 and is not optional, because it used to get the check for free from the enums and a pre-ADR row could otherwise be published carrying an alarm the rule engine cannot run. **That method deliberately does not call `assertRuleCategory`/`assertAlarmSeverity`**: those echo the rejected code back, which is right for a value a caller just typed and wrong over *stored* content, where pre-ADR rows hold arbitrary JSON and the echo becomes a disclosure channel. `operator` is still an enum and still bound the way this row describes. The guard was **relocated, not dropped** — a template is an authoring surface, so a category that does not exist is a defect authored now and found whenever template alarms become rules. **`alarms.philosophy.skill` joined the Bound list under ADR 0034** (`E2.1`) — not via the enum-to-code route `category`/`severity` took, since `skill` was plain free text rather than a `z.enum`, but the same destination: a code into `bms.alarm_skills`, checked by a third non-echoing branch of the same `assertTemplateAlarmVocabularies` call. `cause`/`impact`/`action` stay ordinary free text, as they always were. The other three enrichment fields named by `E2.1` — affected assets, energy/water/production impact, ETR — are properties of a *live alarm instance*, not an asset class; ADR 0034 records that no `automation_rules` row links back to the `TemplateAlarm` it may have come from, so a template cannot carry them, permanently, not merely until a consumer exists. **Anchored** (`kpis`, `dashboards`) check point-key references. `kpis.expression` is **no longer always opaque**: `dialect` widened from a locked `"unvalidated"` literal to `z.enum(["unvalidated", "bms-calc-v1"])` (**ADR 0036**, `F2.3`), and `"bms-calc-v1"` triggers real parsing — grammar, whitelisted functions, and a `{pointKey}` cross-check against `pointKeys` — through the parser in `packages/shared/src/calc-dsl/` (see the *Calc DSL* row below). Existing `"unvalidated"` rows keep validating as bounded strings, unchanged; nothing forces a re-save. A dashboard view still carries *ordered point keys only* until `F3.1` defines the widget vocabulary. **Reserved** (`health`, `optimisation`) are **rejected**, each naming its blocking item. Every referenced point key must be one the template declares — checked on create, update and publish, because `content` and `points` are patched independently and a points patch can orphan content the request never mentioned. `POST :id/draft` is deliberately **exempt**: it byte-copies stored content, and validating it would strand a pre-ADR template behind its own immutable published version. Nothing converts this into a running rule or a maintenance row; it is the authoring surface only |
| Calc DSL     | Small hand-rolled scalar-arithmetic grammar, dialect `bms-calc-v1` (**ADR 0036**, `F2.3`) — arithmetic over `{pointKey}` brace references, numeric literals, and a whitelisted function set (`min`/`max`/`abs`/`round`/`clamp`); no assignment, no control flow, no string ops. Lives in `packages/shared/src/calc-dsl/` (tokenizer, recursive-descent parser, AST types, a pure `validateFormula(expression, knownRefs)`) so both the API (write-time validation) and the authoring UI (`F2.5`, shipped) share one grammar rather than each guessing at one. **`F2.5` widened this surface** (ADR 0038 decision 6): `tokenize`, `Token`, `TokenKind` and `CalcTokenizeError` are now exported too, so the editor colours a formula from the same lexer that validates it instead of carrying a second grammar. That makes `TokenKind` a **third frozen contract** in `packages/shared` — adding a token kind is a cross-package change from here on, because the editor's theme reads it — the situation ADR 0019 left open for `kpis[]`. **`eval`/`new Function`/`vm` are never used**, checked by a source scan over the directory rather than a hardcoded file/token list, so a future `evaluator.ts` cannot slip past it. Bounds mirror the existing KPI caps: `expression`/`formula` ≤1000 chars, ≤20 distinct point references, parser recursion depth ≤64, and a numeric literal long enough to overflow to `Infinity` is rejected lexically rather than passing silently. Errors carry the parser's own `code`/`position`, rendered through `formatCalcError` and wired into both the `template_points.formula` and `kpis[].expression` validation messages. `template_points` gained two nullable columns, `formula`/`formula_dialect`, enforced at the Zod layer — `kind: "derived"` requires both, `kind: "measured"` requires neither — not a DB `CHECK`, mirroring the `rtuId`/`locationId` exclusivity precedent in the same schema file. **A derived point's formula may reference measured points only, never another derived point, including itself** — chained/derived-to-derived formulas need dependency ordering and cycle detection, deliberately left to `F2.4` rather than decided here. **No evaluator lives here** — nothing computes a value from a parsed expression against live telemetry, including what "the current value of `{X}`" means (latest sample vs. rolling window) and null/stale-input/divide-by-zero handling; see the *Calc engine* row below |
| Calc engine  | Evaluates `bms-calc-v1` formulas against live telemetry and writes the result (**ADR 0037**, `F2.4`). `packages/shared/src/calc-dsl/evaluate.ts` is the pure evaluator — no clock, no I/O — refusing a non-finite result **at the node that produced it**, not only the root (`min({A}*{B}, 5)` refuses at the multiply, not the `min`), and normalising `-0` to `0`. `apps/api/src/calc/` resolves what "the current value of `{X}`" means: **trigger mode is per formula**, `template_points.calc_trigger` is `streaming` or `scheduled` (interval `calc_interval_seconds`, both new nullable columns, migration `0036`), never a property of the engine. **Streaming** mirrors `AlarmEngineService` — `CalcStreamingService.onModuleInit` subscribes `hub.on("readings")`, a 60s-cached definition loader (`CalcDefinitionsService`), one `try`/`catch` per formula so one failure never costs the batch, and every candidate `(assetId, templatePointId)` pair deduped before evaluating — a formula with more than one ref must not double-evaluate when a batch happens to carry fresh readings for more than one of them. **Scheduled** is one self-scheduling `for (;;) { sweep; await sleep(...); }` loop (`CalcSchedulerService`/`runSchedulerLoop`) — **never `setInterval`**, the same shape `apps/ingest`'s `runPollLoop` already uses, so §9.4 is not triggered by adding a scheduling library. `lastRunMs` is keyed on `(assetId, templatePointId)`, **never `templatePointId` alone** — one published template instantiated on several assets shares a `templatePointId`, and keying on the bare id lets the first asset processed each sweep mark every other one as "just ran", starving it silently forever; the stored value is the formula's own **bucketed** tick time (`bucketTimeMs`), not raw wall-clock `now()`, so sweep-cost drift self-corrects rather than compounding. Staleness is per formula too — `max_input_age_seconds`, defaulting to a deliberately loose 300s — and "missing" vs. "stale" stay distinguishable inputs, never conflated. **Every skip is counted, none silent** (`bms_api_calc_skipped_total{reason}`) — an unusable stored definition, a missing/stale input, and a non-finite result are all distinct labelled reasons, alongside `bms_api_calc_values_written_total` and the `bms_api_calc_active_formulas` gauge. Writes go through `CalcWriteService`, **not** `TelemetryWriteService`: no JWT, no `MasterDataAuditService`/`bms.audit_log` row — auditing every machine-generated sample would flood `F4.14`'s read API — computed provenance (`source_kind: 'computed'`, `rtu_id: null`, `source_data_key` synthesised as `computed:` plus the point key, length-checked against the column before the insert since a point key alone can be valid up to 128 chars while the composite cannot, on-demand `asset_points` mapping creation SAVEPOINT-isolated per pair so one pair's DB failure never aborts the batch), and `onConflictDoNothing`-only value writes: a recompute of the same `(time, assetId, pointKey)` is a database no-op, never an overwrite (decision 8's idempotency guarantee). Re-entrancy is closed twice over — the streaming host's own input filter, resolved on `(assetId, pointKey)`, can never match the engine's own output because ADR 0036 decision 7 forbids a derived point referencing another derived point, and a same-instant recompute is a no-op regardless. `tests/adr-0037-calc-engine-invariants.test.ts` statically scans every file under `apps/api/src/calc/` for `setInterval` and for the forbidden audit-path imports, plus wiring checks that `CalcModule` is still in `app.module.ts` and both hosts' `onModuleInit` still call their real entry point — deleting any of those three one-line wiring points fails a test rather than leaving a green, fully-covered suite with an engine that never runs. **Since `F2.6` the definition loader no longer reads `template_points` alone** — see *Template versions & overrides* below. Anything that queries calc configuration must go through `CalcDefinitionsService`; a template-only `SELECT` written here would silently ignore every per-asset override, which is the failure ADR 0039 names as its highest risk. **Still not owned here**: no chained/derived-to-derived formulas (ADR 0036 decision 7, unchanged — dependency ordering and cycle detection stay deliberately undecided), and no `F2.8` wiring. `F2.8` stays blocked: `bms-calc-v1` references carry no asset qualifier and the grammar has no aggregate function, so `estimatePue()`'s cross-asset sum is not expressible as a derived tag without an ADR 0036 amendment or a site-level rollup asset |
| Template authoring | The screen for everything the three rows above define (**ADR 0038**, `F2.5`). **Exactly five tabs** over one template version — Details, Points, Calculations, KPIs, Alarms — pinned by a source scan in `tests/adr-0038-template-authoring-ui.test.ts`, because a type cannot stop a sixth being added and a behavioural test would simply agree with whatever it found. The three closed `content` sections (`health`, `optimisation`, `dashboards`) get **no** tab; §6 still holds them. **A published version renders read-only** — decision 3, and the single failure mode it exists to prevent is an editable formula field on a published template, so both formula surfaces derive `readOnly` from `formulaFieldsAreReadOnly(status)` rather than restating the statuses. **Authoring is role-hidden and scope-refused** (decision 10): the role half is `templateFormsAreEditable(role, versionIsEditable)`, which gates the *forms* and not merely the lifecycle buttons — gating only the buttons shipped a page that looked correct while every field stayed editable for a `location_admin`, who could then author a whole form and lose it to a 403. The organization half is not derivable in the browser and falls through to the API 403, which **renders inline the way decision 10 assumes since `F4.52`** (2026-08-22, PR #136) — before that fix `clearSessionOnAuthFailure` cleared the session on 403 as well as 401, so the refusal logged the user out of a valid session instead of explaining itself. It clears on **401 only** now, and that narrowing is correct only while no 403 in this API is repairable by signing in again; `tests/f4.52-auth-failure-status.test.ts` gates the premise, so read it before letting a guard or an exception filter answer a token problem with a 403. **Every rule lives in `apps/web/src/lib/` with a spec**, never in a `.tsx`: `apps/web`'s Vitest project runs `environment: "node"` over `src/**/*.test.ts`, so a component is unreachable by every test in this repository and the coverage `include` stops at `src/lib/**`. Logic left in a component is invisible to both gates, which is why eighteen `lib/` modules carry this feature's decisions |
| Template versions & overrides | How a published version's changes reach assets already built from the old one, and how one asset departs from its version (**ADR 0039**, `F2.6`). **Two mechanisms, deliberately separate.** *Migration* re-pins `assets.template_id` between published versions of the same code — explicit, previewed as a version delta, audited, never follow-the-latest, because a publish must not silently change what a live plant computes. It **refuses** rather than reconciles: a delta that removes or re-keys a `measured` point (that `asset_points` row is physical wiring `apps/ingest` and the rule engine read), a *required* measured addition whose `source_data_key_pattern` uses any token beyond `{asset_code}` (instantiation takes the rest per request and never stores them, so there is nothing to recover for an asset built months ago), a domain change (`assets_domain_fk` would not catch it — both values are valid codes — and re-pinning alone would make the pin and the asset disagree), and a measured addition onto a point key the asset already has a row for. **No backfill; nothing recomputes history** (ADR 0037, unchanged) — a series whose formula changed midway is an accepted, recorded hazard. *Overrides* are five nullable columns on `bms.asset_points` (migration `0037`) mirroring the same five on `template_points`. **The resolution is `coalesce(asset_points.<col>, template_points.<col>)`, per column, asset-first, over a LEFT JOIN on `(asset_id, point_key)` — and it is the highest-risk line in the feature.** It sits in the hot path of every scheduled and streaming evaluation, and each way of getting it wrong computes a wrong number *silently*: an INNER join drops every derived point with no `asset_points` row, which is the normal state; a reversed coalesce makes every override inert; a whole-row coalesce lets one override blank four inherited values. None of them throws, and every calc unit test constructs its dependencies directly, so reverting the query to a template-only `SELECT` leaves the entire suite green — which is why `tests/adr-0039-resolution-merge.test.ts` scans the source for the join, both halves of its condition, all five per-column coalesces in order, and the two things that must **not** be there. Three columns are deliberately not treated alike: `kind` is **never** coalesced (an asset cannot turn a measured point derived), `active` is **not** filtered (deactivating a telemetry *mapping* must not silently stop a formula), and `source_kind` **is** filtered to `computed` (`AssetPointsAdminService.create` resolves a point key against the catalog alone with no template awareness, so an operator can map a mapping row onto a key the pinned version declares `derived`; such a row is all-NULL today, so omitting the filter happens to give the same answer — by accident, one write away from resolving a formula out of ingest wiring). `null` means **inherit**, which makes one mistake structural rather than careless: an override cannot *clear* an inherited value, so a scheduled template point can never be overridden to streaming, and changing the trigger while leaving the interval alone is a counted skip. Both the API and the browser say that in the same sentence. **An override formula may reference measured points only** — the same rule `assetTemplatePointsBodySchema` applies to a template author, restated here because this endpoint is a second author for the same engine: on a `scheduled` trigger a self-reference compounds every interval until it is non-finite, since the scheduler stamps a fresh wall-clock bucket each tick and `ON CONFLICT DO NOTHING` never dedupes it |
| Ingest adapters | `IngestAdapter` interface frozen by **ADR 0016**: the host owns *supervision and cadence* (poll loop, overlap guard, backoff, jitter, bounded queue, process lifetime); adapters own the protocol connection and parse, implementing `connect` / `disconnect` / `health`. **The host is now built** (§6 commit 2): `apps/ingest/src/host/` supplies the supervisor, bounded queue, binding plan, normaliser and health endpoint, `src/main.ts` is wiring only, and **the §5 backoff table itself moved to `packages/shared/src/ingest.ts` on 2026-08-14 (`F4.34`)** because the API's telemetry listener became its second consumer — the ADR states those numbers precisely "so five agents do not invent five policies", so a second copy would have defeated the point of writing them down; change them in one place and both the ingest supervisor and the API listener follow, and `src/adapters/mqtt.ts` ports the pilot's MQTT connection onto the interface behind `src/adapter/registry.ts` — a port that **deliberately diverges** from the ADR 0007 pilot's parser in three ways, listed in `docs/ingest-host.md`. That happened because `index.js` was frozen while it served the pilot, so a defect found in the shared parse logic could only be fixed on the host side; §6 commit 4 has since deleted it, and the divergence list is kept as the record of what the host does differently from the behaviour that ran in the field — it is what explains the step change in the pilot's data on 2026-08-06. **MQTT is the only implementation, and it is not new scope** — ADR 0007 promoted it, this moves it onto the frozen interface. Modbus, BACnet, OPC-UA, SNMP, REST polling and DCS each still need **their own ADR** under §10 — unconditionally, not only where a protocol library has to be settled under §9.4; see §6. Adapters never read `process.env` (ADR 0016 §4); the host reads it in `host/config.ts`, **plus** the pilot-era `MQTT_*` and `CREDENTIAL_ENCRYPTION_KEY` reads in the unmodified `rtu-config.js`. That `MQTT_USERNAME`/`MQTT_PASSWORD` fallback is the *only* working credential path, and ADR 0016 Resolved decision 5 expected it to **survive cutover**. **It did, and the expectation is no longer a prediction:** the pilot has run on that path since 2026-08-06, `bms.rtu_connection_configs` held no rows when the cutover ran, and the decision's own caveat — that the emptiness was measured on a local seeded database and needed confirming against the production pilot — is discharged by that database *being* the pilot's. Treat the emptiness as a **measurement with a date, not a standing fact**: the onboarding wizard writes that table, so re-query before relying on it. **ADR 0016 Amendment 3 (2026-08-14) now records this**, and it re-measured rather than restating: `bms.rtu_connection_configs` still held **0 rows**, so the fallback survives, and `CREDENTIAL_ENCRYPTION_KEY` *is* set — the ADR 0012 path is blocked on **data, not configuration**. Amendment 3 also names the repository owner as §6 commit 4's owner, closing Resolved decision 4. Writing an `rtu_connection_configs` row is still prerequisite work for anyone who wants the ADR 0012 path. Amendment 1 widens the schema fields to `ZodType<T, ZodTypeDef, unknown>` so `.default()`/`.transform()` schemas compile; Amendment 2 adds `@types/pg`. **§6 commits 3 and 4 are both discharged** — the parallel run and the cutover ran against the live PHE feed on 2026-08-06, and commit 4 landed 2026-08-14 (PR #30): `src/index.js` and the `INGEST_NOTIFY` flag are deleted, `pnpm start` is the host, and `pg_notify` is unconditional. That was not tidying up — post-cutover the flag's off-default was the only reachable state in which telemetry lands while every dashboard is dead, with no error and no alarm. **Four of commit 4's five actions landed. The fifth did not, and that is §6 being followed rather than amended**: it conditioned retiring the `MQTT_USERNAME`/`MQTT_PASSWORD` fallback on the pilot RTU having an `rtu_connection_configs` row, and it has none. Reassigned to **`E8.4`** |
| AI onboarding | Scoped admin ingestion wizard using OpenAI chat completions with structured JSON, and a deterministic rule-based fallback when `OPENAI_API_KEY` is unset (ADR 0011). **Credentials never transit the chat** (**ADR 0022**, `E8.3`): they arrive through `POST /api/v1/admin/onboarding/sessions/:id/credentials`, and a chat turn that appears to carry one is **refused — not parsed, not stored, not forwarded to the model**. The wizard used to *prompt* for them and parse them out of the turn, which left plaintext in `onboarding_sessions.messages`; migration `0026` purges that column on every existing row (session rows are kept — `audit_log` references them by id). The detector that spots a credential-bearing turn is a **nudge, not the control** — six review rounds found it simultaneously too narrow and too broad, and its documented misses are asserted as tests. The control is that credentials have a typed home. Do not "improve" that detector without reading ADR 0022's amendments first |
| Secrets      | AES-256-GCM encrypted RTU connection credentials via `CREDENTIAL_ENCRYPTION_KEY`; never returned decrypted by the API (ADR 0012). Writers into that store: the master-data RTU admin, and the onboarding credentials endpoint above (**ADR 0022**), which **fails closed** with 503 when the key is unset rather than reporting a success that stored nothing. In an onboarding draft the blob is keyed by **RTU `code`, never by array position** — the draft's `rtus` array is replaced wholesale by any patch, so a positional key delivered one broker's password into a different broker's connection config. A code claimed by no RTU, or by more than one, drops rather than guesses |
| Operations   | Work orders, maintenance schedules, basic rules, Energy CSV reports, completed 2D Control Room foundation screens, completed guided rule builder, and completed Control Room extension. Every mutating endpoint across these four domains is gated by the **operations write matrix** (ADR 0017) — see §4.7. The Energy CSV export escapes through the shared serialiser, **not** its own rule — see the *CSV exports* row (ADR 0026) |
| Audit read   | `bms.audit_log` becomes readable under **ADR 0021** (`F4.14`): `GET /api/v1/admin/audit` and `/audit/export` (CSV + XLSX), in `apps/api/src/admin/audit/`. **Global admin only** — the table has no tenancy column, so §4.7's scope predicates cannot be applied to it at all; scoped reads for `organization_admin` and below are **deferred to their own ADR**, not silently omitted. Purely additive: no DDL, no trigger, no new package (`xlsx` was already an api dependency). `payload` is returned **verbatim**, which makes every `payload: body` call site a security surface — see §4.7. Export requires a `from`/`to` window of ≤366 days and is capped at 50,000 rows, **refusing rather than truncating**; the cap was measured, not assumed, and is a *row* bound with **no byte bound** — that gap is recorded in ADR 0021, not fixed. Append-only storage and hash-chaining are `F4.15` and stay out of scope (§6) |
| Notifications | **ADR 0041** (`F3.8`): one `NotificationTransport` interface in `apps/api/src/notifications/`, with `log`, `email` (`nodemailer`) and `webhook` implementations. **Dispatch is inline and fire-and-forget — no queue, no Redis** — and `dispatch()` **never rejects**: a failure is a `failed` delivery row, not an exception thrown back into the alarm path that raised it. **A row is written for every attempt, including the ones that send nothing.** The five statuses are `sent`, `failed`, `skipped_unconfigured`, `skipped_deduped` and `skipped_rate_limited`, because *"no notification arrived"* and *"no notification was attempted"* are different answers to an operator and only the ledger can tell them apart. Storm control is two-sided: a transition dedupe (an unchanged plant sends nothing) and an hourly ceiling that counts `sent` **only**, so throttling cannot throttle itself. **A channel's secret never touches `config`** — `config` is returned by the API and appears in logs (§9.6), so the credential lives in three columns holding ADR 0012 ciphertext, IV and key version, made all-or-nothing by a CHECK; the DTO carries `hasSecret: boolean` and never the value. **The kind vocabulary is a lookup table, not an enum** (ADR 0031 A1), so `F3.9`'s `sms` is an `INSERT` — but it is **not yet open end-to-end**: the admin UI hardcodes two `<option>`s and the transport lookup is a `switch`, so a new row still needs code. `notification_deliveries` FKs are `NO ACTION` on purpose — history outlives configuration, and deleting a channel with history returns a **409 telling the operator to disable it instead**, found by clicking the button rather than by the compiler. **Webhook egress is restricted at the transport**: loopback, private, link-local and this-network destinations are refused *before* `fetch`, with `redirect: "manual"` and a 5 s timeout. The IPv4-mapped IPv6 form (`https://[::ffff:7f00:1]/`) reached the Compose network until the security review caught it — the unit tests had asserted the dotted form, which `new URL()` never produces, so they were exercising an unreachable branch. The residual DNS-rebinding window is documented in the file header, not implied. Both `/rules/:id/notifications` routes carry **role AND scope** checks per §4.7; the role gate alone admits `location_admin`, which let a scoped admin redirect or silence another site's alarms until review found it |
| CSV exports  | **Both** CSV downloads escape through one module, `apps/api/src/serialise/csv.ts` (**ADR 0026** and its **Amendment 1**; `F4.29`, `F4.31`, `F4.50`): the audit export (ADR 0021) and the Energy Consumption report. Before it they disagreed — the audit one neutralised spreadsheet formula leaders and the reports one only quoted, so an asset `code` beginning `=` was delivered as a **live formula**. `csvTextCell` prefixes an apostrophe when a value starts with `=` `+` `-` `@` TAB or CR, **then** tests the quote trigger `/["\n\r,\t;\|]/` — that order is load-bearing, since the guarded form of a CR-led value still contains a CR and must be quoted or the record splits. **TAB, `;` and `\|` joined the trigger in Amendment 1 (`F4.50`)**, and the reason is not RFC 4180 — it is that Excel 2013 was measured evaluating `=1+1` out of an unquoted cell in **four** consumers that do not read the file as comma-delimited: two clipboard pastes, a comma+TAB file open, and a `;`-list-separator locale double-click. All six are formula-*initiating* characters, **not** "characters a spreadsheet strips as whitespace": `\r` must stay in the leader list *and* the trigger, and deleting it from either reopens a hole every test would still pass. **Numeric cells are exempt and take `csvNumberCell`**, because the guard neutralises cells whose Excel formula reading differs from their literal text and for a number it does not (`=-5` is `-5`) — guarding one would import the client's figures as text and break their arithmetic. The split is enforced by the two functions' **parameter types**, never by a regex that re-parses output, and escaped cells carry a branded `CsvField` so a raw string in a row is a **compile error**. The audit call site is still blanket because all nine of its columns are string-shaped: the two exports are **consistent, not identical**. `toSheetRows` (XLSX) is correctly unguarded — SheetJS writes `t="str"`, ECMA-376's *cached formula result* type, and the safety is the **absence of any `<f>` element**, not the cell type. **`energySheetRows` joins it** since Amendment 2, unguarded for the same measured reason, with one difference that is load-bearing: it keeps numeric cells as `number` rather than returning `string[][]`, because every numeric column in that report is one the client computes on and text would set `t="str"` and break their arithmetic — the same harm decision 2 forbids the apostrophe guard from causing, arriving by a different route. **Whether a leading U+0020/U+00A0/U+FEFF is stripped-then-evaluated is no longer an open question, and the answer was yes.** `F4.31` ran it: **Google Sheets evaluated a cell led by a single U+0020 space**, shipped in both exports since `73a9fd2`. `csvTextCell` therefore tests the value **with leading whitespace stripped** as well as raw — the class, not the one character that was measured. **Know what the quoting does and does not buy.** Excel honours the `"` text qualifier only when the quote **opens a field**, so the deciding variable is whether the **comma** is still among the consumer's delimiters. Where it is, the cell arrives intact and the vector is closed. Where it is not, two separators in one cell put the closing quote on a later fragment and the formula evaluates anyway — **both guards are positional, and a re-split moves the position**, so the apostrophe fails the same way. `F4.51` **answered that residual by changing format, not by escaping** (Amendment 2): `GET /api/v1/reports/energy/export.xlsx` ships beside the CSV, both rendered from one table so they cannot drift, and the CSV bytes are unchanged. **The CSV residual itself is still open and must not be written up as closed** — for a consumer whose delimiters exclude the comma, two separators in one cell still evaluate, and nothing in `csv.ts` can repair it, because the apostrophe protects the first fragment only. Rejecting the separators at the **write** path was considered and rejected as **impossible to complete**: the exported columns take input at 13+ Zod validation points across five modules, and the audit export's `actor_email` comes from `users.email`, which has no write path in this codebase at all. Anyone reopening that idea must answer `users.email` first. The standing instruction is unchanged, and two separate measurements have now proved it right: **do not add — or remove — characters on reasoning alone.** Measure it with `pnpm csv:formula-probe`, and read the control that matches your delimiter, because the wrong control cannot fire and a vacuous run looks exactly like a clean one |
| API contracts | **Every API *response* type is `z.infer` of a schema in `packages/shared/src/contracts/`, never written twice** (**ADR 0030**, `F4.23`). The contract was never missing — `packages/shared` already exported 100 types imported at 148 sites — what was missing was a **runtime**: every export was a `type`, and `apps/web` imported `zod` zero times, so no response was checked anywhere. 88 schemas now cover them, and `apps/web` calls `checkResponse(schema, payload, endpoint)` (`src/api/validate.ts`) on 33 direct reads plus all 42 `adminFetch` calls, whose `schema` parameter is **required** so the compiler finds every site. **It validates and does not transform** — Zod strips unknown keys, so returning `result.data` would silently delete a field the server has newly added; `checkResponse` returns the original payload either way. **Failure direction is asymmetric on purpose**: throw in dev/test, log-and-pass in production, because a blank Control Room during an incident is worse than one drifted field — the same asymmetry ADR 0029 Amendment 2 applied to `API_DOCS_ENABLED`. Issues are logged as **`path` and `code` only** (§9.6): a Zod issue embeds the *received value*, so logging `message` publishes server data to a shared operations console. **Three findings worth carrying:** `@bms/shared/contracts` **does not typecheck from `apps/api`**, which compiles `moduleResolution: "node"` (node10) and ignores the `exports` map while Node's *runtime* resolution honours it — the dangerous half — so `index.ts` re-exports the schemas and the subpath is an `apps/web` convenience only; a **required `unknown` property is not expressible in Zod** (`z.unknown()` yields an *optional* key, and `z.any()`/`z.custom<unknown>()` behave identically), which is why `AuditLogEntryDto.payload` is the one contract this migration changed; and the validator **found real drift on its first run against the deployment** — `GET /rules` had never conformed, 48 of 89 rows carrying an undeclared `category`, fixed in `F4.43`. That is the argument for the 89 routes the spike did not measure. **`RuleListItem` gained `assetDomain` in `F4.45`** (ADR 0031), read from `bms.assets.domain` on the join that already served `assetCode`/`siteName` — a rule's plant domain is the *asset's* fact and is never stored on the rule. **Three contract fields are deliberately no longer enums**: `category`, `assetDomain` and `severity` are `z.string()` codes, because ADR 0031 Amendment 1 moved the first two vocabularies into `bms.rule_categories` / `bms.asset_domains` and **ADR 0032** moved the third into `bms.alarm_severities`, so a domain pack ships a sector — or the client's `B9` answer ships a severity level — with an `INSERT`. The cost is stated rather than hidden — this validator can no longer report an unknown category the way it reported `electrical`; that check moved to two foreign keys, where it is absolute rather than advisory, and to `VocabulariesService` at each write boundary so an unknown code stays a **400** rather than becoming a 500. See §4.8 |
| Containers   | Dockerfiles and Docker Compose profiles for API, web, simulator, **ingest** and DB |
| CI/CD        | GitHub Actions: install, build/typecheck, `typecheck:tests`, **the `apps/ingest` image build**, migration validation, **`db:seed` against a fresh schema**, **`db:refresh-aggregates`** (ADR 0023 — a no-op on a fresh database, since `db:seed` writes zero telemetry rows; it runs so the backfill path cannot rot unexercised), and `test:coverage` (ADR 0014). The Postgres service image is **pinned** to the same tag as `docker-compose.yml`, because the aggregate suite asserts behaviour measured on TimescaleDB 2.29.1. The image build is there because no workflow built one, so `apps/ingest/Dockerfile` sat broken on `main` while CI stayed green — it is the only ingest image gated, being the only one that installs before COPYing sources |
| Testing      | Vitest, one project per app + a repo-wide `repo` project; coverage gate on a ratcheting baseline (ADR 0014). See §4.6 |
| Cache / pub-sub | Redis 7 for Socket.IO adapter fan-out |
| Local dev    | WSL2 Ubuntu 22.04; native Postgres remains supported, Docker Compose is optional |

No new dependencies may be added without an ADR in `docs/adr/`.

---

## 3. Repository Layout

```
bms/
├── AGENTS.md                  ← this file (active)
├── CLAUDE.md                  ← pointer to this file for AI agents
├── README.md
├── ESKOM_SMOC.html            ← UX reference (do not edit)
├── TRINETRA.html              ← UX reference, current branding (do not edit)
├── package.json               ← pnpm workspace root
├── pnpm-workspace.yaml
├── vitest.config.ts           ← root test config + coverage ratchet (ADR 0014)
├── docker-compose.yml         ← Phase 1 local/pilot compose entrypoint
├── .github/
│   └── workflows/             ← GitHub Actions CI
├── .claude/
│   ├── agents/                ← review subagents (security, migration, compliance)
│   ├── hooks/                 ← guards, incl. the drizzle journal check
│   └── skills/                ← repo workflows (new-adr, backlog-cycle, verify)
├── tests/                     ← repo-wide invariants; see the §4.6 carve-out
│                                repo-invariants.test.ts is the general file;
│                                repo-invariants-provenance.test.ts holds
│                                ADR 0028's (F4.39). They are split because the
│                                pair exceeds the §4.5 1000-line cap, so put a
│                                new value-honesty check in the second and
│                                anything else in the first — but the first is
│                                now 911 lines, so the NEXT check that does not
│                                belong to an existing ADR file needs a third
│                                file, not another append (F4.40). A check that
│                                does belong to one goes there instead:
│                                adr-0024-retention-bounds.test.ts took F4.40's
│                                compressed-delete rule for that reason, and
│                                F4.23 opened adr-0030-contract-derivation.test.ts
│                                rather than appending. F4.43's checks are in
│                                rule-vocabulary.test.ts — named for the SUBJECT,
│                                not an ADR, because it belongs to no ADR of its
│                                own (ADR 0030 Amendment 3 records it). Both
│                                conventions are live: adr-00NN-*.test.ts where a
│                                file tracks one ADR, a subject name where it
│                                does not. A new file here must ALSO be added to
│                                the typecheck:tests script — see §4.6
├── exports/                   ← PHE MQTT reference + point-mapping CSVs (ADR 0007/0011)
├── infra/
│   ├── keycloak/              ← Phase 1 Sprint C realm export
│   └── observability/         ← Phase 1 Sprint D Prometheus/Grafana/Loki config
├── apps/
│   ├── web/                   ← React SPA (incl. /admin master-data + onboarding wizard)
│   │                            src/lib/ is the ONLY part of this app any test
│   │                            or the coverage gate can see: the Vitest project
│   │                            runs environment:"node" over src/**/*.test.ts,
│   │                            so a .tsx is unreachable, and vitest.config.ts
│   │                            includes apps/web/src/lib/** and nothing above.
│   │                            Put pure logic there and keep components to
│   │                            wiring. ADR 0038 (F2.5) is the worked example:
│   │                            eighteen lib/ modules behind five tab .tsx files.
│   │                            src/components/asset-templates/formula-editor.tsx
│   │                            is the only module allowed to import CodeMirror
│   │                            — reach it through formula-editor-lazy.tsx.
│   ├── api/                   ← NestJS REST + WebSocket (incl. src/admin, src/security)
│   │                            src/admin/asset-templates/ holds ADR 0015's
│   │                            lifecycle + instantiation services, and
│   │                            ADR 0019's content contract.
│   │                            src/vocabularies/ serves AND enforces the FOUR
│   │                            open vocabularies — rule concerns and plant
│   │                            domains (ADR 0031 A1), alarm severities
│   │                            (ADR 0032), and alarm skills (ADR 0034). Its
│   │                            service is not a convenience:
│   │                            with the value set in a table rather than a
│   │                            z.enum, it is the only thing keeping an unknown
│   │                            code a 400 instead of a 500 from a foreign key.
│   │                            validateRuleDraft calls it, covering rule
│   │                            create, update, preview and publish.
│   │                            duplicateRule does NOT — it inlines its own
│   │                            insert copying current.category AND (since
│   │                            ADR 0032) current.severity, which the FK still
│   │                            accepts because the source row is valid, but
│   │                            which does NOT re-check `active`, so
│   │                            duplicating a rule whose category or severity
│   │                            was since retired propagates the retired code.
│   │                            The mirror of that gap: a rule already holding
│   │                            a retired severity becomes UNEDITABLE, because
│   │                            updateRule funnels through the same assertion
│   │                            even on an edit that never touches severity
│   │                            src/testing/ is test-only helpers (ADR 0025) —
│   │                            the one src/ directory excluded from
│   │                            tsconfig.build.json, so it is NOT runtime code.
│   │                            A runtime import of it fails
│   │                            tests/repo-invariants.test.ts (the tsconfig
│   │                            exclusion alone does not stop one: tsc
│   │                            re-admits an excluded-but-imported file)
│   │                            src/serialise/ is the ONE CSV escaping rule
│   │                            both exports share (ADR 0026) — a hand-rolled
│   │                            escaper anywhere else under src/, or a CSV
│   │                            producer outside apps/api/src, fails
│   │                            tests/repo-invariants.test.ts
│   │                            src/openapi/ generates the API document from
│   │                            the Zod schemas (ADR 0029) — openapi-registry.ts
│   │                            is the ONE place a route is joined to its
│   │                            schema, and there is deliberately no controller
│   │                            there: Amendment 2 deleted the guarded endpoint
│   │                            rather than leave a second, unreachable way to
│   │                            publish the route inventory
│   │                            src/calc/ is the ADR 0037 calc execution
│   │                            engine (F2.4) — five services (definitions,
│   │                            inputs, write, streaming, scheduled), no
│   │                            controller, wired via CalcModule with no
│   │                            HTTP surface of its own. See §2 *Calc engine*
│   ├── sim/                   ← telemetry simulator (Node script)
│   └── ingest/                ← PHE MQTT TLS subscriber (ADR 0007), five RTUs.
│                                ONE entry point since §6 commit 4 (2026-08-14):
│                                src/host/ + src/adapters/ + src/main.ts →
│                                dist/main.js, run by `pnpm start`. src/index.js
│                                was the frozen legacy path and is deleted;
│                                src/rtu-config.js stays — ADR 0012 seam
├── packages/
│   ├── shared/                ← cross-cutting TS types & constants, plus the ONE
│   │                            runtime policy both apps share: the ADR 0016 §5
│   │                            reconnect backoff in src/ingest.ts, used by the
│   │                            ingest supervisor AND the API telemetry listener.
│   │                            NOT in the coverage denominator — vitest.config.ts
│   │                            includes apps/* only, so moving covered code here
│   │                            silently removes it from the numerator.
│   │                            src/contracts/ holds the RESPONSE schemas
│   │                            (ADR 0030) and src/constants.ts the point-key
│   │                            catalogues that index.ts grew too large to hold.
│   │                            src/calc-dsl/ holds the bms-calc-v1 tokenizer,
│   │                            recursive-descent parser, AST types and
│   │                            validateFormula() (ADR 0036), plus since ADR 0037
│   │                            (F2.4) the pure evaluate() function apps/api/src/calc/
│   │                            calls — see §2 Calc DSL and Calc engine rows.
│   │                            ADR 0038 (F2.5) widened its index.ts to export
│   │                            tokenize/Token/TokenKind/CalcTokenizeError so the
│   │                            editor highlights from the same lexer that
│   │                            validates. TokenKind is now a FROZEN contract:
│   │                            adding a kind is a cross-package change.
│   │                            The package is no longer type-only: it depends
│   │                            on zod, and the ./contracts export entry in its
│   │                            manifest is what makes the subpath resolve at
│   │                            all under pnpm. Import it as @bms/shared/contracts
│   │                            from apps/web ONLY — apps/api compiles
│   │                            moduleResolution:"node" (node10), which ignores
│   │                            the exports map, so there the subpath fails tsc
│   │                            while WORKING at runtime; index.ts re-exports
│   │                            everything for that reason, as ./ingest already
│   │                            documents. REQUEST schemas stay in apps/api
│   │                            (ADR 0030 decision 3) — moving them would break
│   │                            ADR 0029's registry and its guard
│   └── db/                    ← Drizzle schema, migrations, seeds (incl. phe-catalog.json)
└── docs/
    ├── adr/                   ← Phase 1+ architecture decisions (the live scope record)
    ├── archive/               ← superseded planning docs, kept for provenance
    ├── scripts/               ← docx/report build helpers (not app code)
    ├── security/              ← encryption-at-rest boundary and security notes
    ├── AGENTS.production.md   ← future-state rulebook (reference)
    ├── BACKLOG.md             ← the single managed pending-feature backlog
    ├── build-operating-model.md ← how we build: the per-feature loop and gates
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
- Functional components only. One component per file. **One standing exception,
  granted by ADR 0028:** `apps/web/src/components/static-value.tsx` holds
  `StaticValue` and `StaticTspan` together — the HTML and SVG renderings of one
  concept, which always change together, and splitting them would put the two
  halves of a single decision in different files.
- Data fetching via TanStack Query hooks in `apps/web/src/api/`.
- UI state via Zustand stores. No Redux.
- Styling via Tailwind utilities. Inline `style` only for dynamic values.

### 4.3 NestJS
- Module-per-domain: `auth`, `assets`, `alarms`, `telemetry`, `audit`.
- Controllers thin → services do work → repositories touch the DB.
- Validate every DTO with Zod. Never trust input.
- **"Input" is not only HTTP, and that reading is what `F4.36` cost us.** The
  rule above was applied to every controller body and to none of the inputs that
  do not look like a DTO. The `bms_telemetry` `NOTIFY` payload was `JSON.parse`d
  and cast straight to `TelemetryReading[]`, and it reaches browsers over
  Socket.IO — so an unvalidated non-HTTP input had a shorter path to a client
  than any endpoint. It also stopped alarm evaluation: one `null` reading threw
  inside `AlarmThresholdService.collapseLatest`, which runs before any rule, and
  the throw is caught as a *warning*, so a single bad entry silently suppressed
  alarms for every good reading beside it. **The privilege boundary is the part
  worth remembering** — `NOTIFY` requires no table privilege at all, so a role
  with bare `CONNECT` and zero read access can publish to that channel. When
  validating a non-HTTP input, two things follow that a DTO does not need: bound
  the work (validation is dearer than a cast, and a size limit on the *payload*
  may not bound the number of *items*), and log rejections by **field path
  only** — a rejected payload is data of unknown provenance, so echoing it turns
  a validation failure into a log-injection surface.
- **Every CSV response goes through `src/serialise/csv.ts`** (ADR 0026). Never
  hand-roll cell escaping, even for "just two columns" — the repo had two exports
  with two rules and one of them omitted the formula guard, which is how an asset
  code beginning `=` reached a client's spreadsheet as a live formula. Text takes
  `csvTextCell`, **numbers take `csvNumberCell` and are deliberately unguarded**:
  Excel's formula reading of a numeric literal is the number itself, and prefixing
  an apostrophe would import the client's figures as text. Do not decide the split
  with a regex over the produced string — the two functions' parameter types decide
  it, and a raw string in a row is a compile error because `CsvField` is branded.
- **Build the rows where they can be tested without a `Pool`.** `energyCsv` had its
  rows inline in the service and was therefore never executed by a test at all,
  even after `F4.28` gave the rest of that file coverage. Serialisation lives in a
  pure `*.serialise.ts` beside the service — `admin/audit/audit.serialise.ts` and
  `reports/reports.serialise.ts` are the two models.
- **The API description is generated from the Zod schemas, never written
  alongside them** (ADR 0029). `@nestjs/swagger`'s decorators do not work here
  and it is worth knowing why before reaching for them: they derive schemas from
  TypeScript metadata on DTO classes, this codebase has none — `class-validator`
  and `class-transformer` are absent and 13 controllers declare
  `@Body() body: unknown` — so the generated document would describe every
  payload as an untyped object while looking complete. A new route is joined to
  its schema in `src/openapi/openapi-registry.ts`, keyed by Nest's
  `operationId`, and its schema must live in a `*.schema.ts`: one declared inside
  a controller is invisible to the registry and its payload silently vanishes
  from the document.
- **Follow every `.refine`/`.superRefine` with a `.describe()`, in that order**
  (ADR 0029 Amendment 1). `zod-to-json-schema` emits **nothing** for a
  refinement — no marker, no warning — so the document is strictly *more
  permissive* than the validator wherever one is unexplained, and a caller who
  trusts it receives a `400` the document says is impossible. Measured: 63
  schemas convert with zero failures while 11 refinement sites vanish. The
  message cannot be recovered from the schema (`.refine` captures it in a
  closure; `_def.message` is `null`), which is why the prose is authored rather
  than extracted. Order matters and fails silently:
  `z.string().describe("x").refine(…)` yields **no** description, because
  `.refine` wraps the described schema in a new `ZodEffects`.
  `tests/adr-0029-openapi-contract.test.ts` fails the build on both.
- **Where the OpenAPI docs are served they are unauthenticated, so they are
  absent by default** (ADR 0029 Amendment 2). There is no guarded state and
  attempting one is wasted work: Swagger UI does not send an `Authorization`
  header when it fetches the spec, so a guarded document renders as "No
  operations defined in spec!" and nothing in the page can recover it.
  `API_DOCS_ENABLED` gates the whole route — unset means on everywhere except
  `NODE_ENV=production`, and the API image sets `NODE_ENV=production`, so the
  compose stack serves nothing until a developer opts in through their own
  `.env`. Turning it on publishes the complete route inventory, including the
  §4.7 operations matrix and the ADR 0012 credential endpoints, to anyone who
  can reach the port. **Do not describe an enabled instance as protected.**

### 4.4 SQL (Postgres / TimescaleDB)
- Schema-qualified (`bms.assets`, `telemetry.point_values`).
- Snake_case columns. `TIMESTAMPTZ` everywhere.
- Parameterised queries only.
- Migrations are forward-only. Never edit a merged migration.
- **A migration authored after ADR 0045 runs as `bms_owner`, and must not
  require `SUPERUSER`.** The migrator still *connects* as `bms_app` — a fresh
  database replays the whole chain and `0039:33` needs the attribute — but every
  file that touches schema objects opens with `SET ROLE bms_owner` and closes
  with `RESET ROLE`. If a statement you need cannot run without `SUPERUSER`
  (`CREATE ROLE`, `ALTER ROLE … BYPASSRLS`, `CREATE EXTENSION`), it does not
  belong in a migration at all — it belongs in `packages/db/src/roles.ts`, which
  runs before `db:migrate` as the provisioning identity.
  **Both halves are gated by `tests/adr-0045-owner-and-superuser-url.test.ts`,
  and the `RESET ROLE` is the half that bites**: a forgotten one leaks past
  `COMMIT` into the session, so drizzle's own journal `INSERT` and every later
  file in the same run execute as `bms_owner`, which holds no grant on the
  `drizzle` schema. Measured, not predicted.
- **Objects created by a new owner need their own default privileges.**
  `ALTER DEFAULT PRIVILEGES` applies only to objects created by the role it
  names, so `0039`'s four `FOR ROLE bms_app` statements stopped covering
  anything once `bms_owner` began creating tables; `0041` mirrors all four
  (TABLES *and* SEQUENCES, both schemas). A new grantee role, or a third schema,
  needs the mirror too — the failure is a new table reaching **no pool role at
  all**, which surfaces one endpoint at a time rather than as a migration error.
- Telemetry table is a Timescale hypertable; `chunk_time_interval = 1 day`.
- **The retention ladder (ADR 0024, migration `0028`)** — raw `point_values`
  compresses at **7 d**, drops at **730 d**; `_1m`/`_5m` compress at 7 d, drop at
  **735 d**; `_1h`/`_1d` are **never dropped and never compressed**. Do not
  "tidy" 735 to 730: an aggregate must outlive its source **strictly**, or the two
  independent policy schedules can leave raw holding a period its aggregate does
  not — which reads as **empty**, not as an error, and which no refresh repairs.
- **Read telemetry rollups through `apps/api/src/telemetry/point-aggregates.ts`,
  not with your own `date_trunc`/`time_bucket` SQL** (ADR 0023). The mean is
  `sum(sum_value) / sum(sample_count)` — **never** an average of averages, which
  was wrong in 151 of 169 buckets on real data and which a total-level test does
  not catch. Never add an `avg_value` column to an aggregate.
- **Pick the level with `levelForRange`, never an inline ternary, and never from
  the window's duration alone** (ADR 0025). Retention is about how far *back* a
  range reaches: a duration-keyed selector routes a 24-hour range dated three
  years ago to `_1m`, which drops at 735 days and then reads as **empty**, not as
  an error. The range's `end` is not an input — it is routinely in the *future*,
  because `reports.service.ts` sets it to `endDate T23:59:59.999Z` and because the
  ingest writes ahead of `now()`.
- **Use `bucketHours()` for every kWh figure, including where the factor is 1, and
  for *every* energy term in a query rather than just the total.** Two reports
  queries treated `SUM(kw)` as kWh directly — right only because the buckets were
  hours, and written down nowhere. No test can catch either mistake while the
  level makes the factor `1`, so both are asserted statically in
  `tests/adr-0025-level-selector.test.ts`.
- **When a guarantee cannot be expressed as a behavioural test, write a static one
  — and say which it is.** ADR 0025 has two: a rollup read reverting to
  `date_trunc` over raw is invisible to every parity test, because those compare
  against the raw query being replaced and a revert compares it with itself
  (measured — a fully reverted `loadTrend` left the suite green); and a dropped
  `bucketHours` factor is invisible while the factor is 1. `tests/` is where these
  live, beside the ADR 0017 write-gate check. **ADR 0026 adds a third, and a
  cheaper mechanism worth reaching for first:** a second copy of the CSV escaping
  rule is caught statically, because a new export with its own escaping passes its
  own tests perfectly — but the guarantee that an *unescaped* cell cannot enter a
  row is a **branded type**, so it is a compile error rather than any kind of test.
  When a type can carry the invariant, prefer it; a static test is the fallback,
  not the goal.
  **ADR 0016 §6 commit 4 adds a fourth, and it is the clearest case of why the
  mechanism has to be static:** nothing fails when a *second* ingest entry point
  merely appears — a resurrected `src/index.js` beside `main.ts` reads as an
  addition, not a regression, and every existing test still passes. Same for a
  reintroduced `INGEST_NOTIFY`. Both are pinned in `tests/repo-invariants.test.ts`.
  A test that is *invariant under the change it guards* is the recurring trap here
  — `F4.1` shipped one, `F4.28` shipped two more, and `F4.29` shipped a third, each
  caught in review. Assume your new guard has this defect and **mutate the code to
  prove it fails**; six of the seven instances looked convincing until someone did.
  **And mutate against the shapes you did not write, not only the one you did**:
  `F1.1`'s invariant matched `env.INGEST_NOTIFY`, which looks tight and is weak —
  `env["INGEST_NOTIFY"]`, `const { INGEST_NOTIFY } = env`, a `getEnv("…")` helper
  and compose's list form `- KEY=value` all walked through it, and the compliance
  review found all four. Strip comments and match the name.
  **`F4.34` adds a fifth instance with a different mechanism, and it is the one
  to watch for next**: the guard was not weak, it was **unreachable**. A new
  reconnect stability window keyed off `connectedAt`, using `0` for "never
  connected" — and the injected test clock legitimately read `0`, so the two
  aliased, the reset never fired, and the mutation deleting the window
  *survived*. A sentinel that collides with a legal value silently kills the code
  it guards, and no assertion about behaviour can see it because the behaviour
  never runs. The same round also had a test that asserted on Node's
  `MaxListenersExceededWarning` to prove an abort-listener leak; that warning is
  never emitted for an `AbortSignal`, so the test passed either way. **Assert on a
  count you can read** (`getEventListeners(signal, "abort").length`), never on a
  diagnostic you hope the runtime emits.
  **`F4.37` adds a sixth instance, and its mechanism is neither weakness nor a
  sentinel collision: the guard was correct and simply never ran again.**
  Staleness is computed during render, so it is only re-evaluated when something
  re-renders — and the only thing that reliably did was an incoming reading. The
  guard exists to detect readings *stopping*, so in exactly the case it was
  written for, nothing re-invoked it and every tile froze on its last verdict.
  The clamp underneath it was fully unit-tested and would have shipped doing
  nothing. **Ask what re-invokes a guard, not only whether it is right** — a
  guard whose trigger is the signal it watches for the absence of can never
  fire. This class does not appear in a unit test, because the test calls the
  function itself; here it took a static invariant to hold the wiring, and both
  deletions that disable it (removing the timer, dropping it from the context
  memo) left 53 of 54 test files passing.
  **`F4.38` adds a seventh, and it is the one to watch whenever you write a
  static invariant**: the guard was defeated by an **unrelated legitimate call to
  the same function in the same file**. The invariant asserted that each
  control-room page calls `isStale(` — searching the whole file. Two pages call
  it a second time for an unrelated header value, so deleting the *status guard*
  outright, restoring the very defect the item fixed, left every test green.
  Reproduced before fixing: the same deletion on a page with one call was caught;
  on a page with two it was not. **Scope a static check to the construct it is
  about** — the function body, the dependency array, that specific call — never
  to "does this token appear anywhere in the file". A file-wide search is
  satisfied by a decoy, and the decoy is usually code you wrote yourself for a
  good reason. The same round produced two more invariant defects deserving the
  same suspicion: one regex **failed on clean code**, so its "kill" was spurious;
  another passed on clean code and still let the mutation through, because it
  matched a different call site. **Run every new invariant against the unmutated
  tree first** — a check that fails on clean code proves nothing when it fails on
  mutated code.

  **`F4.39` adds an eighth, and it is about how you *choose* mutations rather
  than how you write the check.** Its invariants were mutation-tested and passed
  — against the shapes their author had just written. Two review rounds then
  killed **nine** more, three of which mattered: restoring the two literal
  battery voltages, *verbatim the defect the item existed to fix*, passed
  everything; gutting both marker components so they rendered `{children}` left
  every call site correctly wrapped, the unit spec green, and **no marker
  visible anywhere in the application**; and hoisting an offset one line up
  (`const voltageY = q1.voltage + 0.7`) moved it outside the construct the scan
  reads. **Mutate against the shapes you did not write** — the original defect
  restored verbatim, the guard rendering nothing, the expression hoisted out of
  the construct. And note the second of those is the `F4.37` class arriving from
  a new direction: every check asserted that *call sites use* the guard and none
  asserted the guard *does* anything, so write the check that the thing you are
  enforcing with is itself alive.

  **`F4.23`/`F4.43` add the other end of this, and it is the one that makes you
  delete work you are proud of.** The bullet above says to prefer a type over a
  static test. Prefer **construction** over both: `F4.43` built its read
  vocabulary as `[...authorableRuleCategorySchema.options, "electrical"]`, so
  "the read vocabulary contains the write vocabulary" was true by the way it was
  written and there was nothing left to check. **The corollary is that the guard
  you would have written must then be deleted, not kept** — a tautology that was
  meaningful when it was written is the hardest dead guard to notice later,
  because its history argues for it. Two instances in two items: `F4.23` proved
  the schema migration with **81** assertions of strict type identity between
  each schema and the type it replaced, then deleted all 81 — after the switch
  they compare `z.infer<typeof S>` with itself; and `F4.43` did not write the
  containment test at all, for the same reason one line later. Neither deletion
  loses a guarantee. What survives is the part that is *not* structural, which
  for `F4.43` is "nobody restates a vocabulary" — a **source scan**, deliberately,
  because comparing the two enums' values passes just as happily when someone
  re-inlines the literal and keeps it in sync today.

  **`F4.45` is what this rule looks like when it comes due, and it is worth
  reading before you argue for keeping something.** `F4.44` had built a lock so
  the rule builder could show a category no operator may author; it was correct,
  load-bearing, and the only thing protecting 48 rules while the vocabulary
  question was open. ADR 0031 then made a non-authorable category *structurally
  impossible*, so the lock could never fire again — and it was **deleted**, along
  with its module. Two things made that happen rather than drift: the lock's own
  spec carried an assertion saying *if these two vocabularies are ever equal,
  this module should be deleted rather than left passing*, and it **fired**; and
  the ADR named the exact symbols to remove in its Consequences. **Write the
  tripwire that tells the next person your guard is dead**, because by then its
  history will argue for it and the code will still be green.

  The same item is also the cautionary half. A guard is only as good as its
  ability to match its own subject: `F4.45`'s first attempt at a
  "nobody re-inlines the enum" scan searched for `assetDomainSchema`, a symbol
  that **has never existed in this repo** and is not even a substring of the
  live `assetDomainCodeSchema` — so a real revert would have walked through it
  reporting success. If you write a source scan, add a case that proves the
  pattern still matches a violation, or you have written a comment.

  The same item produced a corollary worth its own sentence: **fixing the
  instance is not fixing the class.** Two findings from one review round were
  each "the same defect one call site over" from a fix made in the round before
  — a helper applied to a detail card but not the summary table beside it, a
  threshold extracted and adopted on one page while the page that named the
  concept kept both its copies. Both fixes then survived mutation themselves
  until a check was added for the class. When a review hands you an instance,
  grep for its shape before calling it closed.
- **A `DELETE` from `telemetry.point_values` does not remove the aggregate rows,
  and no scheduled policy repairs it.** Follow any such delete with
  `refresh_continuous_aggregate` over the deleted range for all four levels,
  finest first. Migrations `0014` and `0021` are precedents that predate the
  aggregates; the next one of that shape must do this. `F4.1`'s own test suite
  violated this rule and orphaned aggregate rows on every run — fixed in `F4.2`.
  **Copy what those two migrations do about aggregates, not how they write the
  delete** (`F4.40`) — see the next bullet, which they would now fail.
- **A `DELETE` from `telemetry.point_values` must filter `asset_id` or
  `point_key` with a *constant*, and must not reach the table through a
  subquery, CTE or join.** Migration `0028` segments the table by those two
  columns, so a constant filter on either is evaluated against compressed
  batches without opening them. Anything the planner cannot fold to a constant
  makes TimescaleDB decompress **every** batch to evaluate the predicate, and
  past `max_tuples_decompressed_per_dml_transaction` (100000) that is a hard
  error, not a slow query. Measured in `F4.40` on a dev database with 4 of 15
  chunks compressed: **186706 tuples decompressed while matching zero rows** —
  the cost is set by what the statement must *examine*, not by what it deletes,
  which is why no amount of scoping the target helps. Resolve ids in a prior
  statement and filter on them directly. A time bound also avoids it and is the
  weaker fix: it holds only while no compressed chunk falls inside the bound,
  which silently couples the caller to this file's 7-day threshold.
  `tests/adr-0024-retention-bounds.test.ts` holds this for `.ts`. It cannot hold
  it for `.sql`: `0014` and `0021` both use `DELETE ... USING <temp table>`,
  they were correct when written, and they are merged and forward-only — so the
  rule for the next migration lives here and nowhere else.
- **But that rule is conditional, and ADR 0024 is what made it so: refresh only
  where raw still holds the range.** Since retention exists, a refresh over a
  range raw has *dropped* is the opposite of a repair — it recomputes from an
  empty source and **deletes** the rows, and where that range is older than raw's
  730 days those `_1h`/`_1d` rows are the only surviving record of the period.
  Measured: 34,596 aggregate rows to 7,068. Nothing rebuilds them. So: raw still
  covers the range → refresh it; raw no longer does → the aggregate **is** the
  archive, leave it alone.
- **And there is a third case, which ADR 0025 added: nothing was ever
  materialised, so there is nothing to repair and a refresh would be the harmful
  act.** `F4.28`'s suite dates its fixture **ahead of `now()`**, and no refresh
  policy or script in this repo passes an upper bound later than `now()` — every
  policy stops at `now() - end_offset`. So its rows never enter an aggregate, and
  its `DELETE` cannot orphan anything. Refreshing over that range instead would
  push a watermark into the future and degrade the database permanently, which is
  the failure ADR 0023 warned about. **This exemption is only available if you
  prove it**, not if you assume it: that suite asserts the fixture is visible only
  through the live branch, asserts every policy's `end_offset` is strictly
  positive, and asserts after the delete that all four views hold **zero** rows for
  its assets. Without those three, follow the rule above.
- **Never refresh a level over a range its own source cannot supply**, and note
  that only `_1m`'s source is raw — `_5m` reads `_1m`, `_1h` reads `_5m`, `_1d`
  reads `_1h`. `pnpm db:refresh-aggregates` derives a per-level floor for exactly
  this reason. A single floor taken from raw and applied to all four is correct
  only for `_1m` and silently destroys `_1h`/`_1d` whenever raw's retention runs
  ahead of `_1m`'s.

### 4.5 Style hygiene
- File names: `kebab-case` for files, `PascalCase` for React components.
- No abbreviated domain words (`asset`, not `as`; `alarm`, not `alm`).
- Max **1000 lines per file** in the current phase.
- No `console.log` in committed code; use the shared logger (Pino).
- No emoji in code or commits unless explicitly requested.

### 4.6 Testing (ADR 0014)
- **Runner: Vitest.** `pnpm test` runs everything; `pnpm test:coverage` is what
  CI enforces. Never add a second runner without an ADR (§9.4).
- **Assertions live in `*.spec.ts`; `*.test.ts` is the wrapper that runs them.**
  A `.spec` without its sibling `.test` is dead code — `tests/repo-invariants.test.ts`
  fails the build if you add one. Do not delete the spec to make it pass.
- **Carve-out: the split applies to `apps/**` and `packages/**` only.** Files in
  the top-level `tests/` directory are repo-wide invariants and hold their
  assertions **inline**, with no `.spec` sibling. Giving `repo-invariants.test.ts`
  a `.spec` partner would mean the file enforcing the convention is the one file
  that cannot follow it. Do not "fix" these into the split.
- **Integration suites gate on `DATABASE_URL`, and the gate is asymmetric.** An
  unset `DATABASE_URL` skips locally but **throws under `CI`** — a green CI run
  that silently skipped the database tests asserts nothing. A *set* one is a
  claim that a database exists, so a failed connection fails everywhere rather
  than skipping. Coverage thresholds assume these suites ran.
- **CI's database is created per run, so it has no history — and the asymmetry
  runs the other way too** (`F4.40`). Everything that accrues over a database's
  life is absent there by construction: compressed chunks, retention having
  fired, watermarks, and every lifetime counter in
  `timescaledb_information.job_stats`. A suite can therefore be **permanently
  green in CI and structurally red on every real database**, which is worse than
  the reverse, because the pipeline reports success while the people who run the
  suite learn to ignore it. Two instances, both found on `main` with CI green:
  a fixture cleanup that failed on any database older than the 7-day compression
  threshold — every developer's, after the first week — and an assertion that
  `job_stats.total_failures = 0`, a cumulative counter that never resets, so one
  transient failure reddened the suite for the life of that database (measured:
  1 failure against 432 successes, `last_run_status = Success`, the aggregate
  current). **Never assert on a lifetime counter**; assert the thing that
  describes now, which for a policy is `last_run_status`. And when a check can
  only ever fail outside CI, say so where it is written — that is a static
  invariant's job, not a suite's. Held in `tests/repo-invariants.test.ts`.
- New behaviour ships with its test in the same PR. Bug fixes ship with the
  test that would have caught the bug.
- **Coverage is a ratchet, not a target.** Thresholds in `vitest.config.ts` sit
  just below the current measurement; raise them as coverage rises. Never lower
  a threshold to make a build pass, and never use `thresholds.autoUpdate` —
  that converts the gate into a rubber stamp. `docs/AGENTS.production.md` §10's
  80% lines / 70% branches remain the destination, not the current rule.
- A check that CI does not execute is not a gate. When you add a test suite,
  script, or invariant, wire it into `.github/workflows/ci.yml` in the same
  change — this repo has shipped orphaned specs and orphaned migrations before.
- **A new file in `tests/` must be added to the root `typecheck:tests` script by
  hand.** That script names each file explicitly rather than globbing, because
  `tests/` has no `tsconfig.json` of its own and the flags are passed on the
  command line. So a new invariant file is type-checked by nothing until it is
  listed, and `pnpm test` passing tells you only that it *ran* — vitest strips
  types with esbuild and never checks them. `F4.23` and `F4.43` each added a file
  and each had to edit that line.
- **You cannot instantiate a Nest module in a test here, and it is not worth
  discovering that twice** (`F4.20`). Vitest transforms TypeScript with esbuild,
  which does **not** emit `design:paramtypes`, so Nest's constructor injection
  resolves every dependency to `undefined`: building `AppModule` dies in
  `TelemetryGateway.afterInit` with `this.hub` undefined, and no websocket
  adapter fixes it because the cause is missing metadata. That is why every
  integration suite here constructs services directly — `new
  DashboardService(pool)` — and it is a constraint rather than a style. Changing
  it means an swc transform, which is a §9.4 dependency ADR. Until then, a
  guarantee that needs the running application is either a static check over the
  source or a documented manual verification — **and if it is manual, say so in
  the test that stands in for it**, so the substitute is never mistaken for the
  gate.
- **A static check is not a substitute for reading what is served.** `F4.20`
  shipped a green suite, `pnpm typecheck`, `pnpm typecheck:tests` and a static
  invariant, and the served document still (a) published every route
  unauthenticated through `swagger-ui-init.js`, (b) dropped every cross-field
  rule from its query schemas, and (c) could not be read at all from the UI it
  shipped with. All three were found by fetching the document from the running
  container. §4.6's deployment rule is not a formality for UI work.

**Green tests are not a deployment. Verify every item against the running
Docker stack before calling it done** — the database, the API and the browser,
whichever of the three the change touches. State the result in the closure
record, and name the layers that were **N/A** rather than omitting them, so a
reader can tell "not applicable" from "not checked".

This is not ceremony. Every item that has done it found something the suite
could not:

- `F4.28` — the running API container was still serving *compiled* code from
  before the change. Proved stale by grepping `dist/` for the old query, then
  rebuilt. A passing suite says nothing about what is deployed.
- `F4.34` — the pre-fix crash was reproduced against a live Postgres by
  terminating the connection server-side, which is what established it was an
  API-wide outage rather than a stale-dashboard defect.
- `F4.36` — publishing one malformed payload showed the real damage was
  **alarm suppression**, not a cosmetic cast. That reframed the item and settled
  its open design question on evidence.
- `F4.38` — the deployed page rendered four leak sensors as `DRY` and four smoke
  sensors as `NORMAL` after three hours of silence. It also exposed a bug no test
  could reach (one tile read "4 sensors · 8 stale") and raised `F4.39`.

**Prove the artifact is not stale before you read anything from it.** A rebuilt
image and a reloaded page are different things:

- Containers serve the image they were started with. `docker compose build` does
  not restart anything — `up -d <service>` does. Confirm the new code is really
  in there (grep the compiled output, or check the served bundle hash).
- **The browser caches the bundle, and a cached read looks exactly like a failed
  fix.** In `F4.38` the first page read after a correct rebuild showed the
  pre-fix output; a hard reload showed the fix working. Had that been taken at
  face value it would have sent someone debugging code that was already right.
  Hard-reload, and confirm the served asset hash changed.

**Check both directions.** That the defect is gone is half of it; the other half
is that the fix does not fire when it should not. `F4.38` stopped the simulator
to watch tiles go stale, *and* ran it to confirm live assets still render
normally — a staleness gate that marks healthy plant offline is its own defect.

### 4.7 Authorization (ADR 0009/0010 master data · ADR 0017 operations)

Two role gates exist and they are **not** interchangeable. Both resolve the
role from **`bms.users`, never from the JWT claim** — a token outlives a
demotion by up to `JWT_TTL`, and in OIDC mode `roleFromClaims` falls back to
`viewer` when realm roles are missing, so reading the claim fails *open* on
demotion and *closed* on a claimless admin token.

**Master data** (`/admin/*`) — scope predicates on `AccessControlService`:
`writableOrganizationIds` / `writableLocationIds` return `null` for the
unrestricted global admin, and an **empty array is a real user with no grants**
who must see nothing. Never treat the two as equivalent.

**Operations write matrix** (ADR 0017) — mutating endpoints across rules,
alarms, work orders and maintenance carry
`assertOperationsWriteRole(jwt, class)` at the top of the handler, **before**
the scope check, so a role rejection never depends on scope resolution. The
class literals are exactly `OperationsWriteClass` in
`apps/api/src/auth/operations-write.ts`:

| Class | What it means | `operator` | `viewer` |
|---|---|:-:|:-:|
| `configuration` | changes what the system *will* do, indefinitely — rule authoring, schedule definition, `rules/evaluate`, `rules/preview` | ❌ | ❌ |
| `operational` | records what *did* happen — alarm ack, work-order lifecycle, converting a due schedule | ✅ | ❌ |

The four admin roles keep exactly what they had; this gate regressed nobody.
`rules/preview` is `configuration` despite looking read-only — it inserts a
`rule_preview` row into `bms.audit_log` on every call. **The gate is additive:
callers must pass this AND the existing scope check.**

Instantiating an asset template is the one place the two systems meet: it needs
template *readability* plus `canManageLocation` on the target, so a location
admin may deploy a published org template without being able to author one
(ADR 0015 §7 as amended). Do not require `canManageTemplate` there — it means
"may author" and is false for exactly that role.

**Audit read** (ADR 0021, `F4.14`) — a **third** gate, reusing neither of the
two above. `bms.audit_log` has no tenancy column, so the master-data scope
predicates cannot apply to it. `AuditAdminService.requireGlobalAdmin` runs two
checks in order: a matching **`bms.users` row must exist**, and only then must
`writableOrganizationIds` be `null`.

**The first check is not redundant — Amendment 1 exists because it was
missing.** Before ADR 0044, `resolveDbUser` deliberately fell back to the JWT
claim when no row matched, so in OIDC mode (what compose and the pilot run) an
*unprovisioned* Keycloak principal holding realm role `admin` resolved to
`role: "admin"` and a `null`, unrestricted scope. Every other `/admin/*`
endpoint constrains that with a second scope check; on audit read the `null`
**is** the whole control. Without the provisioning check the endpoint served
the entire log — every organisation, every verbatim `payload`, every actor
email — to anyone the IdP called an admin, and deleting a user's row would
have **escalated** them rather than revoked them. Reproduced against a real
database before the fix. **ADR 0044 (2026-08-24) closed the `admin` branch
specifically**: `resolveDbUser` now refuses an unprovisioned `admin` claim
outright (`ForbiddenException`), so this endpoint's own control gap is gone.
Every other role's claim-fallback is unchanged, on purpose —
`organization_admin`/`location_admin`/`operator`/`viewer`/`asset_group_admin`
all already fail closed via a grant-table lookup keyed by user id, never the
unrestricted `null` sentinel. If you add an endpoint whose only control is an
unrestricted scope for a non-`admin` role, check that role's fallback
behaviour before trusting it.

**Onboarding** (ADR 0022, `E8.3`) — a **fourth** gate. Every onboarding entry
point requires role `admin` or `organization_admin` **plus**
`canManageOrganization` on the session's organisation, and both checks live in
**one place**: `OnboardingService.loadSession` → `assertOnboardingAccess`.

Because it sits there rather than on individual handlers, it covers
`getSession`, `chat`, `patchDraft`, `uploadExcel`, `validate` **and**
`setCredentials` together. That placement is the fix, not an implementation
detail: the read gate was once `canManageOrganization` alone while the write
gate also required the role, so a `location_admin` could read a session they
could never create — and `uploadExcel`, sitting on the weaker gate, let them
write credentials by workbook. **Do not re-narrow this to `getSession`.** If you
add an onboarding handler, route it through `loadSession`; a handler that reads
the session any other way is outside the gate.

**Standing obligation (ADR 0021 decision 6).** `audit_log.payload` stores the
verbatim request body at **twelve** call sites — assets, asset-points,
locations, organizations, point-keys and RTUs, create and update each — and the
read API returns it verbatim. None of those Zod schemas admitted a credential,
password, secret or token field when checked on 2026-08-09. **Adding a
secret-bearing field to any audited request body, or to a schema behind one,
creates an audit-read exposure**, so re-run that check whenever one changes.
The obligation is on the call sites, not on one writer: there are 15
`insert(auditLog)` sites in total and 14 do not go through
`MasterDataAuditService`.

### 4.8 Shared API contracts (ADR 0030)

A response type and its schema are **one declaration**. `packages/shared/src/`
holds the type as `z.infer<typeof …Schema>`; the schema lives in
`contracts/`. Writing both by hand is how they drift, and the drift is
invisible because the hand-written type is what the compiler believes.
`tests/adr-0030-contract-derivation.test.ts` fails the build on a hand-written
response type in `index.ts`.

**Three encodings preserve type identity and their obvious siblings do not.**
Measured on **9** conversions in the ADR's spike, each asserted against *two*
bars — strict conditional-type identity and mutual assignability — for **14
measurements** in total. They produced **3 strict
failures and 0 assignability failures**, so the strict bar is the only one that
discriminates: under assignability alone all three wrong encodings pass
silently and the package starts flattening intersections with no signal
anywhere.

- `A & B` → **`z.intersection(a, b)`**. `a.merge(b)` flattens the two into one
  object type, which is assignable to the intersection and is not it.
- `Omit<A, k> & B` → **`z.intersection(a.omit({…}), b)`**. `.omit().extend()`
  flattens the same way.
- An all-`readonly` object → **`.readonly()`**. The modifier is the thing that
  is lost, not the property types; `Date` converts fine via `z.date()`.

The check on those is a source scan for the flattening combinators in
`contracts/`, not a type test, because a flattened schema still typechecks
everywhere it is used.

**A required `unknown` property cannot be expressed.** `z.unknown()` produces an
*optional* key — Zod marks any key whose output includes `undefined` — and
there is no passing sibling: `z.any()` and `z.custom<unknown>()` behave
identically. Do not spend an afternoon on it as this repo already has. Record
the gap where the schema is, as `auditLogEntryDtoSchema.payload` does.

**Validate at the boundary; never transform there.** `checkResponse` returns the
**original payload**, not `result.data`. Zod strips unknown keys, so returning
the parsed value silently deletes any field the server has added since the
schema was written — a validator that quietly edits the data it validates is
worse than none. And **the failure direction is not symmetric**: throw in
dev/test so drift is impossible to ignore, log-and-pass in production because a
blank Control Room during an incident is a bigger outage than one wrong field.
Log **`path` and `code` only** — a Zod issue carries the received value, and
§9.6 applies to a console on a shared operations workstation exactly as it
applies to a log file.

**A vocabulary is declared once and everything else is derived from it.**
Re-export rather than restate across package boundaries:
`apps/api/src/rules/rules.schema.ts` exports the shared schema under its own
name, which is that file's own rule — *a copied enum is a copy that drifts* —
finally applied to itself.

**Where a read vocabulary genuinely must be wider than a write vocabulary,
build the wide one from the narrow one's `.options`** so the containment holds
by construction rather than by a test (§4.4). `F4.43` did exactly that —
`automationRuleCategorySchema` was `[...authorableRuleCategorySchema.options,
"electrical"]`, because migration `0022` wrote `electrical` directly and no
operator could author it. **That asymmetry is gone**, and the rule is kept here
as history rather than deleted, because the shape recurs: `F4.45` ended it not
by narrowing or widening either union but by noticing the two vocabularies were
*different axes*. So before you build one union out of another, check that the
wider one is genuinely the same kind of thing — an asymmetry that will not
resolve is often two vocabularies wearing one name.

**Before you declare a vocabulary, decide whether it is closed or open, because
they want opposite mechanisms.** ADR 0031 is the worked example, and it got this
wrong first.

- A **closed** vocabulary is one the business cannot extend without a code
  change anyway: a badge's *tone*, an operator — things the engine itself must
  understand **and cannot be told at runtime**. Declare it as a `z.enum`, back it
  with a `CHECK` if it is stored, and lean on exhaustive `switch`.
- An **open** vocabulary names *what a thing is* in the customer's world, and it
  grows with the business: a plant **domain**, a rule's **concern**, and an alarm
  **severity**. Put it in a table with a foreign key. A foreign key is
  **stronger** than a `CHECK`, not weaker — the column still cannot hold an
  undeclared value — and adding one becomes an `INSERT` a domain pack ships in
  its own seed rather than a migration and a deploy.

  A concern looks closed and is not, which is why it is listed here rather than
  above: four values have covered every rule so far, but the owner's ruling was
  *"categories should be configurable"*, and nothing in the engine branches on
  one — it is a badge, a filter and a sort key. **Whether the engine must
  understand a value is the test, not how stable the list looks.**

  **That test has a third answer, and severity is it (ADR 0032).** Severity was
  listed as *closed* above until `F4.46`, and by the test as stated it belonged
  there: the engine really does rank it, colour it, and will escalate on it. So
  the row asked for a `z.enum` and a `CHECK`, cited ADR 0031, and was building on
  a premise nobody had ruled — ADR 0031 does not mention severity at all.

  What the test misses is that *"the engine must understand it"* is a statement
  about **what the engine needs**, not about **where that has to live**. A value
  arrives unusable only if it arrives with nothing the engine can act on. Give
  the table the columns the behaviour needs — `bms.alarm_severities` carries
  `rank` for ordering and `tone` for colour — and a level declared by an `INSERT`
  arrives sortable and styled. **A vocabulary is only closed if the behaviour
  cannot be carried as data.** So before reaching for a `z.enum`, ask what the
  engine actually needs to know, and whether that is one more column.

  The practical difference is the whole point: client ask **B9** may add a fourth
  severity. Under the `CHECK` that costs a forward-only migration and a deploy;
  under the table it is one row, and the ranks are seeded 10/20/30 precisely so a
  fourth fits between two existing ones without renumbering live rows.

  **Two traps come with taking this route**, both paid for in `F4.46`. The
  *presentation* half stays closed and keeps its `CHECK` — `tone` is owned by the
  frontend and a value outside `StatusPill`'s palette renders nothing. And every
  **hand-written list** that reads the column silently goes stale: severity's
  `normalizeSeverity` was an `if` over three string literals that rewrote a newly
  seeded level to `warning` on every alarm it raised, and four SQL predicates
  matched severity codes rather than tones. Nothing in the type system pointed at
  any of them. **Opening a vocabulary invalidates every closed list that reads
  it, not only the ones the compiler can find** — grep for the *values*, not just
  the type.

The tell is not the current data. `assets.domain` held exactly four values
across all 148 rows, which is what a census showed and what a four-value `CHECK`
was ruled on; the roadmap had already scheduled **three domain packs**
(`E5.1`/`E5.2`/`E5.3`), so that list was known-wrong on a shorter timescale than
the roadmap itself. **Ask what the roadmap intends to add, not what the table
currently holds** — and migrations here are forward-only, so guessing wrong
costs a second one.

**Two consequences that are easy to miss when a vocabulary opens up.** An
exhaustive `switch` over it cannot stay exhaustive, so move the exhaustiveness
onto something that *is* closed — `rules-panel.tsx`'s `categoryStyle` became
`toneClass` (the unrelated `categoryStyle` in `maintenance-schedules-panel.tsx`
is still live and still correctly an enum switch), switching
on `rule_categories.tone`, so a newly seeded category arrives styled instead of
rendering the literal class `"undefined"` the way `F4.43`'s 48 badges did. And
the request schema stops rejecting unknown values, so an unknown code reaches
the database and returns a **500 where Zod gave a 400 naming the options** —
put the check back at each write boundary (`VocabulariesService`) rather than
letting the constraint be the error message.

**A vocabulary describing what a thing *is* belongs on the thing.**
`automation_rules.category` carried `electrical` for as long as migration `0022`
had been deployed, and that was never a concern — it was the *asset's* plant
domain, copied onto rows that reference it. One column holding two axes forces a
false choice, and it produced three items' worth of defects. `bms.assets.domain`
already held the fact, correctly, and unused.

**Widening a response union to make a validator pass is a scope decision, not a
fix.** `F4.43` widened one only after establishing from the migration that the
value was legitimate; the alternative reading was bad seed data, and the two
have opposite fixes. Ask which it is before editing the schema — and note that
what the database will tell you has changed: since `F4.45`,
`automation_rules.category` and `assets.domain` both carry foreign keys, but
`automation_rules.source` still has **no** constraint at all.

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
- **Clamping a device timestamp at ingest, and widening the enabled RTU set.**
  `F1.7` left both open on purpose. `parsePayload` takes the envelope's `ts`
  verbatim and nothing bounds it; measured 2026-08-22, the twelve PHE devices
  span **−3:02:36 to +34:31** against the server, and all five *enabled* ones
  run ahead — so each reads online for as long as its clock leads after it dies.
  `F4.37` closed the sink-side half and named `F1.7` as where the ingest-side
  clamp belongs, then called the trade a **product call**: clamping forward only,
  substituting receive time past a bound, and recording both times are three
  different answers with different costs, and choosing is the owner's under §10
  (see `F4.57`). Likewise the four RTUs held out of the set are held for measured
  reasons — two with dark meters (`F4.58`), two whose rows land outside every
  dashboard window — and enabling one takes its assets from simulated to dead.
  Re-measure with `apps/ingest/scripts/fleet-probe.mjs`; do not widen the set
  unprompted.
- MFA / SSO / AD federation
- Real protocol adapters for BACnet, Modbus, SNMP, OPC-UA, REST polling, DCS.
  The **MQTT PHE ingest pilot is promoted for five RTUs** (ADR 0007 as amended
  2026-08-22), and **ADR
  0016 is promoted in full, §6 commit 4 included** (2026-08-14): the
  `IngestAdapter` interface, the host that supervises it, and the MQTT adapter
  ported onto it are all on `main`, and the legacy entry point is deleted.
  **That is the whole of what is in scope** — the boundary moved from commit 2
  to commit 4, and it did not widen: commit 4 removed a second entry point
  rather than adding capability. Each *further* protocol
  implementation stays deferred until it has **its own ADR**, which settles the
  protocol library where one is needed (licence, maintenance, transitive
  footprint) under §9.4. A protocol that happens to need no library — a REST
  poller on Node 20's global `fetch`, say — is **not** thereby ungated: the ADR
  is required unconditionally **under §10**, which is what moves scope, with
  §9.4 additionally applying wherever a dependency is involved. The dependency
  question is only one of the things the ADR answers. Nor is a new adapter cheap: it is an
  `apps/ingest/src/adapters/` file, a `registry.ts` key, an `INGEST_PROTOCOLS`
  entry where one is missing, a spec/test pair passing `runAdapterContractTests`
  (ADR 0016 §7) — **and that ADR**. Mechanical ease is not permission
- **ADR 0016 §6 commits 3 and 4 stay human-gated.** Commit 3 was the parallel
  run against the **live PHE pilot** and the cutover that followed it; running
  the host against a production deployment is not made in-scope by the ADR
  having been accepted. Both are done, on 2026-08-06 — the gate being satisfied,
  not removed, and it does not generalise to commit 4. **The record is uneven and
  should be read as it is:** the repository owner explicitly instructed *the
  cutover* (PR #19). The *parallel run* was performed inside a broader "bring the
  pilot up" request that never named §6 commit 3, so nothing in git authorises it
  specifically. It was read-only against a database the same request had just
  populated, which is why it did not read as the gated act — but the gate names
  the whole of commit 3, and an agent should treat "it was part of what I was
  already asked to do" as a weaker warrant than an instruction. **Commit 4 is now
  also done — 2026-08-14, PR #30 — and its gate was satisfied the way the gate
  asks.** ADR 0016 Resolved decision 4 required a *named owner*, not merely an
  instruction: the repository owner named themselves, and **ADR 0016 Amendment 3
  records it**. Worth keeping as the worked example of the distinction, because
  it nearly went the other way here: an agent asked to "start `F1.1`" has cleared
  *unprompted*, which is the weaker of the two things this bullet requires, and
  the owner still had to be asked for separately. Both gates are **satisfied, not
  removed** — a future §6-shaped step against a production deployment is gated
  again from scratch
- Template content sections whose consumer does not exist yet. **ADR 0019
  promoted the content model, and it is deliberately partial** — a section is
  contracted only as far as something on `main` can consume it. **Three** things
  stay closed, one per unbuilt consumer, and each reopens when that item lands:
  - `health` — **rejected** by the validator, not accepted untyped. Needs `E1.1`
  - `optimisation` — likewise **rejected**. Needs `E1.6`
  - `dashboards` — **ordered point keys only**; no widget types, no layout, no
    sizes. Needs `F3.1` to define the widget vocabulary

  `alarms.philosophy` **left this list under ADR 0034** (`E2.1`): `skill` is
  now checked against `bms.alarm_skills` rather than accepted as free text,
  and `cause`/`impact`/`action` were never closed to begin with. Its
  remaining three enrichment fields (affected assets,
  energy/water/production impact, ETR) are **not** newly opened by this —
  they describe a *live alarm instance*, not an asset class, and stay off the
  template contract permanently, not merely until a consumer exists (ADR 0034
  §Context: no `automation_rules` row links back to the `TemplateAlarm` it
  may have come from). Do not add them.

  `kpis.expression` **left this list under ADR 0036** (`F2.3`): `dialect`
  widened from a locked `"unvalidated"` literal to `z.enum(["unvalidated",
  "bms-calc-v1"])`, and `"bms-calc-v1"` triggers real parsing — grammar,
  whitelisted functions, and a `{pointKey}` cross-check against `pointKeys`
  (`packages/shared/src/calc-dsl/`, see §2 *Calc DSL*). Existing
  `"unvalidated"` rows keep validating exactly as before; nothing forces a
  re-save.

  **`F2.4` (ADR 0037) landed the evaluator** this paragraph used to defer:
  `packages/shared/src/calc-dsl/evaluate.ts` computes a value from a parsed
  expression against resolved inputs, and `apps/api/src/calc/` (see §2 *Calc
  engine*) decides what "the current value of `{X}`" means per formula —
  latest fresh sample within `max_input_age_seconds` on a NOTIFY batch
  (streaming) or on a self-scheduling interval (scheduled) — with
  null/stale-input and divide-by-zero both refusing rather than writing.
  **Still true, unchanged**: a derived `template_points.formula` may
  reference measured points only, never another derived point —
  chained/derived-to-derived formulas still need dependency ordering and
  cycle detection, and ADR 0037 deliberately declined to decide that
  (`F2.8` is recorded as blocked on this same grammar limit — see its
  `docs/BACKLOG.md` row).

  Do not widen any of the three to make a domain pack easier to author. That is
  exactly how `E5.1` ends up encoding a shape `F3.1` contradicts a
  year later, with packs already in the field
- Deploying template content into running objects. ADR 0019 is an **authoring**
  surface. A template alarm does not become a `bms.automation_rules` row (that
  needs `ruleType`/`condition`/`action`, which a template does not carry) and a
  maintenance plan does not become a `bms.maintenance_task_templates` row (its
  `asset_id` is `NOT NULL`). Those wirings are `E2.x`/`F3.x` and `E3.x` work
  respectively, each needing its own ADR
- EMQX broker (PHE pilot connects directly over MQTT TLS; no broker)
- MinIO / object storage
- Two-way commanding with approval workflows
- Audit **hash-chaining and append-only storage** (`F4.15`). `bms.audit_log` is
  now *readable* under ADR 0021, but it is not tamper-evident: nothing prevents
  an in-place update or delete. Whether audit **reads** are themselves audited
  is deliberately left open by ADR 0021 for `F4.15`/`F4.19` — do not settle it
  as a side effect of other work
- Energy reports (**PDF**). **XLSX is in scope** since ADR 0026 *Amendment 2*
  (`F4.51`) — `GET /api/v1/reports/energy/export.xlsx`
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
diagnostics. Protocol *brokers* remain out of scope; protocol *adapters* are
governed by the bullet above (ADR 0016 interface, host and MQTT adapter
promoted; each further implementation still ADR-gated) — that bullet supersedes
this sentence. Work-order UI is
complete for Phase 5 Sprint B. Phase 5
Sprint C Maintenance Schedule Centre is complete. Phase 5 Sprint D basic
rule-engine UI is complete for simple threshold/time-window rules,
enable/disable controls, manual evaluation, and execution history. Phase 5
Sprint E Energy report preview and its CSV **and XLSX** exports are complete
(the XLSX since ADR 0026 *Amendment 2*). Phase 5 Sprint
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
until the hardening checklist in `docs/roadmap.md` is finished. Report **PDF**
output (reports-domain **XLSX** is in scope since ADR 0026 *Amendment 2*,
`F4.51`; audit-log CSV/XLSX has been in scope since ADR 0021, and this line
used to draw that contrast the other way), persisted report storage, CR
Security, CR Alarm Management, CR Trends, Phase 6 3D, two-way commands,
setpoint changes, manual bypass, battery tests, equalize charge, HVAC
force-changeover, sensor calibration/test execution, real-ingestion rules,
scheduler/job queues, and complex node graph builders remain out of scope
until their specific sprint is promoted. General site-wide AI Copilot /
chatbot remains deferred, but the scoped admin onboarding wizard (ADR 0011),
the hierarchical master-data admin (ADR 0008–0010), and the PHE MQTT ingest
pilot (ADR 0007, 0012 — five RTUs since Amendment 1) are promoted and in
scope.

**Also promoted since, and in scope now** — the SOW-driven backlog
(`docs/BACKLOG.md`) delivered against `docs/build-operating-model.md`:
the Vitest runner and ratcheting coverage gate (ADR 0014, §4.6); asset
templates, versioning and instantiation (ADR 0015, §4.7); the `IngestAdapter`
interface, **its host, and the MQTT adapter** (ADR 0016, §6 complete through
commit 4 — no further protocol); the operations write matrix (ADR 0017, §4.7);
the asset source-axis separation making `assets.rtu_id` nullable while
`location_id` is `NOT NULL` (ADR 0018); the template content model
(ADR 0019, §2); and the template authoring UI with its formula editor
(ADR 0038 + Amendments 1–3, §2 *Template authoring*, `F2.5`) — which brings
CodeMirror 6 in as five §9.4-gated packages, and is the first `React.lazy`
boundary in this app; and the **notification service** with its channel admin
screens (ADR 0041, §2 *Notifications*, `F3.8`) — `nodemailer` and a Mailpit
`mail` Compose profile under §9.4, plus **ADR 0042**'s four test-only
devDependencies for `apps/web` component tests. **§6 was searched for a line
gating notifications, email, webhooks, escalation, `F3.7` or rule actions, and
there was none to soften** — the row was gated by §9.4 dependencies and by
`docs/BACKLOG.md`, never by an out-of-scope line here. **It promotes no further
channel**: `F3.9`'s SMS and push stay out of scope and behind their own row,
and the transport `switch` is what holds them there. **It promotes no
escalation policy either** — `F3.10`'s profiles and auto-clear are a separate
row, and `F3.7` (making a rule's stored `notify` actually fire) is unblocked
but unbuilt. **It promotes no closed content section**: `health`,
`optimisation` and `dashboards` stay out of scope in §6 and out of the tab
registry, held there by a source scan rather than by convention.
Application-layer encryption at rest
is in scope (ADR 0012); **full-disk / volume / KMS encryption is a deployer
action and not implementable in this repo**. Object-storage bucket encryption
(`F3.3`, ADR required) and automated encrypted backups (`E8.2`) remain **live
backlog scope** — they are deferred, not cancelled. The boundary itself is
still an open human decision; see `docs/security/encryption-at-rest.md` and
`docs/BACKLOG.md` §5.

When any other item above is needed, follow §10 (Promotion Process).

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
Docker Compose for reproducible development. Phase 2 is **no longer paused**:
the PHE MQTT pilot ships in `apps/ingest` (ADR 0007, 0012) across five RTUs,
and
ADR 0016 froze the adapter interface and — §6 complete through commit 4 — shipped
the host that runs it with MQTT ported onto it, as the sole entry point. What remains gated is each *further
protocol implementation*, per §2 and §6 — not Phase 2 as a whole. Phase 5 Sprint A used the existing API and
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
6. Never log secrets, tokens, or full PII payloads. **This includes the
   onboarding chat transcript** (`onboarding_sessions.messages`) — it is user
   free text that once carried pasted broker passwords, and it is scrubbed on
   the way out to the client as well as refused on the way in (ADR 0022).
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

### 10.1 ADR-sourced promotion (how this actually works now)

The five steps above describe promotion from `docs/AGENTS.production.md`.
Most scope now moves a different way — an **ADR** in `docs/adr/` decides it,
and the ADR lands with the feature that motivated it. Two consequences, both
recorded here because the practice had diverged from the written process
silently:

- **A promotion may originate from an ADR** rather than from
  `docs/AGENTS.production.md`. Step 2 is then "summarise the ADR's decision
  here and link it", not a copy. The ADR remains the authoritative record;
  this file is the index.
- **Step 5 is inverted for ADR-sourced promotion, by construction.** The ADR
  is written and accepted *before* the feature (that is the §9.4/§10 gate),
  but the `chore(agents):` edit to this file cannot ride along in the feature
  PR — §9.10 forbids it. So the rulebook edit necessarily lands *after* the
  feature. It is discharged by a catch-up `chore(agents):` sweep, and what
  is owed is tracked in `docs/BACKLOG.md` §5 until it lands.

Step 5 still holds for `AGENTS.production.md`-sourced promotions, where no
ADR gate precedes the feature. **The gate that must never be skipped is the
ADR itself, not the bookkeeping in this file.**

**One owed promotion per `chore(agents):` PR.** Batching several into one
sweep makes the diff harder to review precisely when it is the rulebook being
changed, and §9.10's wording does not clearly permit it. If a batch is ever
warranted, ask first — it is not the default and not an agent's call.

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
