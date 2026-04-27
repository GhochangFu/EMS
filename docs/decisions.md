# Decisions Log (Prototype Phase)

Lightweight ADR-lite log. One entry per non-obvious choice made during
the prototype phase. Format is intentionally minimal so it stays
current. Once we enter the first production phase, new decisions become
full ADRs in `docs/adr/` per `docs/AGENTS.production.md` §15.

## Format

```
## D-NNNN — <title>
Date: YYYY-MM-DD
Status: accepted | superseded by D-NNNN
Context: ...
Decision: ...
Consequences: ...
```

---

## D-0001 — Prototype scope: seven screens, quality first, ~7–8 weeks

Date: 2026-04-27
Status: accepted

**Context.** The original prototype proposal was a five-screen, six-week
build with a single animated schematic (Electrical SLD). On reviewing
the mockup (`ESKOM_SMOC.html`) and the demo audience, the SLD alone
under-sells the BMS narrative: electrical monitoring without HVAC or
energy analytics is a thin story for an Eskom-class buyer. Schedule is
open; quality matters more than the calendar.

**Decision.** Expand prototype scope to seven screens:

1. Login
2. Executive Dashboard
3. Alarm Centre
4. World Map
5. Electrical SLD (animated)
6. CRAC / Cooling schematic (animated)
7. Energy Centre dashboard (charts only)

Target timeline: 7–8 weeks instead of 6. Audience is mixed (internal,
Eskom buyer, investor). Breadth of narrative is prioritised alongside
visual polish.

**Consequences.**

- Simulator must produce telemetry across three domains: electrical,
  HVAC, and aggregate energy. Energy Centre reuses electrical data and
  is therefore cheap; CRAC adds a fresh HVAC point set.
- The "telemetry → React → animated SVG" pattern is built once on the
  SLD and reused for CRAC.
- Out-of-scope list in `AGENTS.md` §6 stays unchanged — Three.js
  Control Room, AI Copilot, real protocol adapters, etc. remain
  deferred.
- Roadmap (`docs/roadmap.md`) will allocate the extra 1–2 weeks to
  CRAC simulator + UI; Energy Centre is a stretch screen built late on
  reused data.

---

## D-0002 — Sprint 1 toolchain: Nest + Vite workspace packages as CommonJS

Date: 2026-04-27
Status: accepted

**Context.** `@bms/db` and `@bms/shared` were first authored as ESM-only
workspace packages (`"type": "module"`, exports without `require`).
NestJS 10 compiles the API as CommonJS; Node raised
`ERR_PACKAGE_PATH_NOT_EXPORTED` when resolving those packages.

**Decision.** Ship `packages/db` and `packages/shared` as dual-exported
artifacts (`import` + `require` pointing at the same `dist` output) with
`tsc` `module: CommonJS` for library builds. Keep `migrate` / `seed` as
tsx-run TypeScript files excluded from the published `dist` bundle.

**Consequences.** Simulator and future ESM-only scripts continue to
interop with the compiled packages. If we standardise the whole monorepo
on ESM later, revisit via a single ADR and Nest's ESM bootstrap path.

---

## D-0003 — Live telemetry: Postgres NOTIFY + Socket.IO + Vite `shared` alias

Date: 2026-04-27
Status: accepted

**Context.** Sprint 2 needs `sim → DB → API → WebSocket → React` without
Redis or a message broker (prototype `AGENTS.md` §6). Vite failed to
resolve named exports from the compiled CJS `@bms/shared` package during
`vite build`.

**Decision.**

1. After each simulator insert batch, call `pg_notify('bms_telemetry',
   json)` with the row payloads. The API opens a dedicated `pg` client,
   `LISTEN bms_telemetry`, and forwards payloads to a Socket.IO gateway
   on namespace `/ws/telemetry`.
2. In `apps/web`, map `@bms/shared` to `packages/shared/src/index.ts` in
   `vite.config.ts` so the bundler consumes TypeScript source directly.

**Consequences.** NOTIFY is single-node and loses messages if the API is
down — acceptable for the laptop prototype. If we add horizontal scale
or HA, replace with Redis pub/sub (Phase 1) or a dedicated broker.

---

## D-0004 — Executive Dashboard charting: Apache ECharts

Date: 2026-04-27
Status: accepted

**Context.** Sprint 3 requires a live trend chart bound to telemetry.
`AGENTS.md` §2 locks ECharts for the prototype frontend.

**Decision.** Add `echarts` + `echarts-for-react` to `apps/web` for the
load trend panel. Accept a larger Vite bundle for now; revisit lazy
loading or `echarts/core` tree-shaking if bundle size becomes a problem.

**Consequences.** Dashboard chunk exceeds the default Rollup warning
threshold until we split vendor code in a later polish pass.

---

## D-0005 — Alarm Centre: in-process threshold engine + `rule_key` dedupe

Date: 2026-04-27
Status: accepted

**Context.** Sprint 4 needs thresholds on simulator telemetry without a
separate rules microservice. Open alarms must not duplicate on every
1 Hz tick.

**Decision.**

1. Subscribe `AlarmThresholdService` to the same `TelemetryBroadcastHub`
   used for Socket.IO telemetry fan-out; evaluate a small fixed rule set
   per reading batch (voltage, breaker, kW, PF).
2. Add nullable `bms.alarms.rule_key` and only insert when no row exists
   with the same `(asset_id, rule_key)` and `acknowledged_at IS NULL`.
3. Add `bms.audit_log` for lightweight ack records (`action=alarm_ack`).
4. Protect `GET/POST /api/v1/alarms*` with `JwtAuthGuard`; keep dashboard
   telemetry KPI reads unauthenticated for prototype convenience.

