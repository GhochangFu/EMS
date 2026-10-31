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

1. **Route** *(drafter choice)*. A web page `/assets/:assetId/history` inside
   the app shell, with the same `accessToken && user` guard as the other
   routes. The Assets list (`AssetDetailPanel`), the Control Room asset tile
   (`generated-site-asset-card.tsx`) and the alarm detail link to it. The page
   shows every point of the asset: one chart and one bucket table over a range
   with compare, and a table of the latest raw records.
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
   UPS and battery read as `electrical` until an organization's data adds a
   domain for them.
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
