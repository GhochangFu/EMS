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
