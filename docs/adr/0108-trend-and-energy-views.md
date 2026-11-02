# ADR 0108 — Trend and energy views (`F4.297`, `F4.298`, `F4.300`)

## Status

**Accepted — 2026-10-31** (owner, in chat; the merge of this record is the
acceptance). Three rulings were given at review, one at a time: (a) the Energy
page uses the new `GET /reports/energy/view` and the preview stays unchanged —
the ruling "F4.298 owns the energy preview change" applies to that route;
(b) the optional `timeZone` on the `aggregate` response and the one shared
location → organization → `Etc/UTC` helper are accepted; (c) the Energy page's
custom from/to picker works in the view's zone (site, else organization) and
its label names that zone — not the browser's. Where a line below still says
the owner confirms at review, these rulings are that confirmation.

Nine plan questions were then ruled one at a time (recorded in each plan's
"Owner answers" section). One changes decision 3: **F4.300 adds a `ups`
segment** — a `ups` row in `bms.asset_domains`, the seven
`CONTROL_ROOM_UPS_POINT_KEYS` codes re-filed from `electrical` to `ups`, and
a `ups` default trend set — where this record below says the UPS codes stay
under Electrical. The others confirm the plans: all four chart functions, the
`/recent` 500 fix folded into F4.297 PR 1, an organization required for a
global admin, a sample-average PF, a 365-day custom cap, replace-all with a cap
of 12, and the Trend Points tab under Reference Data.

Ruling 2026-11-01 (owner, in chat, "Move UPS assets too"): the seeded UPS and
battery assets and the stock `electrical-ups` template move to the `ups` asset
domain as well, so the `ups` segment matches the assets that carry its codes
(F4.300 plan, "Owner answers (2026-11-01)"). Second ruling the same day (owner,
in chat, "Sim sends UPS keys"): the simulator sends the seven UPS codes for every
asset in the `ups` domain, not only the Western Cape `CR-UPS*` / `CR-BATT*`
pair, so all 22 moved assets carry them.

Amendments 1 (`F4.299`) and 2 (`F4.301`), drafted 2026-11-01 and checked
against `main` at `a1580048`: the owner answered every open question in chat
the same day, each with the recommended option — the abnormal rule (50 % above
the median of the 4 preceding windows, at least 3 with data), accept the wait
on a slow 1-year view, one sparkline per asset (up to 6), the first 3 trend
points per segment on whole-site views, and the strip on the built-in SMOC
view's Main Dashboard only. The merge of the amendments approves them.

Amendment 3 (`F4.305`), drafted 2026-11-01 after the AWS check of `F4.301`
found the strip at the foot of the site page: the owner ruled in chat, one
question at a time, that the strip becomes a dashboard widget kind (a guided
setup wizard is a later row, `F4.306`), that every tab of the stock site layout
carries one under its top row of tiles, that the seed adds it to every existing
site copy — tabs an administrator edited included — once, so a strip an
administrator deletes stays deleted, and that the wall shows it.
The merge of the amendment approves it.

Amendment 4 (`F4.302`), drafted 2026-11-02 and checked against `main` at
`1ff2bdd9`: the owner answered its questions in chat the same day, one at a
time — a third site section with migration `0119`, segments as the asset
domains present at the site, the Energy sub-tab composed from the `F4.298` /
`F4.299` routes plus one new segment route, not on the wall, the site ranking
only above one site, and a per-point abnormal list on every segment sub-tab
with a two-sided rule, +50 % and −50 % of the baseline (item 5). The merge of
the amendment approves it.

Amendment 5 (`F4.304`), drafted 2026-11-02 and checked against `main` at
`d820d560`: the owner answered its questions in chat the same day, one at a
time — a new nullable column `bms.locations.floor_area_m2` (migration `0121`),
any location may carry an area and a ranked site uses only its own, the
`F4.299` site ranking gains "Rank by: kWh per m²" and the `F4.302` site Energy
sub-tab a "kWh per m²" tile on the site's own assets' kWh, kWh in the selected
range divided by the area (not annualised), the same top 50 by kWh, a typed
value from 1 to 100 000 000, an "Area (m²)" column in the Locations list, the
admin types m² or ft² and storage stays m², and onboarding
(draft, workbook, agent tool) carries the same area with a unit. The merge of
the amendment approves it.

Drafted 2026-10-31 (owner, in chat). The owner accepted every designer
call in `docs/plans/2026-10-31-energy-and-trend-views-design.md` as a ruling and
chose this one record for the whole set of rows (`F4.297`–`F4.304`), with one
decision per row. A line marked *(owner)* states a ruling. A line marked
*(drafter choice)* was not asked and may be changed at review. Drafted before
any implementation code. The merge of the record approves it. Code citations are
to `main` at `d693b38c`.

This record decides the three rows that start at once (`F4.297`, `F4.298`,
`F4.300`). `F4.299`, `F4.301`, `F4.302`, `F4.303` and `F4.304` each add an
amendment to this record when they start (decision 6).

## Context

Users see live values and the last poll, but not how a value moved. The stored
rollups (`point_values_1m` / `_5m` kept 735 days, `_1h` / `_1d` kept
indefinitely, ADR 0023; raw rows kept 730 days) are read in the UI by one
dashboard `chart` widget that an admin builds point by point. The owner wants
the history on the Energy page and in the Control Room, filtered by
organization and location, over every rollup period, for every segment the
catalog serves. It must work for every current and future organization.

What the code has today:

- **Aggregate read.** `GET /telemetry/points/:pointRef/aggregate`
  (`TelemetryController.aggregate`, `telemetry.controller.ts:165-201`) takes
  only a trailing `windowMinutes` (max `MAX_WIDGET_WINDOW_MINUTES` = 525,600,
  default 1440), `compare` and `bucketFunction`. Its query schema
  (`pointAggregateQuerySchema`, `telemetry.schema.ts:32-49`) is not in
  `@bms/shared`. `windowBounds` (`point-aggregate-window.ts:101`) always ends at
  `now`. The response (`pointAggregateResponseSchema`, `envelopes.ts:351-375`)
  carries compare as scalar stats only, with no buckets. The route does not
  check that the asset id is a UUID, so a global admin with a non-UUID id
  reaches the SQL `uuid` cast.
- **Raw records.** `GET .../recent` (`recentForPoint`, `telemetry.service.ts:79`)
  returns at most 5,000 rows over at most 7 days, with no `deviceTime`, no
  cursor, and a 500 on a malformed ref. `telemetry.point_values` stores `time`,
  `asset_id`, `point_key`, `value`, `unit` and `device_time` (migration 0069).
  It has no quality column.
- **Energy page.** `/energy` (`energy-page.tsx`) calls three trailing-window
  dashboard routes (`energy-centre.ts`, `bucket > now() - interval`) with no
  organization, location, custom range or compare. The energy preview
  (`GET /reports/energy/preview`, F4.290) takes `locationIds` and day-granular
  UTC `startDate`/`endDate`, is capped at 31 days (`energyReportRange`,
  `reports.service.ts:42-59`), reads `_1h` only, and returns no series, level,
  peak time, power factor or compare. Its `energyCentreSummarySchema` is reused
  by the CSV/XLSX/PDF exports and by the copilot tool
  `get-energy-report-preview`.
- **Trend points.** The point catalog (`bms.point_keys`) is fleet-wide, has no
  Row Level Security since migration 0057, and has a free-text `domain` with no
  foreign key. `headline_rank` (migration 0083, trigger 0084) is the precedent
  for a catalog-level, global-admin-only flag. Segments are the data rows of
  `bms.asset_domains` (7 rows today: `electrical`, `hvac`, `it`, `environment`,
  `water`, `mechanical`, `facility`). There is no `ups` or `battery` domain, and
  there is no site-tab to domain map in the code.
- **Access.** `telemetry.*` has no Row Level Security. `canReadAsset` /
  `readableAssetIds` in the controller is the only containment.

## Decision

### 1. `F4.297` — asset history

1. **Route** *(drafter choice)*. A web page `/asset-history/:assetId` inside
   the app shell, with the same `accessToken && user` guard as the other
   routes. The Assets list (`AssetDetailPanel`), the Control Room asset tile
   (`generated-site-asset-card.tsx`) and the alarm detail link to it. The page
   shows every point of the asset: one chart and one bucket table over a range
   with compare, and a table of the latest raw records. The route sits outside `/assets/` because both nginx configs reserve that prefix for static build files (`try_files $uri =404`, F4.130); the first path `/assets/:assetId/history` gave a live 404 on a hard refresh (found 2026-11-01) and now redirects in the SPA.
2. **Aggregate query change** *(owner: `F4.297` owns it, one shape reused by
   later rows)*. `pointAggregateQuerySchema` moves from
   `apps/api/src/telemetry/telemetry.schema.ts` to a new
   `packages/shared/src/contracts/telemetry-queries.ts`, with
   `atInstantIsInRange`, `MIN_AT_INSTANT_MS` and `MAX_AT_INSTANT_LEAD_MS`
   (both refinements call it). The precedent is `F4.280`'s
   `energyReportQuerySchema` in `report-writes.ts`. `telemetry.schema.ts`
   re-exports the three helpers, so `pointValuesAtQuerySchema` and the copilot
   importers do not change; the api declaration of the query schema is deleted,
   not copied. It gains three optional fields:
   - `from` and `to` (ISO 8601 with an offset). `windowMinutes` loses its
     `.default(1440)` and becomes `.optional()`, so an absent value is
     detectable. A pure `resolveAggregateRange(parsed, now)` applies the 1440
     default for the trailing form, so a widget call does not change.
   - `bucketStats` (`"true" | "false"`, transformed to a boolean, the
     `compare` precedent; never `z.coerce.boolean`).
   - Validation in one `.superRefine`, each a 400: `from` and `to` both or
     neither; `from`/`to` exclusive with `windowMinutes`; each end passes
     `atInstantIsInRange` (≥ 1970-01-01, ≤ now + 1 day); `to > from`;
     span ≤ `MAX_WIDGET_WINDOW_MINUTES`. The `.describe(...)` comes after the
     refinement (ADR 0029 Amendment 1). The schema stays non-strict.
   - A new `windowBoundsFor({from, to}, compare)` computes the bounds.
     `windowBounds(now, windowMinutes, compare)` stays as a one-line wrapper
     over it, so its callers (`asset-health.service.ts:238` and the specs) do
     not change. `windowMinutes` is derived from the span, so `levelFor` and
     `granularityFor` do not change. The compare window is the equal-length
     period that ends at `from`.
   - Registry and ledger: `TelemetryController_aggregate` keeps its key, and
     `pointAggregateQuerySchema` is already in `QUERY_SCHEMAS`
     (`strict-body-ledger.spec.ts`), so neither list gains an entry for this
     route. Only the import moves to `@bms/shared`, in `openapi-registry.ts`
     and in `strict-body-ledger.spec.ts`. Both lists compare by identity, so a
     second copy left in the api fails `testEveryRegisteredSchemaIsUnderAudit`.
     `tests/adr-0029-openapi-contract.test.ts` gains
     `packages/shared/src/contracts/telemetry-queries.ts` in its hand-kept
     shared-file list, so its refine-then-describe scan reaches the moved
     `.superRefine`.
3. **Aggregate response change.** The response schemas live in
   `packages/shared/src/contracts/envelopes.ts` (ADR 0030).
   - The response `compare` object gains `buckets`, built with the same
     `bucketSql` at the compare parameters and gap-filled with
     `fillBucketGaps`. It is `null` when the request names no
     `bucketFunction`. The schema is `.optional().nullable()`, so a response
     from before this change still parses *(drafter choice, backward
     compatibility)*.
   - **Alignment.** Compare buckets carry their true timestamps. The client
     shifts each compare `t` by `+span` to overlay it on the current window.
     Index alignment is not used, because gap-fill and a partial last bucket
     make the two arrays differ in meaning at the same index.
   - **`bucketStats`.** With `bucketStats=true`, each bucket (current and
     compare) also carries `min`, `average`, `max` and `sampleCount`, from the
     same `AGG_EXPR` table (`min(min_value)`, the weighted mean, `max(max_value)`,
     `sum(sample_count)`). The four fields are optional, so a bucket with only
     `{t, v}` (the widget path) still parses.
   - **`timeZone`.** The response gains an optional `timeZone`, the asset's
     site zone by decision 1.9. The widget and the copilot tool ignore it.
4. **Level escalation.** A custom window that is shorter than 48 h and older
   than 735 days now reaches `levelForRange` escalation. The comments in
   `levelFor` and `tests/f3.35-aggregate-window-bounds.test.ts` that say this
   cannot happen are corrected. `bucketSeconds` stays the authority for the
   level that was used, and the page shows that level.
5. **UUID guard** *(drafter choice)*. The `aggregate` route validates the asset
   id with the existing `assetIdSchema` and returns 400, the same as
   `atInstant` and `latest`.
6. **Latest raw records** *(drafter choice)*. A new route
   `GET /telemetry/points/:pointRef/raw?before=&limit=` returns
   `{pointRef, items: {time, deviceTime, value, unit}[], nextBefore}`, newest
   first, with a keyset cursor on `time` and a bounded `limit`
   (`DEFAULT_RAW_RECORDS_LIMIT` = 100, `MAX_RAW_RECORDS_LIMIT` = 500). It reads
   per point on the `(point_key, asset_id, time desc)` index. The order of
   checks is: decode the ref (400), check the asset id is a UUID (400, for a
   global admin too), `canReadAsset` (403), parse the query (400), read.
   `pointRawQuerySchema` is `.strict()` and lives beside the aggregate query
   schema in `packages/shared/src/contracts/telemetry-queries.ts`, with
   `MAX_RAW_RECORDS_LIMIT` and `DEFAULT_RAW_RECORDS_LIMIT` exported from
   `@bms/shared`; its `before` refinement calls `atInstantIsInRange`. It is
   registered as `TelemetryController_raw` and added to `QUERY_SCHEMAS` in
   `strict-body-ledger.spec.ts` (imported from `@bms/shared`), which moves the
   count pin from 27 to 28. `/recent` is not changed,
   because the dashboard depends on its shape.
7. **Latest value and poll time per point.** The page uses
   `GET /telemetry/points/at-instant` (any age, 50 refs per call, chunked). No
   new route.