**Consequences.** Rule definitions live in code, not DB — fine for the
prototype. Moving to a data-driven engine or cross-node evaluation
requires Phase 2+ ingestion architecture.

---

## D-0006 — World Map: `bms.map_locations` + Leaflet + CARTO dark tiles

Date: 2026-04-27
Status: accepted

**Context.** Sprint 5 needs Eskom station and SMOC campus markers with
live colour from alarms and telemetry freshness, without hard-coding
coordinates only in the frontend.

**Decision.**

1. Add `bms.map_locations` (slug, name, kind `eskom` | `smoc`,
   `site_name` join key to `bms.assets`, lat/lng, optional Eskom fields,
   `meta` jsonb). Seed from the mockup `ESKOM_STATIONS` list plus two
   SMOC campuses aligned to seeded `site_name` values.
2. Expose `GET /api/v1/map/sites` aggregating open alarms per site and
   kW freshness (under ~25 s) for SMOC; Eskom rows use
   `station_operating_status` for nominal vs unknown.
3. Web: Leaflet + react-leaflet, CARTO dark raster tiles, `CircleMarker`
   + popups with KPIs and links. TanStack Query refetch plus Socket.IO
   on `/ws/telemetry` and `/ws/alarms` to invalidate map data when live
   state changes.

**Consequences.** Map data is DB-backed and demo-repeatable. Tile
provider is third-party (CARTO CDN) — acceptable for prototype; swap to
self-hosted or licensed tiles in production if required.

---

## D-0007 — Electrical SLD: `SchematicTelemetryProvider` + hand-laid SVG

Date: 2026-04-27
Status: accepted

**Context.** Sprint 6 needs an animated single-line diagram tied to the
same electrical points as the simulator, reusable for the CRAC schematic
in Sprint 7, without a third-party diagramming engine.

**Decision.**

1. Implement `R.sld`-style SVG in React (`ElectricalSldDiagram`) with
   CSS dash animations (`sld-styles.css`) scaled by live kW.
2. Introduce `SchematicTelemetryProvider`: one `/ws/telemetry` client,
   REST hydration for `kw`, `breaker_main`, voltage, current, PF per
   tracked `bms.assets.code`; derive **running / fault / offline** from
   freshness (~25 s) and breaker state.
3. Map feeder positions to the six seeded assets via `sld-bindings.ts`
   (deterministic code → geometry). Detail drawer is read-only; no
   commands (Phase 4).
4. Document the `LiveSvgComponent` render-prop wrapper in
   `apps/web/src/components/live-svg/README.md` for CRAC reuse.

**Consequences.** HVAC schematics can extend the same provider pattern
with additional point keys; heavy SVG pages may warrant lazy routes
later for bundle size.

---

## D-0008 — CRAC / HVAC: `HVAC_POINT_KEYS` + domain-aware simulator

Date: 2026-04-27
Status: accepted

**Context.** Sprint 7 needs live CRAC and chilled-loop telemetry in the
same `telemetry.point_values` hypertable without new API modules.

**Decision.**

1. Add `HVAC_POINT_KEYS` in `@bms/shared` (air temps, fan rpm / %, CHW
   flow and temps, `compressor_ok`, `cooling_kw`).
2. Extend `apps/sim` to load `id` + `domain` per asset and emit
   electrical vs HVAC point batches. Default `SIM_ASSET_COUNT` raised to
   32 so mixed fleets fit; seed adds `CH-CRAC-103` and `CH-CRAC-104`.
3. Generalise `SchematicTelemetryProvider` with a `pointKeys` argument;
   CRAC page uses `HVAC_POINT_KEYS`. `CracSchematic` reuses the Sprint 6
   live-SVG pattern (mockup `R.crac`).

**Consequences.** Dashboard KPIs still use electrical `kw`; CRAC UI
depends on HVAC keys. Compressor trips surface as `compressor_ok = 0`
(fault styling + drawer).

---

## D-0009 — Energy Centre: API aggregations + nominal source split

Date: 2026-04-27
Status: accepted

**Context.** Sprint 8 needs mockup `R.en`-style analytics without a new
simulator domain or separate energy meters. Stakeholders expect source
mix and cost flavour even when only electrical `kw` exists in seed data.

**Decision.**

1. Add `GET /api/v1/dashboard/energy/summary`, `.../source-mix`, and
   `.../top-consumers` with a bounded `window` parameter (`Nh` or `Nd`,
   e.g. `24h`, `7d`, `30d`). Bucket by minute under 48h, else by hour.
2. **Summary:** integrate bucketed total `kw` to kWh, max bucket kW as
   peak, PUE via existing `estimatePue` on average bucket load,
   indicative cost = kWh × `ENERGY_TARIFF_ZAR_PER_KWH` (default 2.15).
3. **Source mix:** per bucket, solar = sum of `kw` for assets with
   `code ILIKE 'PV%'`, then a small **nominal** DG slice (~4% of load
   after solar, capped) and the remainder labelled grid — clearly a
   narrative split until real meters exist.
4. **Top consumers:** average `kw` per asset over the window; estimated
   kWh = avg kW × window hours; cap list at 25.
5. Web: `/energy` with TanStack Query, ECharts stacked area + horizontal
   bar, KPI tiles; top nav links Overview / Sites / Energy; footer clock.

**Consequences.** Energy story is demo-ready and DB-efficient; replacing
nominal DG/grid with metered data is a future schema + query change, not
a UI rewrite. NOTIFY payloads from the sim stay under Postgres limits via
chunking (separate fix in `apps/sim`).

