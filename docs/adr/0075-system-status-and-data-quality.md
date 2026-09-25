# ADR 0075 — System Status and Data Quality indicators (`F3.30`)

## Status

Proposed — drafted at the §10 gate on 2026-09-25, before any implementation
code. Three gate questions were put to the owner one at a time and all three
were ruled as recommended; the rulings are under *Gate questions* and carried
into *Decision*. Eight points were decided without a question and are listed
under *Ruled here without a question* — the owner confirms or overrules them
when approving this record.

Resolves the scope question the `F3.30` row left open ("worth deciding what it
measures before building"). Promotes nothing out of `AGENTS.md` §6 — `F3.30`
is a backlog row created by the BACKLOG §7 comparison, not a §6 item. Touches
no §5 decision: placement in the status bar (Q3) keeps it clear of the open
*Domain-first navigation IA* decision that gates `F3.29`.

## Context

**The reference has two indicators we have no analogue for.** Its sidebar
footer reads "All Systems Operational" and "Data Quality 98.6% Good". The
row names three candidate meanings for the second number — telemetry
freshness per asset, ingest gap coverage, unmapped-tag ratio — and says the
reference does not say which.

**What the source says today** (read 2026-09-25 at `644be4e5`):

1. **Every fleet freshness count except one tests only `kw`.** Four SQL sites
   take `DISTINCT ON (asset_id) … WHERE point_key = 'kw'` with no time bound
   and call an asset fresh when that row is recent:
   `dashboard.service.ts` `locationKpis` (L64–82, 25 s), `locationDashboard`'s
   RTU rows (L170–186, 25 s), `kpis`' `sites_online` (L479–494, **20 s**), and
   `map.service.ts` (L100–110, 25 s). An asset with no `kw` point sits in the
   denominator and is never fresh. On the dev stack on 2026-09-25, **78 of the
   158 asset ids that reported in the last 7 days have no `kw` sample** — the
   location cards' `fresh` fraction under-counts by about half. Site-level
   `sitesOnline` is not affected today (every reporting location has at least
   one `kw` asset) but carries the same rule.
2. **The any-point rule already exists.** `F3.28` (ADR 0074, OQ1) added
   `LIVE_TELEMETRY_MAX_AGE_SECONDS = 25` in
   `apps/api/src/telemetry/telemetry-freshness.ts`: an asset is live when its
   newest sample of **any** point is inside the window. The role-summary read
   (`asset-role-summary.service.ts` L28, L165–170) writes it into SQL as a
   plan-time literal through `sql.raw` — a bound `$n` planned every chunk
   (520–1900 ms against 42–100 ms). `tests/f3.28-offline-bound-single-source.test.ts`
   pins it to the web's `FRESH_MS = 25_000`. That file's docblock names the
   `kw`-only counts as out of `F3.28`'s scope.
3. **Gap coverage has no expected interval.** The caggs
   (`point_values_1m/5m/1h/1d`, migration `0027`) carry `sample_count` per
   bucket, but nothing records how often a point is expected to report, so a
   coverage figure would silently take the bucket width as the interval.
4. **The unmapped ratio is static.** `bms.asset_points.source_kind` defaults
   to `'unmapped'` (263 of 553 rows on dev); it does not move when telemetry
   stops. The ingest host's `unmappedSourceKey` counter is in-process only and
   belongs to `F3.16`.
5. **System health reaches the API only partly.** `GET /health`
   (`health.controller.ts`, `LivenessResponse` in
   `packages/shared/src/contracts/health.ts`) reports the queue (Redis,
   BullMQ, worker heartbeat, ADR 0063) and object storage (ADR 0066). It does
   not report the database, and the API cannot read the ingest host's own
   plain-text `/health` (`apps/ingest/src/host/health-server.ts`). A real
   ingest heartbeat is `F3.16`'s.
6. **The shell has a status bar.** `apps/web/src/layouts/app-shell.tsx`
   L330–341 renders a footer with the product line and `StatusBarClock`. The
   sidebar has no footer section.

## Gate questions

1. **What does "Data Quality %" measure?** Options: asset freshness over any
   point key, gap coverage over a window, mapping completeness. **Ruled as
   recommended: asset freshness**, and the location cards move to the same
   rule.
2. **What does "System Status" cover?** Options: the `/health` components
   plus a database check plus a field-data check inferred from MQTT asset
   freshness; the `/health` components only; no status in this row (move it
   to `F3.16`). **Ruled as recommended: the `/health` components, the
   database, and the inferred field-data check.** Limit accepted at the gate:
   when every MQTT device is silent the field-data check reads degraded
   although the ingest host runs.
3. **Where do the indicators go?** Options: the bottom status bar, the
   sidebar footer (takes on the IA gate), a dashboard tile. **Ruled as
   recommended: the bottom status bar**, beside `StatusBarClock`.

## Decision

### 1. Data Quality is the fresh share of streaming assets (Q1)

`dataQuality.percent` = fresh assets ÷ streaming assets × 100, one decimal.

- **Streaming asset**: an asset in the caller's scope with `rtu_id IS NOT
  NULL`, whatever the RTU's `source_type`. An asset with no RTU is fed by
  hand (`F1.8`) or not at all, and is never expected to report.
- **Fresh**: the asset has a `telemetry.point_values` sample of any
  `point_key` with `time > now() - interval '<LIVE_TELEMETRY_MAX_AGE_SECONDS>
  seconds'` — the ADR 0074 OQ1 rule, written as the same `sql.raw` plan-time
  literal. No second constant.
- **No streaming asset in scope** → `percent: null`, rendered as "—", never
  0 % or 100 %.

The payload also carries `freshAssets` and `streamingAssets`, so the number
can be checked by hand.

### 2. The four `kw`-only counts move to the same rule (Q1)

`locationKpis.fresh_asset_count`, `locationDashboard`'s RTU
`fresh_asset_count`, `kpis.sites_online` and `map.service.ts`'s
`fresh_count` use the any-point rule of decision 1, each through the same
constant and each bounded to the window (no unbounded `DISTINCT ON` over the
hypertable). `total_kw` stays `kw`-only — it is a power sum, not a freshness
test. `sites_online` moves from 20 s to 25 s, and the `/` tile hint
"Sites with fresh telemetry (~20s)" changes with it. The
`dashboard.service.ts` L605 `25_000` literal reads the same constant.
`tests/f3.28-offline-bound-single-source.test.ts` (or its successor) extends
to every one of these files, so no restated `interval 'N seconds'` survives.

### 3. System Status is four components and one verdict (Q2)

| Component | Source | `ok` | `degraded` | `not_configured` / `not_monitored` |
|---|---|---|---|---|
| `database` | the status read's own query succeeds | query returns | query throws | — |
| `queue` | `QueueHealthService.read()` | connected and heartbeat fresh | disconnected, or `heartbeatStale` | `not_configured` when no `REDIS_URL` (ADR 0002) |
| `storage` | `StorageHealthService.read()` | reachable | configured, unreachable | `not_configured` |
| `field_data` | decision 1's query, restricted to assets on `source_type = 'mqtt'` RTUs | at least one such asset is fresh | such assets exist in scope, none fresh | `not_monitored` when the scope has no MQTT asset |

`status` is `operational` when no component is `degraded`, otherwise
`degraded`. `not_configured` and `not_monitored` never degrade the verdict —
the `/health` rule for an unconfigured queue. The read always answers 200
with the verdict in the body, as `/health` does; when `database` is
`degraded`, `dataQuality.percent` is `null` and the counts are `0`.

### 4. One read: `GET /api/v1/system/status`

A new `apps/api/src/system-status/` module (controller + service) on
`fleetPool`, importing the existing queue and storage health providers. It
is authenticated like every `/api/v1` route and open to every role. The
caller's scope follows the `dashboard.controller.ts` shape:
`@CurrentUser()` → `{ locationIds, assetIds, partial }`, `global` → `null`.
An asset-group user's percentage is the share of *their* assets, and the
body says `partial: true`.

The response is a Zod schema in `packages/shared/src/contracts/`
(ADR 0030), `systemStatusResponseSchema`:
`{ status, components: [{ key, state }], dataQuality: { percent,
freshAssets, streamingAssets, windowSeconds }, partial, checkedAt }`.
Component entries carry **state only** — no queue depths, bucket name,
heartbeat time or error text; those stay on the liveness
probe `/health` and in logs.

### 5. The status bar shows both, polled (Q3)

A `SystemStatusIndicator` in the `app-shell.tsx` footer, beside
`StatusBarClock`: a dot and "All systems operational" / "Degraded: <component
labels>", then "Data quality 98.6 %". Band colours follow the reference:
green ≥ 95 %, amber ≥ 80 %, red below; "—" for `null`. A `title` lists each
component and its state. TanStack Query polls every 30 s
(`refetchInterval`); no socket. A failed request renders "Status
unavailable", never a stale "operational".

## Ruled here without a question

1. **The window is `LIVE_TELEMETRY_MAX_AGE_SECONDS` (25 s)** — the ADR 0074
   rule, so the status bar, the class strip and the schematics agree. No
   per-point expected interval (that is gap coverage, rejected at Q1).
2. **`sites_online` moves 20 s → 25 s** with decision 2. Two thresholds for
   one word ("fresh") on one screen is the defect decision 2 removes.
3. **The denominator is assets with an RTU**, not assets with a `measured`
   `asset_points` row: on dev only 48 of 155 assets have a `measured` point,
   while every asset with an RTU reported within 7 days (simulator and
   catalog RTUs write without `asset_points` wiring).
4. **Field data is scoped.** A tenant user's `field_data` reflects their own
   MQTT assets; it never reveals whether another tenant's devices report.
5. **The four platform components are not tenant data** and show the same
   state to every caller.
6. **Band thresholds 95 / 80** are presentation, set in one web constant.
7. **The read always answers 200** (decision 3), as `/health` does; the
   verdict is in the body, and the web tells "degraded" from "unreachable".
8. **One pull request**, with the decision 2 move and the decision 3–5 read
   in separate commits. Effort 2–3 does not justify serial slices.

## What this ADR does not decide

- A real ingest heartbeat, the ingest drop counters, and per-device
  last-seen — `F3.16`.
- A per-point expected reporting interval and gap coverage — not raised as
  a row; it needs a schema decision.
- The sidebar placement of the reference — follows the §5 *Domain-first
  navigation IA* decision with `F3.29`.
- Anything on the ingest host itself.

## Dependencies

None. No npm package, no migration, no schema change.

## Consequences

- The location cards' `fresh` fraction and the map's comm status rise on
  deployments with non-electrical assets; the `kw`-only under-count ends.
  This is a visible behaviour change, called out in the PR.
- One more 30 s poll per open tab. The query is bounded to the 25 s window
  and plan-time pruned; the plan measures it against the ~5.4k-chunk dev
  database before merge.
- `field_data` is an inference. It can read degraded while the ingest host
  runs (all MQTT devices silent) and cannot tell those cases apart until
  `F3.16` gives a heartbeat.
- `F3.29`'s later IA work may move the indicator into the sidebar; the
  component is standalone so that move is a relocation.