8. **Batch read per asset** *(owner: left to the builder)*. The `F4.297` plan
   measured it: at most 16 points per asset, and the chart reads at most
   `MAX_WIDGET_POINTS` = 8 points, so the page makes at most 8 parallel
   `aggregate` calls. No batch route is built. A batch route, if a later row
   needs one, is added to this decision by amendment before it is built. It
   must resolve scope once, return 403 on any foreign ref, cap the ref count,
   and be declared before `points/:pointRef`.
9. **Timezone on this page** *(owner: an asset page is a site view)*. The
   asset history page uses the asset's location `timezone`, else its
   organization's, with a stored `UTC` computed as `Etc/UTC` and a stored zone
   that fails `isValidTimeZone` falling to the next link (the chain of
   decisions 2.8 and 4.3). It shows every time (chart axis, bucket table, raw
   records, poll times) and takes the custom `datetime-local` input in that
   zone, and prints the zone with the rollup level and the window ends under
   the chart. Browser-local time is not used. *(drafter choice)* The zone
   reaches the page on the `aggregate` response as `timeZone` (optional in the
   schema, so an older response still parses): the server resolves it after
   `canReadAsset` from the asset's location and organization, so a scoped user
   needs no admin read. The chain is one pure function, declared once by
   `F4.298` U1 (`packages/shared/src/contracts/time-zone-chain.ts`), and both
   rows call it.

### 2. `F4.298` — energy page filter and KPI tiles

1. **Endpoint** *(owner ruling, applied by the drafter)*. The owner ruled
   "`F4.298` owns the energy preview change". The drafter applied that ruling
   to a new route, `GET /reports/energy/view`, and the owner confirms that at
   this record's review. The route sits on `ReportsController`, beside the
   preview, under the same `ReportScopeService`. `GET /reports/energy/preview` does **not**
   change. Reason: `energyReportQuerySchema` (`report-writes.ts:109`) is parsed
   by four routes, is `.extend`ed by the copilot tool, and its `.shape` builds
   the save body; and `energyCentreSummarySchema` feeds the CSV/XLSX/PDF rows
   (`reports.serialise.ts`), which are a client deliverable (ADR 0026). So the
   preview, the three export routes, `energy-pdf.ts` and the copilot
   `get_energy_report_preview` tool are untouched. The trailing-window
   dashboard routes (`/dashboard/energy/*`) stay for their other callers and
   are not extended, because their `now()` bound cannot express a custom range.
2. **Query** (`energyViewQuerySchema` in
   `packages/shared/src/contracts/energy-view.ts`, `.strict()`, no body):
   - `range`: `"today" | "24h" | "7d" | "30d" | "this_month" | "1y" | "custom"`.
     Presets end at `now`. `today` and `this_month` start at local midnight of
     the day or the first day of the month in the view's timezone
     (decision 2.8). `1y` is 365 × 24 h.
   - `from`, `to` (ISO instants), required by the service when
     `range = custom`. The service refuses, with a 400, a custom range with a
     missing end, `from ≥ to`, or a span over `MAX_WIDGET_WINDOW_MINUTES`
     (365 days). The preview and the exports keep their 31-day limit until
     `F4.303` decides otherwise.
   - `organizationId?: uuid`; `locationIds` (the shared `reportSiteFilterSchema`,
     now exported). A parent location includes its children, by the
     `LocationAssetScopeService` rule (F4.291). Named locations decide the
     organization. The order of checks: the named locations are resolved
     first, with their grant check, so a location of another organization
     that the caller cannot read is a 403; only then is the organization
     compared, so readable locations that do not belong to the given
     `organizationId` are a 400. With no
     `locationIds`, the caller must read the organization (else 403), and the
     scope is `readableAssetIdsInOrganization`. With neither, a caller who
     reads exactly one organization gets that one; a global admin gets a 400
     "organizationId is required". There is no fleet-wide view, because a
     fleet has no timezone.
   - `compare?: "previous"`. The server computes the equal-length period that
     ends at the range start. The two periods never share a bucket.
   - Registry and ledger: `ReportsController_energyView: energyViewQuerySchema`
     in `openapi-registry.ts`, and `energyViewQuerySchema` in `QUERY_SCHEMAS`
     (`strict-body-ledger.spec.ts`). It has no entry in
     `testing/strict-body-ledger.data.ts`, which holds body schemas only.
3. **Response** (`energyViewSchema`): `organizationId`, `timeZone`,
   `generatedAt`, `level` and `bucket` (each `1m` | `5m` | `1h` | `1d`),
   `current` and `compare` (`EnergyViewPeriod | null`), `topConsumers`
   (current period only) and `partial: {readableSites, selectedSites} | null`.
   `EnergyViewPeriod` carries `from`, `to`, `durationHours`, `hasData`,
   `totalKwh`, `peakKw`, `peakAt`, `avgPf`, `pueEstimate`, `indicativeCost`,
   `tariffPerKwh`, `currency`, `sourceTotals` and `series`. It reuses
   `energySourceMixPointSchema`, `energyReportSourceTotalsSchema` and
   `energyTopConsumerSchema` by reference. `avgPf` is the sample-weighted mean
   (`avgExpr`) of every `pf` point in scope at the read level; a kW-weighted PF
   is a later row.
4. **Level and bucket.** One level for the whole view. The display bucket is
   chosen from the range: ≤ 3 h `1m`, ≤ 48 h `5m`, ≤ 45 d `1h`, else `1d`. The
   read level equals the bucket, except that a `1d` bucket reads `_1h` and
   groups it with `time_bucket(INTERVAL '1 day', bucket, <zone>)`, because
   `point_values_1d` holds UTC days. `levelForRange` is called once, with the
   older period's start, so one level serves both periods. If it coarsens past
   the bucket, the bucket becomes the level. The response returns both.
   - **Departure from ADR 0025.** ADR 0025 "Settled at the gate"
     (`docs/adr/0025-aggregate-read-conversion.md:440`) put the reports path on
     `_1h`, because the export is a client deliverable. The energy view is a
     screen, not an export, and reads `_1m` / `_5m` for a range up to 48 h. The
     preview and the exports still read `_1h`. This record approves that
     departure for `GET /reports/energy/view` only.
5. **Access before read.** Asset ids are resolved and intersected with the
   caller's readable assets before any `telemetry.*` read. A global admin
   (`readableAssetIds === null`) resolves to the explicit asset list of the
   named organization (`readableAssetIdsInOrganization`), never to "no
   filter". `energyPeriodRead` and `averagePf` each take that list
   (`readonly string[]`, never `null`) and carry `a.id = ANY($n::uuid[])` with
   no `IS NULL OR` leg. The view reads the top consumers only through
   `viewTopConsumers`, which binds the list as `$4` and never `null`.
   `topConsumersRead` (the byte-for-byte move of decision 2.10) keeps its
   nullable `($4::uuid[] IS NULL OR …)` leg for the preview only. An empty list
   returns the empty result before any statement runs.
6. **KPI tiles**: total kWh, peak kW with its time, average PF, PUE, cost, the
   rollup level, and the change against the previous period. The change is
   computed on the web only when both periods have `hasData`.
7. **Filter source for every role.** A new route
   `GET /reports/energy/filter-options` returns the caller's readable set:
   `{organizations: [{id, code, name}], locations: [{id, name, parentId,
   organizationId}]}`. A parent outside the readable set is sent as
   `parentId: null`. It has no query, so it has no registry entry. Reason: a
   scoped `operator` or `viewer` cannot call `/admin/organizations` or
   `/admin/locations` (`requireMasterDataUser`), and the `/auth/me`
   `AccessLocation` carries no `organizationId`. No timezone goes to the
   client. Both new routes send `Cache-Control: no-store`, because their
   answer depends on the caller's scope.
8. **Timezone.** One location named: `locations.timezone`, else the
   organization's. Several locations, or none: the organization's
   `timezone`. The column default is `"UTC"`, and `isValidTimeZone("UTC")` is
   false (it requires a `/`, `report-writes.ts`), so `report-period.ts`
   `formatterFor` throws on it. The server maps `UTC` to `Etc/UTC` for the
   arithmetic and returns `timeZone: "UTC"`. Any other stored value that fails
   `isValidTimeZone` falls to the next link of the chain (location →
   organization → `Etc/UTC`), never a 500. The chain is one pure function in
   `packages/shared/src/contracts/time-zone-chain.ts` (`F4.298` U1), which
   the asset history page also uses (decision 1.9). It reuses `localDateOf`,
   `toInstant` and `addLocalDays` from `report-period.ts`.
9. **Partial.** `selectedSites` is the subtree of the named locations, or every
   active location of the organization when none is named. `readableSites` is
   the part of it in `readableLocationIds`. `partial` is `null` when
   `readableLocationIds` is `null`. The response sends the two counts only,
   never an unreadable location id *(owner: the counts tell a scoped user the
   size of the organization, and that is accepted)*.
10. **Enabling refactor** *(drafter choice)*. To keep one SQL for the top
    consumers and one rule for the nominal source split, `F4.298` moves the
    `ReportsService.energyTopConsumers` SQL byte for byte into
    `reports/energy-view-read.ts` (`topConsumersRead`; the preview delegates to
    it, and the view calls it only through `viewTopConsumers`, decision 2.5),
    extracts `nominalSourceSplit` into `telemetry/energy-sources.ts`
    (called from `dashboard/energy-centre.ts` and `reports.service.ts`), and
    deletes the web client `apps/web/src/api/energy-dashboard.ts`, whose only
    importers are the Energy page and its spec. The `/dashboard/energy/*` API
    routes and their shared schemas stay. The existing parity test
    (`rollup-conversion.integration.spec.ts`) must stay green, and a new parity
    test compares the view's `totalKwh` and `topConsumers` with the preview's.
11. **Shared `AggregateLevel`** *(drafter choice)*. **`F4.298` U1 owns it.** It
    adds `packages/shared/src/contracts/aggregate-level.ts`
    (`aggregateLevelSchema = z.enum(["1m", "5m", "1h", "1d"])`), the one
    declaration that AGENTS §4.8 allows. `apps/api/src/telemetry/point-aggregates.ts`
    re-exports the type from `@bms/shared` in place of its local alias, and
    `LADDER` stays the literal that `tests/adr-0025-level-selector.test.ts`
    matches. The same unit rewrites the two docblocks that say the level is
    deliberately not restated in `packages/shared`:
    `packages/shared/src/contracts/envelopes.ts` (the `pointAggregateStatsSchema`
    docblock, lines 301-305 at `d693b38c`) and
    `packages/shared/src/contracts/health.ts` (lines 8-16). `F4.297` does not
    add a `level` field (it reports `bucketSeconds`). Any later row that needs
    the enum imports this file. If `F4.297` merges first and needs the enum,
    it rebases onto `F4.298` U1 and does not declare a second one.
12. **Half-hour zones** *(drafter choice)*. In the energy view, `F4.298` owns
    the bucket alignment. A `1d` bucket is a local day (decision 2.4). A `1h`,
    `5m` or `1m` bucket stays UTC-aligned: in a zone with a non-whole-hour
    offset (India, +05:30), an hourly bucket spans two local half-hours. The
    view shows the level, the bucket and the zone (for example
    `1h rollup · 1 day buckets · Asia/Kolkata`) and does not realign an hour.
    The asset history page (`F4.297`) prints the level, the window ends and
    the site zone, and does not realign an hour either (decision 1.9).

### 3. `F4.300` — trend-point schema

1. **Catalog default.** Migration `0117` adds
   `bms.point_keys.trend_default boolean` (nullable, no default), with a
   comment. The flag is tri-state: `NULL` is undecided (the seed may fill it),
   and `true` or `false` is decided by the seed or an admin. A
   `NOT NULL DEFAULT false` column cannot tell "an admin chose false" from
   "nobody chose", so a re-seed would revert the admin's edit. The DTO exposes
   `trendDefault: boolean` as `trend_default IS TRUE`.
   - No new policy or grant on `point_keys`, as with migrations 0083 and 0114.
   - A `BEFORE INSERT` trigger on the 0084 pattern (a second function,
     `bms.point_keys_refuse_tenant_trend_default`, because 0084 is frozen)
     refuses a `bms_tenant` insert with `trend_default IS NOT NULL` (SQLSTATE
     42501). The flag is tri-state, so a tenant sets neither `true` nor
     `false`: a tenant `false` would read as a decided catalog value that the
     seed then never fills. A tenant never sets the catalog flag; an
     organization's choice goes in `bms.org_trend_points` (decision 3.3).
     INSERT is the only path to cover: migration 0059 revoked UPDATE
     and DELETE on `bms.point_keys` from `bms_tenant`, so an UPDATE and an
     `INSERT … ON CONFLICT DO UPDATE` are already refused.
   - Only a global `admin` sets it, through the existing
     `PATCH /admin/point-keys/:id` (ADR 0051 / 0046), whose body gains
     `trendDefault`.
   - **No `trend_rank` column.** The catalog default list orders by
     `headline_rank NULLS LAST, code`. An organization list orders by its own
     `sort_order`.
2. **Segment** *(drafter choice)*. A segment is a `bms.asset_domains.code`. A
   new segment is a new data row (ADR 0031 Amendment 1), never a code change.
   *Superseded by the owner's answers (see Status):* F4.300 adds the `ups`
   segment. The seven `CONTROL_ROOM_UPS_POINT_KEYS` codes, the seeded UPS and
   battery assets and the stock `electrical-ups` template are domain `ups`. A
   segment's list may still name a code filed under another segment
   (decision 3.4), so Electrical can keep `load_pct` and `battery_v` for a DG
   set.
3. **Organization override.** Migration `0117` creates
   `bms.org_trend_points`:
   `organization_id uuid NOT NULL REFERENCES bms.organizations(id)`,
   `domain varchar(64) NOT NULL REFERENCES bms.asset_domains(code)`,
   `point_key varchar(128) NOT NULL REFERENCES bms.point_keys(code)`,
   `sort_order smallint NOT NULL CHECK (sort_order >= 0)`,
   `updated_at timestamptz NOT NULL DEFAULT now()`,
   `updated_by uuid REFERENCES bms.users(id)`, with the primary key
   `(organization_id, domain, point_key)`.
   - No foreign key carries an `ON DELETE` clause. `asset_domains` and
     `point_keys` are retire-only vocabularies (`active = false`), so a delete
     that a list still references fails loudly.
   - **Grants.** The migration writes no `GRANT`. It creates the table as
     `bms_owner` inside `SET ROLE bms_owner; … RESET ROLE;`, and migration
     0041 (lines 112-119, `ALTER DEFAULT PRIVILEGES FOR ROLE bms_owner IN
     SCHEMA bms`) grants `SELECT, INSERT, UPDATE, DELETE` on every new `bms`
     table to `bms_tenant` and `bms_fleet`. This is the 0078 and 0082 shape.
     The migration header says so. (0045 sets default privileges for
     `bms_rollup` only, and does not apply here.)
   - `ENABLE` and `FORCE ROW LEVEL SECURITY`, with one `tenant_isolation`
     policy whose `USING` and `WITH CHECK` are both
     `organization_id = nullif(current_setting('app.current_organization', true), '')::uuid`,
     on the 0082 pattern. `domain` and `point_key` point at global tables, so
     no foreign-row leg is needed.
   - The table goes in `FORCED_TABLES`
     (`bms-owner-rls.integration.spec.ts:31`), and the length assertion
     changes.
   - The Drizzle mirror is a sibling schema file
     (`packages/db/src/schema/trend-points-schema.ts`), the
     `site-control-room-views-schema.ts` convention. `bms-schema.ts` has 834
     lines against the AGENTS §4.5 cap of 1000, so it is not at the cap; the
     sibling file keeps the headroom. Its `pointKeys` block gains the nullable
     `trendDefault` column.
4. **Resolution rule** *(drafter choice)*. If an organization has any row for a
   domain, those rows are its list for that domain. Otherwise the catalog
   default applies. A new organization needs no setup. An inactive point key
   (`active = false`) is left out of the effective list, and its override row
   is kept, so a reactivation restores it.
   - **Replace-all.** `PUT /admin/organizations/:organizationId/trend-points/:domain`
     with `{pointKeys: [...]}` deletes that segment's rows and inserts the body
     in order (`sort_order` = index). `pointKeys: []` deletes them, which means
     "back to the catalog default". There is no `DELETE` route.
   - **Cap.** At most 12 codes per segment (`TREND_POINTS_PER_SEGMENT_MAX`), no
     duplicates, each code matching `CATALOG_CODE_PATTERN`. An unknown domain
     is a 404; a code not in `point_keys` is a 400.
5. **Who edits** *(owner)*. An organization admin edits the list for that
   organization, and a global admin edits any organization's list. The API
   write uses `requireMasterDataUser`, then
   `isOrganizationLevelAdmin(jwt, organizationId)`. The web adds a
   `canEditTrendPoints` predicate (`admin` or `organization_admin`) in
   `admin-access.ts` and a "Trend Points" tab under Reference Data. The write
   is audited through `MasterDataAuditService` with
   `action: "master.organization.trend_points.set"` *(drafter choice)*.
6. **Who reads** *(owner)*. Every user who can read the site reads the
   effective list, through `GET /control-room/sites/:locationId/trend-points`
   (the `SiteControlRoomViewService.resolve` readable rule; an unreadable site
   is a 404). The admin read is
   `GET /admin/organizations/:organizationId/trend-points`, under the decision
   3.5 gate. The list is metadata. A consumer still checks access to each
   asset before it reads telemetry.
7. **Contracts** (ADR 0030), in `packages/shared/src/contracts/trend-points.ts`:
   `trendDefault` (required) on `adminPointKeyDtoSchema`, an optional
   `trendDefault` on the point-key create and update bodies, the effective
   list DTOs for an organization and a site, and the replace-all body
   `putOrgTrendPointsBodySchema` (`.strict()`). The body is registered as
   `OrgTrendPointsAdminController_putSegment` and has a
   `STRICT(CALLER_ERROR)` entry in `apps/api/src/testing/strict-body-ledger.data.ts`.
8. **Seed.** `trend_default` is seeded by one
   `UPDATE … SET trend_default = true WHERE trend_default IS NULL AND code = ANY($1)`
   (`seedPointKeyTrendDefaults`, `TREND_DEFAULT_SEED`), called after
   `seedPointKeyHeadlineRanks`. Because it writes only a `NULL` row, a re-seed
   never overwrites an admin's `true` or `false`. This is the
   `headline_rank IS NULL` precedent (F3.68). The owner may edit the seed list
   at plan review.

### 4. Rulings the owner accepted from the design (2026-10-31)

All of these are *(owner)* and apply to every row in this record:

1. **One shape per contract.** `F4.297` owns the `aggregate` change and
   `F4.298` owns the energy preview change. The drafter applied the second
   half to the new `GET /reports/energy/view` route (decision 2.1); the owner
   confirms that at this record's review.
   Later rows reuse them. No view calls a route twice and computes the
   difference in the UI.
2. **Scoped totals.** Totals, rankings and lists sum only the assets the user
   may read. When the scope is narrower than the selection, the view shows
   "partial — your access covers N of M sites". A whole-organization total is
   never shown to a scoped user.
3. **Timezone.** A site view uses the site's `timezone`, then the
   organization's, then `UTC`. An organization view uses the organization's.
   A view over several locations uses the organization's *(drafter choice,
   decision 2.8)*. The asset history page is a site view (decision 1.9). "Today", "This month" and the heatmap follow it, DST days
   included. A stored `UTC` is computed as `Etc/UTC` (decision 2.8).
4. **Units.** One unit per chart axis. A point with another unit goes on a
   second axis or a separate chart and is never summed. kWh, kW, PF and the
   energy source use the definitions the Energy page already uses
   (`EnergySourceMixPoint`).
5. **One rollup per view.** One level for the whole view, chosen from the range
   and shown on the view.
6. **Empty or partial compare.** The compare series shows its gaps. The change
   figure shows only when both periods have data. Otherwise the view shows
   "no data for the previous period".
7. **Abnormal is advisory.** The abnormal list is read-only. It never raises an
   alarm or a notification. An asset with too little history is listed as
   "not enough history", not as normal.
8. **Pin is trailing.** Pin to a dashboard pins a trailing window, as the
   `chart` widget does today, not a fixed date range.
9. **Exports are server-built**, with a row cap that the `F4.303` plan sets.

### 5. Anti-goal: nothing per organization or per segment in code

1. No code names an organization, an organization code, a location or a
   segment to decide what a view shows. Every view reads the organization, its
   location tree, `asset_domains` and the point catalog. A new organization
   gets every view with no code change and no required setup.
2. A segment that the catalog gains later shows in the Trends tab and the strip
   with no release.
3. Every `telemetry.*` read checks access (`readableAssetIds` /
   `canReadAsset`) before it reads.
4. A static guard in `tests/` checks the new modules of these rows for
   organization codes and domain literals *(drafter choice)*. **The first PR
   to merge among `F4.297`, `F4.298` and `F4.300` lands it**: a new `tests/`
   file (`tests/adr-0108-no-org-or-segment-literals.test.ts`), listed by hand
   in `tsconfig.typecheck-tests.json` `files`. It scans the new modules of all
   three rows: the first PR lists its own modules (every listed path must
   exist), and each of the other two rows extends the module list in its own
   PR. Each later row of decision 6 does the same by its amendment. It exempts, by name, the seed list `TREND_DEFAULT_SEED` in
   `packages/db/src/point-key-trend-defaults-seed.ts` (seed data names codes
   per domain on purpose) and the existing `PV%` solar rule (Consequences).
   `F4.298`'s `energy-view-read.ts` reuses that `ILIKE 'PV%'` predicate, so the
   exemption names that one predicate in that file, never the whole file.
   It carries a positive control on a mutated copy, so it cannot pass
   vacuously.

### 6. Later rows amend this record

`F4.299` (organization views), `F4.301` (Control Room trend strip, including
the site-tab to domain map), `F4.302` (Control Room Trends tab), `F4.303` (view
actions, generic trend report template, export row cap) and `F4.304` (kWh per
m²) each add an amendment to this record when they start, before any build.
Each amendment passes the AGENTS §10 gate.

### Amendment 1 — `F4.299` organization views (drafted 2026-11-01; owner answers the same day, Status)

Plan: `docs/plans/f4.299-organization-views.md`. Code citations are to `main` at `a1580048`. `F4.301` drafts Amendment 2 in parallel. A line marked *(owner)* awaits a ruling at this amendment's review (plan §8); the rest are drafter choices the owner may change.

7. **`F4.299` — the four organization views under the `F4.298` filter.**

   1. **Route.** One new sibling read, `GET /reports/energy/organization-views` (`ReportsController.energyOrganizationViews`), beside `energy/view`, under `Cache-Control: no-store`. It parses **`energyViewQuerySchema` by identity** — the same query shape, no new field and no new query schema — so `QUERY_SCHEMAS` keeps its count (29) and the registry gains only `ReportsController_energyOrganizationViews: energyViewQuerySchema` (the `energyReportQuerySchema`-under-four-keys precedent). The page issues it beside `energy/view`; the two routes answer different sections, so ruling 4.1 holds.
   2. **One frame.** `EnergyViewService.view` (`energy-view.service.ts:99-141`) splits into a public `frame(user, query)` — the place and check order of decision 2.2, the zone of 2.8, the range and compare of 2.2, the level and bucket of 2.4, the partial of 2.9 — and the reads. `EnergyOrganizationViewsService` injects `frame` and declares no second copy of any of those rules. Both services are provided by `ReportsModule`, never the loop-free core. `energy-view-read.ts` exports `displayGroupExpr(level, bucket, zoneParamIndex)` — the one `1d`-over-`_1h` zone-day expression, with its parameter position explicit — and `energyPeriodRead` keeps its statement text by calling it with `5`.
   3. **Response** (`energyOrganizationViewsSchema`, `packages/shared/src/contracts/energy-organization-views.ts`): `organizationId`, `timeZone`, `generatedAt`, `level`, `bucket`, `current` and `compare` bounds, `sites: { current, compare | null, totalSites }`, `trend: { columns, points }`, `heatmap: { cells }`, `abnormal: { baseline: { windows, windowsConsulted, stepDays, ratio }, entries, normalCount: { sites, assets }, truncated }`, `partial` (the `F4.298` `energyViewPartialSchema`, by reference). Plain `z.object`s and one `z.discriminatedUnion("kind", …)` for the trend's site/other columns; no `.merge()`, `.extend()`, `z.intersection` or `.readonly()`. Derived types join `packages/shared/src/types/energy-view.ts`. The constants `TREND_SITE_SERIES_MAX = 8`, `SITE_RANKING_MAX = 50`, `ABNORMAL_LIST_MAX = 100`, `BASELINE_WINDOWS = 4`, `MIN_BASELINE_WINDOWS = 3`, `ABNORMAL_RATIO = 1.5` are exported from the contract file, because the page prints them.
   4. **Site ranking.** A site is the asset's `location_id` (`NOT NULL`, ADR 0018), named by **`bms.locations.name`** through a join — never `assets.site_name`, the denormalised text `topConsumers.siteName` carries. One row per location, no roll-up (the tree is flat today). Per site: `kwh` = Σ per read-level bucket of the summed per-asset mean kW × `bucketHours(level)` (the `totalKwh` definition, so Σ over all sites = `current.totalKwh`), `peakKw` = MAX per read-level bucket of the site's summed kW with its bucket time, `assetCount`. The server sends the top `SITE_RANKING_MAX` sites by kWh and `totalSites`; with `compare=previous` the previous period is read for those location ids. A site is in a period's list only when it has a `kw` row in it, so presence is `hasData`; the web shows a change only when the site is in both lists and the previous kWh is above zero (decision 2.6, ruling 4.6), else "no data for the previous period".
   5. **Total trend.** By source: `energy/view`'s `current.series` (no new read). By site: one aligned grid over the display bucket, the top `TREND_SITE_SERIES_MAX` sites by kWh as columns (ties: kWh, then name, then id) and — only when more sites have data — every other site summed into one `other` column, folded on the server. The compare total is `energy/view`'s `compare.series`, summed per point and shifted by `+span` (decision 1.3), drawn dashed. A `1d` bucket is a local day (decision 2.4) through `displayGroupExpr`.
   6. **Heatmap.** Bucket = one local hour in the view's arithmetic zone (ruling 4.3); cell = (local date, local hour 0–23); value = kWh = Σ over read-level buckets whose start falls in that local hour of the summed kW × `bucketHours(level)`, read at the view's level (ruling 4.5). The grouping is `AT TIME ZONE <zone>` in SQL with the zone bound as a parameter, so a 25-hour day sums two buckets into its repeated hour and a 23-hour day leaves its missing hour empty; a half-hour zone attributes a UTC-aligned bucket to the local hour of its start (decision 2.12). Colour: one hue (`accent`), linear from 8 % alpha to full, `0` to the nearest-rank 95th percentile of the non-empty cells (cells above saturate); empty cells are not drawn and are labelled "no data".
   7. **Abnormal list** *(owner: the thresholds, plan Q1)*. Entities: every site and every readable asset with a `kw` row in the current period. `current` = its kWh over the period (the 7.4 definition). Baseline = the **median** of its kWh over `BASELINE_WINDOWS` = 4 copies of the period shifted back by `k × step` local days, `k = 1..4`, `step = ceil(durationHours / 24)` for every range kind, the wall clock and the sub-minute remainder kept (`localDateOf` → `addLocalDays` → `toInstant`, plus `instant % 60 s`; `wallTimeOf` is exported from `report-period.ts`), so "today" compares with the same hours of the four preceding days and `7d` with the four preceding weeks. A window whose start lies before `now − retentionDays(level)` is dropped before the read and `windowsConsulted` says how many were read — reachable only for a `custom` range ≤ 48 h placed about two years back, and never a 500 or a silent "no history". A window counts when the entity's distinct read-bucket count in it is at least half its count in the current period. Verdict: `not_enough_history` with fewer than `MIN_BASELINE_WINDOWS` = 3 counting windows or a zero baseline; `above` when `current / baseline ≥ ABNORMAL_RATIO` = 1.5; else `normal`. The server sends `above` (by ratio) then `not_enough_history` (by name) entries, at most `ABNORMAL_LIST_MAX`, with `truncated`; `normal` entities are counted in `normalCount`, never sent as rows. One statement over `GROUPING SETS ((asset, window), (location, window))`; the verdicts are pure TypeScript. **Advisory only (ruling 4.7):** read-only, no alarm, rule, notification or write; `tests/f4.299-abnormal-is-advisory.test.ts` asserts the new api modules import nothing from `alarms/`, `rules/` or `notifications/` and that the reads file carries no `INSERT`/`UPDATE`/`DELETE`, with a positive control.
   8. **Access before read (decision 5.3).** Every read takes the frame's `assetIds: readonly string[]` — the explicit list of `readableAssetIdsInOrganization` or `placeForCaller`, never `null` — and carries `= ANY($n::uuid[])` with no `IS NULL OR` leg; an empty list returns the empty sections before any statement. The location names in the response belong to readable assets' locations; every grant source lists the locations its assets come from (`access-scope-sources.ts`), and `energy/filter-options` already sends those names to the same caller (decision 2.7). No id or name of an unreadable location leaves the server; `partial` carries the two counts only.
   9. **Scale and latency** *(owner: what gives on a miss, plan Q2)*. Measured 2026-11-01 on the compose stack: 206 assets, 26 locations (depth 1), 1,467 `_1h` kw rows; the per-site 30 d read ran in 158 ms + 35 ms planning. Full scale (200 assets with `kw`): 144k `_1h` rows at 30 d, 1.75M at 1 y, the baseline ×5. Target: the organization-views call ≤ 1.5 s server time at 30 d and ≤ 5 s at 1 y; the build records `EXPLAIN (ANALYZE)` figures in the closure. Every list in the body is bounded (7.3, 7.4, 7.5, 7.7; the heatmap by the 365-day range cap), so a client with more sites or assets gets a trimmed body, never a 500.
   10. **Guard modules (decision 5.4).** `tests/adr-0108-no-org-or-segment-literals.test.ts` scans, once they exist: `packages/shared/src/contracts/energy-organization-views.ts`, `apps/api/src/reports/energy-abnormal.ts`, `apps/api/src/reports/energy-organization-reads.ts`, `apps/api/src/reports/energy-organization-views.service.ts`, `apps/web/src/lib/energy-stack-option.ts`, `apps/web/src/lib/energy-organization-views.ts`, `apps/web/src/components/energy/energy-stack-chart.tsx`, `apps/web/src/components/energy/site-ranking-table.tsx`, `apps/web/src/components/energy/energy-heatmap.tsx`, `apps/web/src/components/energy/abnormal-list.tsx`; and the two existing files this row rewrites, `apps/web/src/components/energy-source-stack-chart.tsx` and `apps/web/src/pages/energy-page.tsx`. Each new path is listed in `PENDING_MODULES` by the row's first commit and moved to `MODULES` in the commit that creates it. No new `LIKE` pattern, so no new exemption. `apps/api/src/reports/energy-organization-reads.ts` joins `tests/repo-invariants.test.ts`'s `rollupFiles`.

**Consequences added.** `ReportsController` gains a fourth constructor parameter (five harnesses change: four spec files and `energy-view.integration.test.ts`). `EnergyViewService.frame` is public; `view()` calls it. `displayGroupExpr` is exported from `energy-view-read.ts` and `wallTimeOf` from `report-period.ts`. `setUpEnergyViewReadFixture` gains a second location and asset in organization A; its existing claims are unchanged because they pass an explicit scope. `energy-source-stack-chart.tsx` becomes a wrapper over the new generic stack chart and keeps its name, its `F3.65c` colour order and its `tests/f3.1c` standing. The registry grows by one key on an existing schema; the ledger and the `QUERY_SCHEMAS` pin do not change. One new `tests/` file (`tests/f4.299-abnormal-is-advisory.test.ts`) joins `tsconfig.typecheck-tests.json`.

**Verification owed (added).** Cross-tenant: as an A-scoped caller, `organization-views` with a foreign `organizationId` or a foreign `locationIds` is a 403 with no `telemetry.*` statement; naming a parent with unreadable children gives `partial` counts and leaves the unreadable asset and its location name out of every section (sites, trend columns, heatmap total, abnormal entries), each with an adjacent positive case. Parity: Σ `sites.current[].kwh` over all sites equals `energyPeriodRead(...).totalKwh`; Σ heatmap cells equals it too. Zone: a `_1h` bucket at `10:00Z` lands in local hour 15 in `Asia/Kolkata`; the `America/New_York` 2026-11-01 fall-back sums two buckets into one cell and 2026-03-08 has no hour-2 cell; baseline windows keep their wall clock and seconds across a DST change. Retention: a window past `retentionDays(level)` is not read and `windowsConsulted` says so. Statistic: 2 counting windows → `not_enough_history`; ratio 1.5 → `above`; 1.49 → `normal`; a zero baseline never divides; a site's bucket count is distinct buckets, not a sum over assets. Bounds: 50 sites, 8 + `other` columns only above 8, 100 entries with `truncated`, `normal` counted not sent. Recording queryable: every read binds the scope list, no `IS NULL OR`, no `LIKE`, the zone as a parameter at the index given; an empty list runs no statement. The advisory guard with its positive control. Latency figures at 30 d and 1 y against 7.9.

### Amendment 2 — `F4.301` Control Room trend strip

**Status: Drafted 2026-11-01; the owner answered its questions the same day (Status)** (drafted from `docs/plans/f4.301-trend-strip.md`; the owner accepts it by merging this record, per decision 6 and AGENTS §10; Amendment 1 is `F4.299`'s). Code citations are to `main` at `a1580048`. A line marked *(owner)* is a ruling the owner gives at this amendment's review (plan §8); the others are drafter calls.

1. **Tab → segment map.** A Control Room site tab maps to segments **through the assets on the tab**: the distinct `bms.assets.domain` of the readable assets in the tab's scope, in the order `TrendPointsService.forSite` returns (`asset_domains.sort_order`, then code). The scope is the **selected** tab's `dashboard_tabs.asset_group_id` — on the bare path that is the first stored tab (`site-dashboard-view.tsx:94`), so the strip follows the canvas; `null` is the whole site, as are the generated view (`F3.68`) and the built-in view's Main Dashboard. Membership is `bms.asset_group_members`, the only membership table. No table in code maps a tab to a segment. `asset_groups.domain` is **not** the source: the seeded `ups-battery` group still reads `electrical` (`packages/db/src/asset-groups-seed.ts:313-320`) while its members are domain `ups` (decision 3.2 as amended). The stock template's per-tab `domain` field (`smoc-standard.ts:356`) is a planner input and is not read by any view.
2. **Series rule.** A series is one (asset, code) pair where `code` is in the effective trend-point list (decision 3.4) of **the asset's own domain** and `bms.asset_points` holds an active registration of that code for that asset. A listed code no asset on the tab registers draws no row; a segment with no row is absent. Decision 3.4's cross-segment code works by this join with no special case.
3. **Batch route (decision 1.8 applied).** `F4.301` adds `GET /control-room/sites/:locationId/trend-strip?range=24h|7d|30d&assetGroupId=<uuid>` on `TrendPointsModule` (`apps/api/src/trend-points/trend-strip.controller.ts`, `trend-strip.service.ts`). It resolves scope once; the client sends no point reference, so no foreign ref can arise; a group that is not `asset_groups.location_id = :locationId` is a 404; the series count is bounded by a server trim (item 5); the route is on `control-room`, so the `points/:pointRef` declaration-order trap does not apply. Order of refusals: `locationId` shape (400), query (400, `.strict()`), readable site (404, the decision 3.6 rule, by calling `TrendPointsService.forSite`), group at site (404), scope, one telemetry statement. A malformed query on a foreign site answers 400 and names only the query shape. The response sends `Cache-Control: no-store`.
4. **Access before read (§5.3).** `readableAssetIds(jwt)` is intersected with the site's (or the group's) explicit asset list before the telemetry read; a global admin (`null`) resolves to that explicit list, never to "no filter". The statement binds the pair arrays (`unnest($1::uuid[])`, `unnest($2::text[])`) and carries no `IS NULL OR` leg. An empty scope returns `segments: []` and runs no `telemetry.*` statement.
5. **Level, alignment, fold and caps.** The strip declares its read level per range in `TREND_STRIP_RANGES` (`packages/shared/src/contracts/trend-strip.ts`): 24 h reads `telemetry.point_values_5m` into 1 800 s folds (48 buckets); 7 d reads `_1h` into 10 800 s (56); 30 d reads `_1h` into 43 200 s (60). The widget ladder (`granularityFor`) is not used: it has no `5m` rung and would read `_1m` for 24 h, thirty rows per fold for the same weighted mean. The declared level still passes `levelForRange`, so the retention guard stays one function. Windows are aligned: `to = floor(now, bucketSeconds)`, `from = to − window`, read as `[from, to)`, so the in-flight fold is dropped and every range returns exactly its bucket count; the newest point is at most one fold old. Folds use `time_bucket` and `avgExpr` (ADR 0023's one correct mean); gaps are filled with `fillBucketGaps`, so an outage is a `null`. One statistic, the weighted mean, for every point (ruling 4.5; min/max stay on the history page). **Caps trim, never 500.** `TREND_STRIP_MAX_ASSETS_PER_POINT = 6` per point by asset code, the remainder a count `moreAssets` *(owner, plan Q1)*; `TREND_STRIP_OVERVIEW_POINTS_PER_SEGMENT = 3` on a whole-site strip, the full list (≤ 12, decision 3.4) on a group tab *(owner, plan Q2)*; `TREND_STRIP_MAX_SERIES = 180` as the server bound, met by a deterministic trim (assets per point first, then points per segment, then trailing points) that keeps every segment present and reports `assetsPerPoint`, `pointsPerSegment` and `trimmed` in the response. A new segment, organization or asset can never make this route answer 500; the only throw is `assertSeriesRowCount`, which fires when a relation's bucket width disagrees with its declared level (a configuration defect, the `assertBucketCount` class — that helper is not reused because its bound is capped at `MAX_BUCKETS` = 2 880). No site total that sums assets: the catalog has no additivity flag (ruling 4.4).
6. **Request budget.** One strip request per (tab, range), `refetchInterval` 60 s; a range switch is one more request; no per-point client reads. Server side: `forSite`'s reads, one zone read, one asset/registration read, one telemetry statement.
7. **Timezone.** The site chain (`resolveSiteTimeZone(location.timezone, organization.timezone)`, decisions 1.9 and 2.8) by `locationId`; the response carries `timeZone`, and the strip prints the window ends, the fold width (`formatBucketWidth`) and the zone. A stored `UTC` is computed as `Etc/UTC` and reported as `UTC`.
8. **Contracts** (ADR 0030, AGENTS §4.8), in `packages/shared/src/contracts/trend-strip.ts`: `trendStripRangeSchema`, `siteTrendStripQuerySchema` (`.strict()`, no refinement), `trendStripAssetSeriesSchema` (`assetId`, `assetCode`, `assetName`, the registration's effective `unit`, `buckets` reusing `pointAggregateBucketSchema` from `envelopes.ts` by reference), `trendStripPointSchema` (`code`, `name`, the catalog `unit`, `assets`, `moreAssets`), `trendStripSegmentSchema` (reuses `trendPointSourceSchema`), `siteTrendStripSchema` (`from`/`to` as ISO datetimes, `level` reusing `aggregateLevelSchema`, `bucketSeconds`, `timeZone`, `assetsPerPoint`, `pointsPerSegment`, `trimmed`, `segments`). Plain `z.object` throughout; no `.merge()`/`.extend()`, no `z.intersection` (nothing is `A & B`), no `.readonly()` (nothing is all-readonly). Types are `z.infer` in `packages/shared/src/types/trend-strip.ts`. Registry: `SiteTrendStripController_forSite: siteTrendStripQuerySchema`; `QUERY_SCHEMAS` 29 → 30 (`apps/api/src/openapi/strict-body-ledger.spec.ts`, the entry comment and the pin comment); no body, so `strict-body-ledger.data.ts` and the copilot catalog are unchanged.
9. **Where the strip mounts.** `GeneratedSiteView` (whole site, after the domain panels); `SiteDashboardView` (under the canvas, the selected tab's `assetGroupId`; not on the wall, `?wall=1`); the `builtin/smoc` view of `RSMOC-WC` on its Main Dashboard tab only, whole site *(owner, plan Q3)*. The live tiles, the mimic canvases and the SLD do not change. A click on a sparkline opens **`/asset-history/:assetId?range=<range>&points=<code>`** — the route as renamed by the owner's ruling of 2026-11-01 (`fix/F4.297-history-route`; decision 1.1's page already reads both parameters). `F4.301` builds after that rename merges and spells the path once, through the rename's constant.
10. **UPS trend points** (decision 3.2 as amended) show wherever a `ups`-domain asset is in scope: the tab bound to the group that holds it (`ups-battery` on the stock layout), the Overview, and the generated view's `ups` panel — never on the Electrical tab unless an administrator adds a UPS asset to the electrical group.
11. **Anti-goal guard (§5.4).** `tests/adr-0108-no-org-or-segment-literals.test.ts` scans these new runtime modules: `packages/shared/src/contracts/trend-strip.ts`, `packages/shared/src/types/trend-strip.ts`, `apps/api/src/trend-points/trend-strip.pure.ts`, `trend-strip-read.ts`, `trend-strip.service.ts`, `trend-strip.controller.ts`, `apps/web/src/api/trend-strip.ts`, `apps/web/src/lib/trend-strip.ts`, `apps/web/src/components/control-room/sparkline.tsx`, `trend-strip.tsx`. The first commit lists the eight not yet created in `PENDING_MODULES` and the two it creates in `MODULES`; each later commit moves its files. Not scanned, with the reason: the three mount-point files (`generated-site-view.tsx`, `site-dashboard-view.tsx`, `smoc-site-view.tsx`) pre-date this record and gain one import and one JSX line; `apps/api/src/testing/recording-pool.ts` is a test helper; specs and tests by the file's own rule. The strip never falls back to a literal segment label — every label comes from the response. `trend-strip-read.ts` joins `tests/repo-invariants.test.ts`'s `rollupFiles`.

**Verification owed by this amendment.** A scoped caller (asset-group scope) gets no series of an asset outside its groups (beside a positive case) and a 404 for a foreign site, with no `telemetry.*` statement in either case (recording pool); a global admin's read is bound to the explicit site list, never `null`; an empty scope runs no statement (paired with a positive case); the fold returns the weighted mean — samples 1, 1, 1 in one `_5m` bucket and 4 in the next, inside one 30-minute fold, give 1.75, where a mean of means gives 2.5 — with a `null` for an empty fold; an unaligned `now` returns exactly 48 buckets whose first `t` equals `from`; 216 planned series trim to 180 with every segment present; a per-run `asset_domains` row with a per-run code listed through an organization override appears as its own segment at the read (a new segment needs no release); a seeded `ups` asset appears under `ups` and under no other segment; the strip's error state renders a fixed sentence and never `error.message` (`tests/f4.204-raw-error-message-render.test.ts`); the Nest module wiring spec proves the new controller and the new service resolve inside `TrendPointsModule`; the §5.4 guard reddens on an injected `if (domain === "hvac")` in `trend-strip.pure.ts`.

**Consequences.** `QUERY_SCHEMAS` grows by one (29 → 30); the registry gains `SiteTrendStripController_forSite`; `packages/shared/src/index.ts` gains one `export type *` line (990 → 991 of 1 000); `rollupFiles` grows by one; the `pg.Pool` recorder moves from `energy-view-read.integration.spec.ts` to `apps/api/src/testing/recording-pool.ts`; every web spec that renders one of the three site views mocks `apps/web/src/api/trend-strip.ts`; the PR carries the `e2e` label (the generated site view is a covered path, ADR 0100). No migration, no grant, no RLS change, no new dependency, no new continuous aggregate.

### Amendment 3 — `F4.305` the trend strip as a dashboard widget

**Status: Drafted 2026-11-01; the owner answered its questions the same day, in chat, one at a time (Status).** Raised by the AWS check of `F4.301` (`dd0cab45`): on the site dashboard view the strip mounts under the whole canvas (item 9 of Amendment 2), so on a PHEWB site it sits at the foot of the page, below the mimic, not "under the live tiles" as the row says. On that view the tiles and the mimic are administrator-built canvas widgets, so no fixed mount can sit between them. A line marked *(owner)* is a ruling; the others are drafter calls the plan may refine.

1. **A widget kind, not a fixed mount** *(owner)*. `widgetTypeSchema` (`packages/shared/src/contracts/dashboard-builder.ts`) gains `trend_strip`; migration `0118` drops and re-adds `dashboard_widgets_widget_type_check` with the thirteenth value (the `0099_breaker_table_widget_type.sql` precedent). An administrator adds it from the widget picker, moves, resizes and deletes it like any widget. The widget renders the `F4.301` component and reads the `F4.301` route only — no new route, no new query schema, no new telemetry statement; items 1–8 of Amendment 2 (scope, series rule, access before read, level, caps, budget, zone, contracts) apply unchanged.
2. **Config by tab key** *(owner, 2026-11-01)*. `tabKey` (optional; the key of a tab of the same dashboard, whose bound asset group the widget reads; no `tabKey` = the whole site) and `defaultRange` (`24h | 7d | 30d`, required), in a `.strict()` object of the builder union. No group uuid is stored in the `jsonb` (the mimic `config.tabKey` precedent). The write path refuses a `tabKey` that names no tab of the dashboard; no points, no sources (the series come from the `F4.300` trend points). The site is the dashboard's own location; on a dashboard with no location the widget renders a fixed sentence and reads nothing. A group that is not at the dashboard's site keeps the route's 404, which the widget renders as a fixed sentence, never `error.message`.
3. **The click is unchanged** *(owner)*. A sparkline row opens `/asset-history/:assetId?range=<range>&points=<code>` exactly as the `F4.301` strip does, on every view the widget is drawn on.
4. **The stock layout** *(owner)*. Stock version 5 of `SMOC_STANDARD_SITE_TEMPLATE` (`packages/shared/src/site-templates/smoc-standard.ts`) puts one `trend_strip` on **every tab, directly under its top row of tiles**; the Overview's strip is the whole site (`assetGroupId = null`, so the first 3 points per segment, Amendment 2 item 5), each domain tab's strip is that tab's group. The widgets below move down by the strip's height.
5. **Existing site copies, edited tabs included** *(owner)*. The seed's upgrade chain (`packages/db/src/site-layout-seed-upgrade.ts`) gains a v5 step that, on every seed-owned site copy (the AWS demo included), inserts the strip under the top tile row of **every** tab and moves the widgets below it down — also on a tab an administrator edited, a recorded exception to the chain's "leave an edited tab" rule for this one widget. The step runs **once per copy**: it stamps the copy at stock version 5, and a copy already at 5 is skipped. **The stamp is a new nullable column `bms.dashboards.stock_version integer`, added by the same migration `0118`** *(owner, 2026-11-01)*; the seed copy and the API copy action both write the template's `stockVersion` at insert, and the v5 step reads copies with `stock_version IS NULL OR stock_version < 5`. A re-seed adds nothing twice and **a strip an administrator deletes stays deleted** *(owner)*. Inside the one run, a tab that already holds a `trend_strip` widget is skipped.
6. **The wall shows it** *(owner)*. The wall (`?wall=1`) draws the widget like any other; Amendment 2 item 9's "not on the wall" no longer applies to the widget.
7. **The fixed mounts.** `SiteDashboardView` drops its fixed strip (the widget replaces it, so no tab shows two). `GeneratedSiteView` keeps its fixed strip but moves it directly under its KPI tile row, before the domain panels. The `builtin/smoc` Main Dashboard keeps its strip under the Overview tab's content.
8. **Anti-goal guard (§5.4).** The widget's runtime module joins `MODULES` in `tests/adr-0108-no-org-or-segment-literals.test.ts`; the v5 seed step names no organization, site or segment literal (it finds the top tile row by geometry and widget type).

**Verification owed by this amendment.** The builder union refuses a `trend_strip` with an unknown field and accepts each range; a scoped caller's widget gets no foreign series (the route's own tests stand, plus one widget render that reads the route with the widget's `assetGroupId`); a click on a widget sparkline lands on `/asset-history/:assetId?range=&points=`; the v5 step on a fixture copy with an edited tab inserts one strip per tab, moves the lower widgets by exactly its height, overlaps nothing, and is a no-op on a second run; a cold start applies `0118` on a scratch database; the wall renders the widget; no tab of a seeded copy shows two strips.

**Consequences.** Migration `0118`, journal `idx` 119; `widgetTypeSchema` 12 → 13 values (the repo gates that parse the enum, the copilot catalog's widget steps and the widget picker follow); stock layout version 4 → 5 frozen in `site-layout-stock-history.ts`; the PR carries the `e2e` label. No new route, query schema, grant, RLS change or dependency. **`F4.306`** (later) is a guided setup wizard that places these widgets on a dashboard in steps (site, segments, points, ranges, preview); it draws nothing itself.

### Amendment 4 — `F4.302` the Control Room Trends tab

**Status: Drafted 2026-11-02; the owner answered its questions in chat the same day, one at a time (Status).** Drafted before any implementation code, from the row (`docs/BACKLOG.md`, `F4.302`) and the design's goal 5. Code citations are to `main` at `1ff2bdd9`. A line marked *(owner, 2026-11-02)* is a ruling; the others are drafter calls the plan may refine. The view actions (export, pin, link, schedule) stay `F4.303`'s; the setup wizard stays `F4.306`'s; kWh per m² stays `F4.304`'s.

1. **A third site section, not a dashboard tab** *(owner, 2026-11-02)*. The site page gains a third entry in its "Site sections" nav (`apps/web/src/pages/control-room/site-page.tsx:242-261`), **Trends & Energy**, at `/control-room/site/:locationId/trends`, beside *Site view* and *Assets & RTUs*. It is the `F3.72` `assets` shape: the `:tab` segment of the one route `/control-room/site/:locationId/:tab?` (`apps/web/src/App.tsx:386`), rendered for **every** view kind (generated, `dashboard`, `builtin/smoc`) once the resolve read has answered, exempt from the `F3.70` D5 redirect (`site-page.tsx:140-149`; the `onAssetsTab` leg gains an `onTrendsTab` leg), and never a wall page (`site-page.tsx:131` already excludes the assets section; the trends section is excluded the same way, and the **Wall** link at `:191` omits the segment). A dashboard tab cannot host it: the generated and the built-in views have no dashboard.
   - **The reserved key** *(owner, 2026-11-02)*. `SITE_TRENDS_TAB = "trends"` joins `SITE_ASSETS_TAB` in `packages/shared/src/contracts/dashboard-tabs.ts:15-18`; `RESERVED_DASHBOARD_TAB_KEYS` lists both, so `dashboardTabKeySchema` (`:30-35`) refuses it. **Migration `0119`** (journal `idx` 120) drops and re-adds `dashboard_tabs_tab_key_check` as `tab_key ~ '^[a-z0-9-]{1,64}$' AND tab_key <> ALL (ARRAY['assets','trends'])`, the `0094_dashboard_tabs.sql:97` CHECK the schema mirrors; before the ADD it renames any stored `trends` key to `'trends-' || left(id::text, 8)`, so the migration never fails on live data (none is seeded: the stock layout's keys are `overview`, `sld`, `ups`, `hvac`, `it`, `env`, `packages/shared/src/site-templates/smoc-standard.ts:376-412`). `packages/shared/src/contracts/dashboard-tabs.spec.ts:33` (reserved length 1) becomes 2. No other table, grant, RLS or policy changes. `SmocTabKey` (`apps/web/src/lib/smoc-pages.ts:6`) is unchanged.
2. **Two kinds of sub-tab: Energy, then one per segment present at the site** *(owner, 2026-11-02)*. Inside the section a second nav lists **Energy** first, then one entry per segment. A segment is an `asset_domains.code` row (decision 3.2), and the site's segments are the **distinct `bms.assets.domain` of the readable assets at the site** (`assets.domain` is `NOT NULL` with a foreign key to `asset_domains.code`, `packages/db/src/schema/bms-schema.ts:348-350`), in `TrendPointsService.forSite` order (`asset_domains.sort_order`, then code; `apps/api/src/trend-points/trend-points.service.ts:59-79`, `:170-204`) — the Amendment 2 item 1 rule, so the strip and the tab never disagree. Asset groups and dashboard tabs are not the source. A segment with readable assets but whose effective list draws no series shows a fixed sentence that points at Reference Data → Trend Points, never a literal label. No code names a segment: a per-run `asset_domains` row whose code an organization lists appears as its own sub-tab at the read (§5.2).
3. **The Energy sub-tab composes the `F4.298`/`F4.299` routes locked to the site; no new route** *(owner, 2026-11-02)*. It issues `GET /reports/energy/view` and `GET /reports/energy/organization-views` (`apps/api/src/reports/reports.controller.ts:179-184`, `:200-208`) with `locationIds=[locationId]` and **no `organizationId`**: the place resolves from the named location with its grant check (`energy-view.service.ts:228-235` → `report-scope.ts:123-132`), so an unreadable site is a 403 before any read and a global admin is bound to that site's explicit asset list (decision 2.5). The zone is the site's, because exactly one location is named (`energy-view.service.ts:129-132`, decision 2.8). The query shape is `energyViewQuerySchema` by identity (`packages/shared/src/contracts/energy-view.ts:27-36`); `QUERY_SCHEMAS` and the registry do not change for this sub-tab. Sections: the six KPI tiles with the change, the load profile **by source** with the previous period dashed, the top consuming assets, the day × hour heatmap and the advisory abnormal list — the `energy-page.tsx:254-381` sections, each the same component. **The site ranking section shows only when `sites.totalSites > 1`** (a parent with readable children through `expandLocationSubtrees`); on a flat site it is omitted, never a one-row table *(owner, 2026-11-02)*. The `partial` note shows as on the Energy page (ruling 4.2). Two reads per (site, range, compare), `refetchInterval` 60 s, the Energy page's own budget (`energy-page.tsx:127-141`).
   - **Enabling refactor** *(drafter choice)*. The KPI tile row (`energy-page.tsx:254-290`, inline today) moves byte for byte into `apps/web/src/components/energy/energy-kpi-tiles.tsx`, and the range select, the custom pickers and the compare toggle of `EnergyFilterBar` (`apps/web/src/components/energy-filter-bar.tsx:50-`) move into `apps/web/src/components/energy/range-compare-controls.tsx`; the filter bar and the Energy page delegate to them, so the site tab draws no second copy. The site tab builds its `EnergyViewQuery` with a pure `siteEnergyQueryOf(locationId, range)` in `apps/web/src/lib/site-trends.ts` that sets `locationIds` and never `organizationId`.
4. **One new batch route for a segment** *(owner, 2026-11-02; decision 1.8 applied)*. `GET /control-room/sites/:locationId/segment-views?segment=&point=&range=&from=&to=&compare=` on `TrendPointsModule` (`apps/api/src/trend-points/segment-views.controller.ts`, `segment-views.service.ts`, `segment-views-read.ts`, `segment-views.pure.ts`, `segment-abnormal.ts`), beside the trend strip. The strip's query (`siteTrendStripQuerySchema`, `trend-strip.ts:45-50`) is **not** widened: it is `.strict()`, its three ranges are tied to declared levels, and the `F4.305` widget reads it. Per-point `aggregate` calls from the browser are rejected: the ranking and the abnormal list need every asset of the segment, not 8.
   - **Query** (`siteSegmentViewsQuerySchema`, `.strict()`, no refinement, so the OpenAPI document expresses it whole): `segment?` (a `CATALOG_CODE_PATTERN` string; absent = the first segment present at the site), `point?` (a catalog code; absent = the first code of the segment's effective list), `range` reusing **`energyViewRangeSchema` by reference** (`energy-view.ts:19`), `from?`/`to?` (ISO instants, `custom` only), `compare?: "previous"`. Cross-field faults are a 400 from `resolveEnergyRange` (`apps/api/src/reports/energy-view-range.ts:55-74`), the energy precedent. Registry `SiteSegmentViewsController_forSite: siteSegmentViewsQuerySchema`; `QUERY_SCHEMAS` 30 → 31 (`apps/api/src/openapi/strict-body-ledger.spec.ts`); no body, so `strict-body-ledger.data.ts` and the copilot catalog are unchanged.
   - **Order of refusals** (Amendment 2 item 3): `locationId` shape (400), query (400), readable site (404 by `TrendPointsService.forSite`, the decision 3.6 rule), unknown or inactive `segment` / a `point` not in that segment's effective list (404), scope, then the two telemetry statements. `Cache-Control: no-store`.
   - **One range rule, no second copy.** The service calls the pure `resolveEnergyRange`, `previousPeriod`, `displayBucketFor` and `levelAndBucketFor` of `energy-view-range.ts:82-154` and `displayGroupExpr` of `energy-view-read.ts:99` with the **site zone** from `resolveSiteTimeZone(location, organization)` (the strip's `zone()`, `trend-strip.service.ts:134-144`). `ReportsModule` is not imported into `TrendPointsModule`. `today` and `this_month` start at site midnight; the display bucket is ≤ 3 h `1m`, ≤ 48 h `5m`, ≤ 45 d `1h`, else `1d` read as a local day over `_1h`; one `levelForRange` call with the **oldest** period's start (the fourth baseline window, item 5), so one level serves the current period, the compare period and the baseline; shown on the view with the bucket and the zone (rulings 4.3, 4.5).
   - **Series rule** (Amendment 2 item 2, unchanged): a candidate is one (asset, `point`) pair where the asset's own `domain` is `segment`, `point` is in that segment's effective list (decision 3.4) and `bms.asset_points` holds an active registration — the strip's `scopeRows` join (`trend-strip.service.ts:151-173`), site-bound, intersected with `readableAssetIds` before any telemetry read; a global admin (`null`) resolves to that explicit list; an empty scope answers the empty view and runs no `telemetry.*` statement (§5.3).
   - **Exactly two telemetry statements per request, compare or not** *(drafter choice)*. **(A) Windows:** one statement on the `entityWindowReads` shape (`apps/api/src/reports/energy-organization-reads.ts:378-`) — the windows bound as parallel arrays and `unnest`ed, `idx 0` the current period, `idx −1` the compare period when asked, `idx 1..4` the baseline windows inside the horizon — with the point code bound as a parameter (never the `'kw'` literal) and the asset list as `= ANY($n::uuid[])` with no `IS NULL OR` leg, `GROUP BY (idx, asset)`. Per row: the weighted mean (`avgExpr`, `point-aggregates.ts:121`), `max(max_value)` with its bucket time, `sum(sample_count)`, `count(DISTINCT bucket)`. From its `idx 0` and `idx −1` rows come the ranking (current and compare); from `idx 0..4` the abnormal verdicts. **(B) Series:** the top `SEGMENT_VIEW_SERIES_MAX` = 8 assets of the current ranking by mean (`MAX_WIDGET_POINTS`, the history chart's cap), pair-bound (`unnest($1::uuid[])`/`unnest($2::text[])`), the current and the compare window bound in one statement, folded into the display bucket by `displayGroupExpr`, gap-filled with `fillBucketGaps` (`point-aggregate-window.ts:525`); the compare series keeps its true timestamps and the client shifts it by `+span` (decision 1.3). The ranking table lists at most `SEGMENT_RANKING_MAX` = 50 assets (the `SITE_RANKING_MAX` precedent), the rest a count `moreAssets`, never ids. Ranked by mean, ties by asset code; a sort toggle mean | max. A change against the previous period shows only when the asset has an `idx −1` row (ruling 4.6). No site total that sums assets (ruling 4.4). **Caps trim, never 500.**
5. **A per-point abnormal list on every segment sub-tab** *(owner, 2026-11-02)*. Entities: every readable asset of the segment with an `idx 0` row for `point`. `current` = the asset's weighted mean of `point` over the current period. **Baseline** = the **median** of the asset's mean over the same `BASELINE_WINDOWS` = 4 windows as Amendment 1 item 7 — shifted back by `k × step` local days in the site zone, `step = ceil(durationHours / 24)`, wall clock and sub-minute remainder kept, windows before `now − retentionDays(level)` dropped before the read with `windowsConsulted` reported; a window **counts** when the asset's distinct bucket count in it is at least half its count in the current period; fewer than `MIN_BASELINE_WINDOWS` = 3 counting windows is `not_enough_history`. **The arithmetic** *(owner, 2026-11-02: +50 % and −50 % of the baseline)*: `ratio = current / baseline`; `above` when `ratio ≥ ABNORMAL_RATIO` (1.5), `below` when `ratio ≤ ABNORMAL_BELOW_RATIO` (0.5, new), else `normal`. Before the ratio: **`not_comparable`** when `|baseline| ≤ ABNORMAL_NEAR_ZERO_FRACTION × max(|mean of each counting window|)` with `ABNORMAL_NEAR_ZERO_FRACTION = 0.01` *(drafter choice; the baseline-only scale is the owner's, 2026-11-02 build review — the current mean is not in it, so 5, 5, 5, 5 against 600 is `above`)* — a relative floor, so no literal per unit; a point that is zero throughout is `not_comparable`, never "normal" by a 0/0 — or when `current` and `baseline` are both non-zero with opposite signs. Two negatives compare by magnitude (`−30 / −20 = 1.5` is `above`); the UI sentence says so. `normal` is counted (`normalCount`), never sent. Sent: `above` by ratio descending, `below` by ratio ascending, `not_comparable` by code, `not_enough_history` by code, cut to `ABNORMAL_LIST_MAX` = 100 with `truncated`. `BASELINE_WINDOWS`, `MIN_BASELINE_WINDOWS`, `ABNORMAL_RATIO` and `ABNORMAL_LIST_MAX` are **imported** from `packages/shared/src/contracts/energy-organization-views.ts:17-27` (one declaration); `ABNORMAL_BELOW_RATIO` and `ABNORMAL_NEAR_ZERO_FRACTION` are new, in `site-segment-views.ts`.
   - **Reuse of `F4.299`'s pure code, energy behaviour unchanged.** `apps/api/src/trend-points/segment-abnormal.ts` imports `baselineWindows`, `windowsWithinHorizon` and `medianOf` from `apps/api/src/reports/energy-abnormal.ts:76-117` as they are. The counting predicate (`energy-abnormal.ts:129`) is **extracted** into an exported `countingWindows(current, windows)` that `verdictFor` calls — a byte-equivalent refactor; `energy-abnormal.spec.ts` stands unchanged as the regression gate, and the energy list keeps its one-sided kWh rule. The two-sided `segmentVerdictFor`, `segmentAbnormalEntries` and `orderAndTrimSegment` are new and pure, in `segment-abnormal.ts`.
   - **Advisory only (ruling 4.7).** Read-only; no alarm, rule, notification or write. `tests/f4.299-abnormal-is-advisory.test.ts` is extended: its module list gains `segment-abnormal.ts`, `segment-views-read.ts` and `segment-views.service.ts`, and its reads-file check covers `segment-views-read.ts` beside the energy reads, with its positive control.
6. **Contracts** (ADR 0030, AGENTS §4.8), in `packages/shared/src/contracts/site-segment-views.ts`, types `z.infer` in `packages/shared/src/types/site-segment-views.ts`. `siteSegmentViewsSchema`: `locationId`, `timeZone`, `generatedAt`, `level`, `bucket` (`aggregateLevelSchema` by reference), `current` and `compare | null` as `{from, to, durationHours}`, `segments: [{domain, label, assetCount}]` (every segment present at the site, so the sub-tab nav comes from the one read), `segment: {domain, label, source}` (`trendPointSourceSchema` by reference), `points: [{code, name, unit}]`, `point: {code, name, unit}`, `ranking: [{assetId, assetCode, assetName, unit, current: {mean, max, maxAt, sampleCount}, compare | null, buckets | null, compareBuckets | null}]` (`pointAggregateBucketSchema` by reference; `buckets` is `null` past the series cap), `moreAssets`, `seriesCount`, `trimmed`, `abnormal: { baseline: {windows, windowsConsulted, stepDays, ratio, belowRatio, nearZeroFraction}, entries: [{assetId, assetCode, assetName, unit, currentMean, baselineMean | null, ratio | null, verdict: "above" | "below" | "not_comparable" | "not_enough_history", baselineWindows}], normalCount, truncated }`. Plain `z.object` throughout; reuse by reference only; no `.merge()`/`.extend()`/`.omit()`, no `z.intersection`, no `.readonly()`.
7. **The click.** An asset in the ranking, the abnormal list or the chart legend opens `assetHistoryPath(assetId)` (`apps/web/src/lib/asset-history-range.ts:26`) with `?from=<current.from>&to=<current.to>&points=<code>` and `&compare=1` when compare is on — the exact window, which `rangeFromSearch` reads. The trend-strip widgets on the Site view are unchanged.
8. **Where it mounts and what it does not touch.** `site-page.tsx` gains the third nav entry and one branch (`onTrendsTab ? <SiteTrendsView …/>`) beside the assets branch; `SiteTrendsView` (`apps/web/src/components/control-room/site-trends-view.tsx`) owns the sub-tab nav (`?view=energy|<domain>` and `&point=` in the search, so a link holds the selection — ids and codes only), `SiteEnergyView` and `SegmentView` (with `segment-trend-chart.tsx`, `segment-ranking-table.tsx`, `segment-abnormal-list.tsx`), the api client `apps/web/src/api/segment-views.ts` and the pure `apps/web/src/lib/site-trends.ts`. The live tiles, the mimic, the SLD, the strip, `SmocSiteView`, `SiteDashboardView` and `GeneratedSiteView` do not change. A rejected resolve read still shows the not-available card and reads nothing (the `F3.72` rule). Every error state renders a fixed sentence, never `error.message` (`tests/f4.204-raw-error-message-render.test.ts`). One request per (site, segment, point, range, compare), `refetchInterval` 60 s.
9. **Not on the wall** *(owner, 2026-11-02)*. `?wall=1` rotates a dashboard's tabs (`site-page.tsx:151-172`); the section is a page, not a widget, and is excluded as the assets section is.
10. **Anti-goal guard (§5.4).** `tests/adr-0108-no-org-or-segment-literals.test.ts` scans every new runtime module of this amendment (the shared contract and type, the five api modules, the web client, `site-trends.ts`, the six control-room components and the two shared energy components); each moves from `PENDING_MODULES` to `MODULES` in the commit that creates it. Not scanned, with the reason: `site-page.tsx` pre-dates this record and gains one nav entry and one branch; migration `0119` names two reserved route segments, not catalog segments. `segment-views-read.ts` joins `tests/repo-invariants.test.ts`'s `rollupFiles`.

**Verification owed by this amendment.** Cross-tenant: an asset-group-scoped caller's segment view ranks, draws and judges no asset outside its groups (beside a positive case) and gets a 404 for a foreign site, with no `telemetry.*` statement in either case; a global admin's two statements bind the explicit site list, never `null`; an empty scope runs no statement (paired with a positive case); exactly two telemetry statements per request, with and without compare, the point code bound as a parameter; on the Energy sub-tab an unreadable site is a 403 before any read, and a parent with unreadable children gives `partial` counts and no unreadable name. Segment: a per-run `asset_domains` row listed through an organization override appears as its own sub-tab at the read; a seeded `ups` asset appears under `ups` only; a segment whose list draws nothing shows the fixed sentence. Range and zone: `today` starts at the site's local midnight in `Asia/Kolkata`; a `1d` bucket is a local day; the compare period ends 1 ms before the current start and its buckets shift by `+span`; a 46-day custom range prints `1h rollup · 1 day buckets · <zone>`; the level is chosen once from the fourth baseline window's start. Statistic: the ranking mean is the weighted mean; `max` is `max(max_value)` with its bucket time; ties order by code. Abnormal: ratio 1.5 → `above`, 1.49 → `normal`, 0.5 → `below`, 0.51 → `normal`; a baseline within 1 % of the largest counting-window magnitude → `not_comparable`; counting windows 5, 5, 5, 5 against a current 600 → `above`; `+5` against `−5` → `not_comparable`; `−30` against `−20` → `above`; an all-zero point → `not_comparable`; 2 counting windows → `not_enough_history`; 101 entries cut to 100 with `truncated`; `energy-abnormal.spec.ts` passes unchanged after the `countingWindows` extraction, and a mutation of the extracted predicate reddens both the energy and the segment spec. Advisory: the extended guard reddens on an injected alarms import and an injected `INSERT`. Bounds: 60 candidate assets rank 50 with `moreAssets` 10, draw 8 series with `trimmed`, never a 500. Reserved key: `dashboardTabKeySchema` refuses `trends` and `assets`; on a scratch database migration `0119` refuses an insert with `tab_key = 'trends'`, renames a pre-existing `trends` row, and a cold start applies it. Site page: `/trends` renders for a generated, a dashboard and the built-in SMOC site; it is exempt from the D5 redirect; `?wall=1` on `/trends` renders the normal page; the **Wall** link omits the segment. The §5.4 guard reddens on an injected `if (segment === "hvac")`; the Nest wiring spec proves the new controller and service resolve inside `TrendPointsModule`. `EXPLAIN (ANALYZE)` figures for the two statements at 30 d and 1 y on the compose stack.

**Consequences.** Migration `0119`, journal `idx` 120 (the `dashboard_tabs` CHECK only; no new table, grant, RLS change, dependency or continuous aggregate). `RESERVED_DASHBOARD_TAB_KEYS` 1 → 2; `QUERY_SCHEMAS` 30 → 31; the registry gains `SiteSegmentViewsController_forSite`; `rollupFiles` grows by one; `energy-abnormal.ts` exports `countingWindows` (behaviour unchanged); the advisory guard scans three more modules; the Energy page's KPI row and the filter bar's range controls become shared components; `TrendPointsModule` provides two more classes; the PR carries the `e2e` label. The segment abnormal verdict is two-sided; the energy abnormal verdict stays one-sided (Amendment 1 item 7), and the two are never merged into one rule. `F4.303` later adds its actions to this view through the same response.

**Owner rulings 2026-11-02 (build review).**

- **A — baseline-only scale.** The near-zero floor's scale is the largest counting-window magnitude; the current mean is not in it (item 5).
- **B — reserve `energy`.** The Energy sub-tab is `?view=energy`, so no `asset_domains` code may be `energy`; a gate holds it, the URL does not change.
- **C — a forward migration.** Migration `0120` (journal `idx` 121): a widget whose `config->>'tabKey'` is `trends` on a dashboard whose `trends` tab `0119` renamed (key exactly `'trends-' || left(id::text, 8)`) moves to the renamed key; a second run is a no-op.

### Amendment 5 — `F4.304` floor area and kWh per m²

**Status: Drafted 2026-11-02; the owner answered its questions in chat the same day, one at a time (Status).** Drafted before any implementation code, from the row (`docs/BACKLOG.md`, `F4.304`) and the design (`docs/plans/2026-10-31-energy-and-trend-views-design.md`, the site ranking of goal 2). Code citations are to `main` at `d820d560`. A line marked *(owner, 2026-11-02)* is a ruling; the others are drafter calls the plan may refine. The view actions stay `F4.303`'s.

1. **One nullable column** *(owner, 2026-11-02: Q1)*. **Migration `0121`** (`0121_location_floor_area.sql`, journal `idx` 122; `0120_widget_tab_key_trends` is `idx` 121, the last entry): `ALTER TABLE bms.locations ADD COLUMN IF NOT EXISTS floor_area_m2 numeric(12,2)`, then `DROP CONSTRAINT IF EXISTS` / `ADD CONSTRAINT locations_floor_area_m2_check CHECK (floor_area_m2 > 0 AND floor_area_m2 <> 'NaN'::numeric)`. `NULL` is "no area" and passes the CHECK. **Why the `NaN` leg** *(drafter choice)*: Postgres sorts `NaN` above every `numeric`, so `NaN > 0` is true and a bare `> 0` admits it — the `0064` lesson for `float8`, which holds for `numeric` too; the declared precision refuses `±Infinity` (numeric field overflow), which the integration test measures rather than assumes. **Precision** *(drafter choice)*: `numeric(12,2)` — 0.01 m² resolution, up to 9 999 999 999.99 m²; Postgres rounds the written value half away from zero on assignment, so a converted area is stored to 2 places by the database, never by a float `Math.round`. The column is nullable with no default, so the `ALTER` rewrites no row. Drizzle: `floorAreaM2: numeric("floor_area_m2", { precision: 12, scale: 2 })` beside `timezone` (`packages/db/src/schema/bms-schema.ts:126`). It is the schema's first `numeric` column and drizzle `0.38.4` has no number mode, so it reads as a string: `mapRow` turns it into `Number(…)` and raw SQL reads it as `l.floor_area_m2::float8`. **No grant, policy or trigger changes**: `bms.locations` is granted per table (`0039:49` and the default privileges), so the new column is covered; only `bms.users` is granted per column (`0098`); `tenant_isolation` filters rows and does not change; `locations_tree_guard` fires on `UPDATE OF parent_id, active, organization_id` (`0103:204-206`), so an update of the area alone does not run it. No seed writes the column, and every seed `INSERT` names its columns (`eskom-locations-seed.ts:518`, `phe-pilot-seed.ts:325`, `demo-ion-exchange.ts:180`, `access-fixtures-seed.ts:133`), so a re-seed keeps an area an administrator set.
2. **Whose area** *(owner, 2026-11-02: Q2)*. Any location may carry an area, whatever its type or depth. A ranked site uses **its own** `floor_area_m2` only; no code sums the areas of its children, and no code reads an ancestor's area for a child. A site with no area is "no area", never a zero and never a rank.
3. **The write contract: one nested object, the same in admin and onboarding** *(drafter choice; Q5 and Q7 are the owner's)*. In `packages/shared/src/contracts/location-writes.ts`: `floorAreaUnitSchema = z.enum(["m2", "ft2"])`, `FT2_TO_M2 = 0.09290304` (exact: the international foot is 0.3048 m, and 0.3048² = 0.09290304), `FLOOR_AREA_VALUE_MIN = 1`, `FLOOR_AREA_VALUE_MAX = 100_000_000` *(owner, 2026-11-02: in the typed unit)*, and `floorAreaInputSchema = z.object({ value: z.number().finite().min(FLOOR_AREA_VALUE_MIN).max(FLOOR_AREA_VALUE_MAX), unit: floorAreaUnitSchema.default("m2") }).strict()`. `createLocationBodySchema` gains `floorArea: floorAreaInputSchema.nullable().optional()` — absent leaves the stored area, `null` clears it, an object sets it (the `timezone` convention, `location-writes.ts:29-31`); `updateLocationBodySchema` inherits it through its existing `.omit().partial()`. One pure `floorAreaM2Of({ value, unit })` in the same file returns `value` for `m2` and `value × FT2_TO_M2` for `ft2`, unrounded; the admin service, the onboarding commit and the web form's "= N m²" hint call it, so the conversion has one declaration (AGENTS §4.8). **Why nested, not `floorAreaM2` plus a unit field:** a value and its unit travel together, so the body has no cross-field rule. Two sibling fields would need a refinement ("a unit without a value"), and a refinement breaks `.omit().partial()` (`location-writes.ts:44-46`) and the copilot catalog's plain-object rule (`model-body.ts`). The bounds are on the typed value in either unit: 1 ft² stores as 0.09 m², which passes the CHECK, and 10⁸ m² fits the precision, so no valid body reaches a `23514`. A `23514` from a direct writer is not translated.
4. **The admin route and form** *(owner, 2026-11-02: Q5)*. `LocationsAdminService.create` writes `floorAreaM2: body.floorArea ? String(floorAreaM2Of(body.floorArea)) : null` (`locations.service.ts:194-211`); `update` writes it only when `floorArea` is in the body (`:316-334`, the `timezone` shape at `:327`). **`adminLocationDtoSchema` gains `floorAreaM2: z.number().nullable()`** (`packages/shared/src/contracts/admin.ts:29-50`), always in m², and `mapRow` sets it (`locations.service.ts:576-607`); `locationsListResponseSchema` follows by reference. The master-data audit records the body as sent (value and unit) and the row after (m²). The web location wizard (`apps/web/src/components/admin/location-wizards.tsx`) gains, on its **Place** step, one number input and a unit select (`m²` | `ft²`, default `m²`); `placeValues` (`:91-99`) sends `floorArea: null` for an empty input and `{ value, unit }` otherwise; `locationFormOf` loads `{ value: floorAreaM2, unit: "m2" }`, so an unchanged edit sends the stored m² and writes the same value; the unit select states the unit of the typed number and never converts it; under the input a hint shows `= N m²` (2 places) when the unit is `ft²`; `locationFormWithValues` (`:145-160`) reads a copilot fill's `floorArea`; the edit wizard's `current` (`:366-378`) shows the stored area as `{ value, unit: "m2" }`. **The locations list gains an "Area (m²)" column** *(owner, 2026-11-02)*, "—" when a location has none, read from `floorAreaM2`.
5. **The copilot catalog** *(drafter choice)*. `location.create` and `location.update` read their body schemas by reference (`packages/shared/src/copilot/catalog/locations.ts:32`, `:53`), so they gain `floorArea` with no new entry; the shared `PLACE` step (`:7`) lists it, which `everyBodyFieldIsInExactlyOneStep` (`catalog.spec.ts`, `stepProblems`) requires. The catalog's entry count does not change. The copilot read tool `list_locations` does not gain the area.
6. **Onboarding** *(owner, 2026-11-02: Q6, Q7)*. The draft location carries `floorArea` with the same shape — a value and a unit, default `m2` — and the commit stores m².
   - **Draft schemas.** `onboardingDraftLocationSchema` (`packages/shared/src/contracts/onboarding.ts:213-238`, the lenient copy) gains `floorArea: z.object({ value: z.number(), unit: floorAreaUnitSchema.default("m2") }).nullable().optional()`; `draftLocationSchema` (`apps/api/src/admin/onboarding/onboarding.schema.ts:57-95`, the bounded copy) gains `floorArea: floorAreaInputSchema.nullable().optional()` by reference. So `OnboardingValidateService` reports a value out of bounds as a field error at `location.floorArea.value`, as it does for `latitude`, and `readyToCommit` stays false until the value is fixed.
   - **Workbook.** `LOCATION_HEADERS` (`onboarding-excel.service.ts:197-207`) gains two **trailing** columns after `parent_code`: `floor_area` and `floor_area_unit`. The parser reads each cell by header name, so a workbook built before `F4.304` still reads. An empty `floor_area` cell or a missing column gives `floorArea: null`. Otherwise the cell must be a plain decimal literal; anything else refuses the upload with `LOCATION row 1 has a floor_area that is not a number`, which names the column and never echoes the cell (§4.3). A bound fault is left to validate's field error. `floor_area_unit` is trimmed and lower-cased, and an empty cell is `m2`; a value other than `m2` or `ft2` refuses the upload, names the two codes and never echoes the cell (the `type` precedent, `:500-512`). The template's example row (`:245`) gains `"1200", "m2"`.
   - **Derive and commit.** `deriveLocationPatch` (`onboarding-location-derive.ts:50-56`) carries `stored?.floorArea` over like `province` and `parentCode`, so a rename keeps the area. The commit's location insert (`onboarding-commit.service.ts:421-438`) writes `floorAreaM2: loc.floorArea ? String(floorAreaM2Of(loc.floorArea)) : null`.
   - **Agent tools (ADR 0090 contracts).** `set_location`'s argument schema is `draftLocationSchema.partial().required({ name: true })` (`onboarding-agent-tools.ts:262`), so it gains `floorArea` with no new tool. Its description (`:302-304`) gains one sentence: "`floorArea` is `{ value, unit }` with unit `m2` or `ft2` (default `m2`); the commit stores square metres; `null` clears it." **The registry stays at 31 tools**, and no ADR 0090/0091/0095 count changes. `find_existing`'s location rows do not gain the area, so ADR 0095 decision 3's key list does not change. The rule-based branch writes no area.
   - The web onboarding drawer shows no location field today, so it does not change.
7. **The ranking** *(owner, 2026-11-02: Q3, Q4)*. kWh per m² = the site's kWh **in the selected range** ÷ its own `floor_area_m2`, not annualised; a `today` view gives a small figure, and a `1y` view an annual one.
   - **Computed on the server, from the same kWh** *(drafter choice)*. `siteEnergyRead`'s final `SELECT` (`apps/api/src/reports/energy-organization-reads.ts:140-152`) adds `l.floor_area_m2::float8 AS floor_area_m2` from the `bms.locations` row it already joins (no new statement, join or bound parameter). `EnergyOrganizationViewsService.sites` (`energy-organization-views.service.ts:171-196`) sets, per row, `floorAreaM2` and `kwhPerM2 = kwhPerSquareMetre(kwh, floorAreaM2)`. That is one pure function in `packages/shared/src/contracts/energy-organization-views.ts`: `null` when the area is `null`, else `kwh / area`. It runs on the unrounded kWh, and the service rounds the result to 3 places. **Why not in the browser:** the browser has only the rounded kWh, and a division in the web would be a second copy of the rule for the tile (item 8). This way the table and the tile read one figure. The compare rows use the stored area as well, because the area has no history. Their kWh per m² change therefore equals the kWh change, and the table shows that one change.
   - **Contract.** `energySiteEnergySchema` (`energy-organization-views.ts:30-37`) gains `floorAreaM2: z.number().nullable()` and `kwhPerM2: z.number().nullable()`. `energyViewQuerySchema` does not change, and no route is added: **`QUERY_SCHEMAS` stays at 31** and the registry does not change.
   - **The control.** `SiteRankingTable`'s `SORTS` (`apps/web/src/components/energy/site-ranking-table.tsx:15-18`) gains `{ key: "kwhPerM2", label: "kWh per m²" }`, and `SiteRankingSort` (`apps/web/src/lib/energy-organization-views.ts:27`) widens. The one component serves the Energy page and the site sub-tab, so both gain it. The existing Peak kW option stays. In that mode, `rankingRows` orders the rows that have an area by `kwhPerM2` descending, with ties by name and then by `locationId`. A measured zero is a real zero and is ranked. **The rows with no area follow, after every ranked row**, in the server's kWh order. Their kWh per m² cell reads "no area". They get no position and are never sorted as a zero. The column shows 2 places and "< 0.01" below that. In the kWh and Peak kW modes the rows do not change.
   - **The cut.** The server sends the top `SITE_RANKING_MAX` (50) sites **by kWh**, and the kWh per m² mode orders those rows only. This is the same as the Peak kW mode today. When `totalSites > SITE_RANKING_MAX`, the table says "Among the top 50 sites by kWh" in this mode. A server-side second cut by intensity is not part of this amendment *(owner, 2026-11-02)*.
8. **The site Energy tile** *(owner, 2026-11-02: Q3)*. `energyViewSchema` (`packages/shared/src/contracts/energy-view.ts:70-86`) gains `floorArea: z.object({ locationId: z.string().uuid(), floorAreaM2: z.number().nullable() }).nullable()`. It is non-null only when `locationIds` names **exactly one** location, which is the site tab's query (`siteEnergyQueryOf`). `energyViewPeriodSchema` (`:39-57`) gains `kwhPerM2: z.number().nullable()`, which is `kwhPerSquareMetre(ownKwh, floorAreaM2)` on the unrounded kWh of **the named site's own assets** *(owner, 2026-11-02)* — the figure of that site's row in the `F4.299` ranking, so the tile and the row never disagree; when the site has no readable children (`totalSites` 1) it is the view's Total energy. It is `null` when no single location with an area is named, and also when the period has no `kw` data. The area comes from the read that already resolves the named location's zone: `locationZone` (`energy-view.service.ts:258-264`) becomes `namedLocation` and selects `timezone` and `floor_area_m2` in its one statement, so the frame does not gain a statement. `EnergyKpiTiles` gains an optional `floorAreaTile` prop. `SiteEnergyView` passes it, and the Energy page does not, so the Energy page keeps its six tiles. The seventh tile has the label "kWh per m²" and the unit "kWh/m²". Its value is `current.kwhPerM2`. The hint is the change against the previous period from `changeFor(…, "kwhPerM2")`, whose `key` union (`apps/web/src/lib/energy-view-filter.ts:58-62`) widens. The empty states have a fixed order. When `floorArea.floorAreaM2` is `null`, the tile shows **"No area"** with the hint "Set the floor area in Admin → Locations". Else, when `current.hasData` is false, it shows the shared "No kW data in this period". **The figure divides the site's own kWh, not the view's Total energy** *(owner, 2026-11-02)*: the area is the site's own (item 2), so the energy is too. For a site with readable children (`sites.totalSites > 1`) the two differ, and the hint then reads "This site's own assets ÷ its floor area". How the frame obtains the own-asset kWh without a new statement (the `F4.299` site read already groups by site) is the plan's call.
9. **Not changed.** The abnormal list, the heatmap, the trend, the segment views, the map (`map.service.ts` selects named columns and needs no area), `/auth/me`, the energy preview and its exports, and `report-scope.ts`.
10. **Anti-goal guard (§5.4).** Every runtime module this amendment edits on the energy side is already in `MODULES` of `tests/adr-0108-no-org-or-segment-literals.test.ts`: the two energy contracts and their types, `energy-organization-reads.ts`, `energy-organization-views.service.ts`, `energy-view.service.ts`, `energy-organization-views.ts` (web lib), `energy-view-filter.ts`, `site-ranking-table.tsx`, `energy-kpi-tiles.tsx`, `site-energy-view.tsx` and `energy-page.tsx`. A new module that the plan adds on the energy path joins `MODULES` in the commit that creates it. The location and onboarding modules are not scanned, because they name no segment or organization in order to decide a view. Migration `0121` names no catalog segment.

**Verification owed by this amendment.** Migration (a scratch database, the `0119` precedent): `0121` applies on a cold start, and a second run is a no-op. The CHECK refuses `0`, `-1`, `'NaN'` and `'Infinity'` (measured), and accepts `NULL` and `0.01`. A write of `92.90304` reads back `92.90`. As `bms_tenant`, an update of `floor_area_m2` in a foreign organization changes 0 rows, beside a positive same-organization case. A text test pins journal `idx` 122, the tag, and that the drizzle column mirrors the SQL type. Admin contract: create with `{ value: 1000, unit: "ft2" }` stores and returns `92.90`; `{ value: 120 }` stores `120.00` (default `m2`); `floorArea: null` clears; an absent `floorArea` on update keeps the stored value; `value` 0, 0.5, 100 000 001, `NaN`, a string, a unit `sqft` and an extra key are each a 400; `adminLocationDtoSchema` parses a row with and without an area. The pure `floorAreaM2Of` and `kwhPerSquareMetre` have unit tests: the exact constant, `null` area → `null`, zero kWh → `0`. Catalog: `everyBodyFieldIsInExactlyOneStep` reddens when `floorArea` is removed from `PLACE`. Strict-body ledger (`apps/api/src/testing/strict-body-ledger.data.ts`): the walker reports the new object nodes, which are recorded as `createLocationBodySchema/floorArea` and `updateLocationBodySchema/floorArea` with `STRICT(CALLER_ERROR)`, and `patchDraftBodySchema/draft/location/floorArea` with `{ strict: false, because: THREE_PRODUCERS }`. Its parent is open for that reason, so the child is open on the same terms. Onboarding: an Excel round trip — the generated template, parsed, gives `floorArea { value: 1200, unit: "m2" }`; a workbook with no area columns parses with `floorArea: null`; an `ft2` row commits `bms.locations.floor_area_m2` in m²; a non-numeric `floor_area` cell and an unknown unit each refuse without echoing the cell; `onboarding-excel-location-parent.spec.ts:49` (which asserts `parent_code` is the last header) is updated to the new trailing pair. `set_location` with `floorArea` writes it, and a rename keeps it. A value out of bounds is a `location.floorArea.value` field error. The tool registry length stays 31. Ranking: a recording pool shows that `siteEnergyRead` binds the same parameters as before and returns `floor_area_m2`. With three sites (area 100 at 500 kWh, area 50 at 400 kWh, no area at 900 kWh), the kWh per m² mode orders 8.0, 5.0, then "no area", and the no-area site is never first or a zero. Ties order by name. A zero-kWh site with an area ranks as `0`. No sum of the child areas: a parent with an area and two children with areas uses the parent's own. Tile: no area → "No area"; area and no kW → "No kW data in this period"; area 200 with 1 000 kWh → `5.00`; a parent site with an area and a child site uses only the parent's own-asset kWh, equal to its ranking row; with compare, the change hint is present; the Energy page renders six tiles, and the site tab seven. §5.4: the guard stays green, and it reddens on an injected `if (organizationCode === "ESKOM")` in `energy-organization-reads.ts`. Step 6 layers: the compose stack is rebuilt with `--no-cache` and `0121` is migrated. With `curl`, a PATCH with `ft2` gives a GET in m², and `GET /reports/energy/organization-views` carries `floorAreaM2` and `kwhPerM2`. In the browser (the `browser-verifier` agent): the Locations edit wizard sets an area in ft², and after a hard reload it shows the m² value; on the Energy page, "Rank by: kWh per m²" lists "no area" last; the site Energy sub-tab shows "No area" on a site with no area and a figure on a site with one; an onboarding workbook with an area commits it. No `EXPLAIN` is owed: the read adds one column of a row that it already joins.

**Consequences.** Migration `0121`, journal `idx` 122: one nullable `numeric(12,2)` column and one CHECK on `bms.locations`. There is no new table, grant, policy, trigger, dependency or continuous aggregate. It is the schema's first `numeric` column, which reads as a string in drizzle and as `::float8` in raw SQL. `adminLocationDtoSchema`, `energySiteEnergySchema`, `energyViewSchema` and `energyViewPeriodSchema` gain fields. The two location write bodies, the two draft location schemas and so the `set_location` tool gain `floorArea`. `QUERY_SCHEMAS` stays at 31, the onboarding tool registry stays at 31, and the copilot catalog's entry count does not change. The strict-body ledger gains three node entries. The Excel `LOCATION` header gains two trailing columns. `SiteRankingSort` gains `kwhPerM2`. The site Energy sub-tab shows seven tiles, and the Energy page six. The area has no history, so a past range is divided by today's area. The PR carries the `e2e` label because the Locations wizard (a master-data page) changes.

## Dependencies

No new package. One migration (`0117`), journal `idx` 118.

## Consequences

- `pointAggregateQuerySchema`, the new `pointRawQuerySchema` and
  `atInstantIsInRange` (with its two constants) move to
  `packages/shared/src/contracts/telemetry-queries.ts` (decision 1.2, the
  `F4.280` precedent); the response schemas change in `envelopes.ts`.
  `pointAggregateQuerySchema` becomes a `ZodEffects`; its registry key and its
  `QUERY_SCHEMAS` entry stay, and only their imports in `openapi-registry.ts`
  and `strict-body-ledger.spec.ts` move to `@bms/shared`.
  `tests/adr-0029-openapi-contract.test.ts` adds the new shared file to its
  list. Two query schemas join `QUERY_SCHEMAS`
  (`apps/api/src/openapi/strict-body-ledger.spec.ts`): `pointRawQuerySchema`
  (`F4.297`, count 27 -> 28) and `energyViewQuerySchema` (`F4.298`, one more,
  on whichever count is current when it merges). One body schema joins the ledger in
  `apps/api/src/testing/strict-body-ledger.data.ts`:
  `putOrgTrendPointsBodySchema`. The registry gains
  `TelemetryController_raw`, `ReportsController_energyView` and
  `OrgTrendPointsAdminController_putSegment`.
- `windowBounds` keeps its signature as a wrapper over the new
  `windowBoundsFor`, so `asset-health.service.ts:238` does not change.
  `TelemetryService.pointAggregate` changes signature, so its callers
  (`telemetry.controller.ts` and the copilot `get-point-aggregate.tool.ts`)
  change.
- `1h` and finer buckets stay UTC-aligned (decision 2.12). With `to = now`,
  the last bucket is partial and is shown as is. No rollup level or retention
  changes (ADR 0023 stands).
- The energy view reads `_1m` / `_5m` for a range up to 48 h, a recorded
  departure from ADR 0025 for this route only (decision 2.4).
- `F4.298` moves the top-consumers SQL, extracts `nominalSourceSplit` and
  deletes `apps/web/src/api/energy-dashboard.ts` (decision 2.10).
- Summing `kw` over every asset can count an incomer and its feeders twice.
  This is existing behaviour, and the compare and organization totals inherit
  it.
- Solar detection by `PV*` code in `source-mix` stays as it is. It is a known
  case of a per-segment rule in code and is not extended.
- `FORCED_TABLES` grows by one. A new FORCE-RLS table needs the cold-start
  replay of `roles`, `migrate` and `seed`.
- `/recent` keeps its 500 on a malformed ref. That fix is outside this record.

## Alternatives

- **One ADR per row.** Rejected by the owner: one record, amended as rows
  start.
- **Extend the trailing dashboard energy routes.** Rejected: their `now()`
  bound cannot express a custom or past range.
- **Two calls and a difference in the UI for compare.** Rejected by the owner
  (decision 4.1).
- **Add `deviceTime` and a cursor to `/recent`.** Rejected: it changes a route
  the dashboard depends on, and its 7-day window string does not fit a cursor.
- **A trend flag on `template_points`.** Rejected: published template versions
  are immutable and per version, so an organization cannot edit the list.
- **Per `(organization, point_key)` add/remove deltas on the default.**
  Rejected for replace-all per `(organization, domain)`, which has one rule to
  resolve and one list to show.
- **A separate segment vocabulary.** Rejected for `asset_domains.code`, which
  already has a foreign key from `assets`, `asset_templates` and
  `asset_groups`.
- **Widen `GET /reports/energy/preview`** with `organizationId`, `from`/`to`,
  `period` and `compare`. Rejected: its query schema is shared by four routes,
  the copilot tool and the save body, and its summary schema feeds the
  exports. A sibling route changes none of them (decision 2.1).
- **Widen `/auth/me` for the filter tree.** Rejected for
  `GET /reports/energy/filter-options`: `AccessLocation` carries no
  `organizationId`, and the session payload is not the place for a page's
  options (decision 2.7).
- **Keep `pointAggregateQuerySchema` in `apps/api`.** Rejected: the new
  `pointRawQuerySchema` and its limit constants are read by the web client and
  the API, and the two query schemas share `atInstantIsInRange`, so they live
  together in one shared file (AGENTS §4.8, one declaration). The
  `F4.280` `energyReportQuerySchema` is the precedent for a query schema in
  `@bms/shared` (decision 1.2).
- **`trend_default boolean NOT NULL DEFAULT false`.** Rejected: it cannot tell
  an admin's `false` from "never set", so a re-seed reverts the admin
  (decision 3.1).
- **A `trend_rank` column.** Rejected: `headline_rank` already orders the
  catalog default, and an organization list has its own `sort_order`.
- **`ON DELETE CASCADE` on `point_key`.** Rejected: both target vocabularies
  are retire-only, so a delete must fail loudly, not empty a list.
- **Index alignment of compare buckets.** Rejected for true timestamps shifted
  by `+span` (decision 1.3).

## Verification owed

- Cross-tenant tests: a scoped user gets 403 for a foreign ref on `aggregate`
  with `from`/`to`, and on the raw route; a foreign `organizationId` on
  `GET /reports/energy/view` is a 403; a `locationIds` of another
  organization that the caller cannot read is a 403, also when an
  `organizationId` is given (decision 2.2 order), and readable locations of
  another organization than the given `organizationId` are a 400; no
  `telemetry.*` statement runs in any of these cases;
  `GET /reports/energy/filter-options`
  lists only the caller's readable organizations and locations.
- UUID guard tests: a non-UUID asset id in the ref is a 400, not a 500, for a
  global admin (`readableAssetIds === null`) on both `aggregate` and `raw`.
- Asset-bound tests for the energy reads: an empty asset list reads nothing,
  not the whole fleet; a global admin's read is bound to the named
  organization's explicit asset list; `energyPeriodRead`, `averagePf` and
  `viewTopConsumers` each leave out an asset outside the list (each with an
  adjacent positive case); a recording pool shows that `viewTopConsumers`
  binds `$4` to the scope's list, never `null`, and that the two new
  statements carry no `IS NULL OR`. The `partial` response carries counts
  only, never an unreadable id.
- A test that pins `bms.org_trend_points` to `FORCED_TABLES`, and an RLS
  integration test for `tenant_isolation`.
- A trigger test: a `bms_tenant` insert with `trend_default = true` fails with
  42501, the same insert with `trend_default = false` fails with 42501, and
  the same insert with `NULL` succeeds. A seed test: an admin's
  `false` survives `seedPointKeyTrendDefaults`, and a `NULL` code in the list
  becomes `true`.
- Contract tests: a response from before this change (a `compare` object with
  no `buckets`, and buckets with only `{t, v}`) still parses; a response with
  `compare.buckets` and `bucketStats` fields parses.
- An integration test that `bucketStats` returns the weighted mean (samples
  1, 1, 1, 4 in one minute: `average` 1.75) with `min`, `max` and
  `sampleCount`, and that compare buckets carry the preceding period's true
  timestamps.
- A test that the escalation case of decision 1.4 returns the escalated
  `bucketSeconds`.
- Timezone tests: `today` in `Asia/Kolkata` and `this_month` across a DST
  change in `America/New_York`; a stored `UTC` resolves through `Etc/UTC`
  and the response returns `timeZone: "UTC"`; a view over several locations
  uses the organization's zone; a stored location zone that fails
  `isValidTimeZone` falls to the organization's, an invalid organization zone
  falls to `Etc/UTC`, and neither is a 500 (decision 2.8); the `aggregate`
  response carries the asset's location zone, else its organization's
  (decision 1.9).
- A parity test: over one UTC day, the energy view's `totalKwh` and
  `topConsumers` equal the preview's for the same assets.
- The static guard of decision 5.4 (landed by the first of `F4.297`,
  `F4.298`, `F4.300` to merge, extended by the others), with its positive
  control.
- A cold start on a scratch database with migration `0117`.
