# Energy filters and trend views — design (2026-10-31)

Backlog rows: `F4.297` (asset history), `F4.298`–`F4.304`. Owner brainstorm of
2026-10-31; the layouts were approved on a mockup in the same session. Every row
is ⬜ and passes the §10 scope gate before any build.

## Intent

Users can see live values and the last poll, but not how a value moved. The
stored rollups (`point_values_1m` / `_5m` kept 735 days, `_1h` / `_1d` kept
indefinitely, ADR 0023) are read in the UI by one dashboard widget that an admin
builds point by point. The owner wants the history visible where people already
work — the Energy page and the Control Room — filtered by organization and
location, over every rollup period, for every segment the catalog serves.

## Who it serves (owner: "all of these")

- **Control room operator** — is this value abnormal now, against the last hours
  or days.
- **Site / energy manager** — totals, peaks, week-on-week and month-on-month for
  a site or an organization.
- **Org management / client** — which site uses most, how the total moves over
  months or a year.

## Goals

1. **Energy page filter** (`F4.298`): organization, then one or more locations
   from that organization's tree; a parent includes its children (the
   `LocationAssetScopeService` rule, F4.291). Ranges: Today, 24 h, 7 d, 30 d,
   This month, 1 y, and a custom from/to. **Compare with the previous period**
   of equal length. The rollup level is chosen by the server from the range.
2. **Organization views** (`F4.299`), all four selected by the owner: site
   ranking (kWh and peak kW; kWh per m² is `F4.304`, because no location has an
   area today), org total
   trend stacked by site or by source, a day × hour heatmap calendar, and a peak
   and abnormal list.
3. **Catalog trend points** (`F4.300`): the point catalog / asset template marks
   the key trend points of each segment; an org admin can change the list for
   the organization. No segment is hard-coded.
4. **Control Room trend strip** (`F4.301`) on each site tab (Overview,
   Electrical, HVAC, SLD), for that tab's catalog trend points, with 24 h / 7 d /
   30 d.
5. **Control Room Trends tab** (`F4.302`) per site: the F4.298/F4.299 views
   locked to that site, and the same views for every segment — HVAC/CRAC,
   UPS/battery, water treatment, environment, and any segment the catalog adds.
6. **Asset history** (`F4.297`): every point of one asset, a chart and a bucket
   table over a range with compare, **and a table of the latest raw records**
   (time, device time, value, unit — the columns `telemetry.point_values`
   stores; there is no quality column, and raw rows are kept 2 years, `F4.2`).
   Reached by clicking an asset in the Control Room, the Assets list or an
   alarm.
7. **View actions** (`F4.303`), on every view above: export CSV/XLSX, pin to a
   dashboard (as a `chart` widget with the same points, range and rollup), share
   a link (filters and range in the URL), schedule as a report (the F3.5b
   schedule path, through one new generic trend report template so every
   segment can be scheduled — owner ruling after the builder check).

## Non-goals

- No new rollup levels or retention change (ADR 0023 stands).
- No forecasting (`E1.4`) and no ML anomaly model; "abnormal" in goal 2 is a
  rule-free statistical comparison against the asset's own history, defined in
  the `F4.299` plan.
- No change to the live Control Room tiles, mimic or SLD.

## Anti-goals (a failure even if it works)

- **Anything per organization in code.** Every view reads the organization, its
  location tree and the point catalog. A new organization onboarded into
  IONSiTE NEXUS gets every view with no code change and no required setup; the
  org-admin trend-point edit is optional and only narrows or widens the defaults.
- **Anything per segment in code.** A segment the catalog gains later shows up
  in the Trends tab and the strip without a release.
- A cross-tenant read. `telemetry.*` has no Row Level Security; every read
  checks access (`readableAssetIds` / `canReadAsset`) **before** it reads.
- A screen that silently mixes rollup levels or hides the level it used. The
  level is shown on every chart.

## Constraints

- Contracts are Zod in `packages/shared/src/contracts/` (ADR 0030).
- The energy report contract already carries `organizationId` and
  `locationIds` (`reports.ts`); the energy preview accepts `locationIds`
  (F4.290). A custom `from`/`to` and a compare period are not yet in every
  contract — the plan says which.
- `MAX_WIDGET_WINDOW_MINUTES` = 525,600 (one year) bounds a window.
- `F4.300` is a schema change → ADR (or an amendment) before build.

## Decided by the owner

Users: all three roles. Filter: org then location tree. Ranges: presets +
custom + compare. Control Room: strip on each tab **and** a Trends tab. Org
views: all four. Segments: every segment the catalog serves. Trend points:
catalog default + org-admin edit. Actions: export, pin, link, schedule. Must
work for all current and future organizations. After the builder check: a
generic trend report template for schedules (`F4.303`); kWh per m² as a later
row (`F4.304`).

## Calls made by the designer, not the owner (check these)

- **Contracts.** `F4.297` owns the `aggregate` change (custom `from`/`to`,
  compare); `F4.298` owns the energy preview change. One shape each, reused by
  the later rows. No UI-side "call twice and diff".
- **Empty or partial compare period.** The compare series shows its gaps; the
  change figure is shown only when both periods have data, else "no data for
  the previous period".
- **Scoped users.** Totals, rankings and lists sum only the assets the user may
  read, with a visible "partial — your access covers N of M sites" note when the
  scope is narrower than the selection. A whole-org total for a scoped user
  would leak unreadable data, so it is never shown.
- **Who edits trend points (`F4.300`).** Org admins for their organization, and
  global admins; everyone who can read the site sees the effective list.
- **Units.** One unit per chart axis; points with other units go on a second
  axis or a separate chart, never summed. kWh, kW, PF and the energy source come
  from the definitions the Energy page already uses (`EnergySourceMixPoint`).
- **Rollup level.** One level for the whole view, chosen from the range, and
  shown on the view.
- **Timezone.** A site view uses the site's `timezone`, falling back to the
  organization's (default `UTC`); an organization view uses the organization's.
  "Today", "This month" and the heatmap follow it, DST days included.
- **Abnormal list.** Advisory and read-only. It never raises an alarm or a
  notification. An asset with too little history to judge is listed as "not
  enough history", not as normal.
- **Pin to a dashboard.** Pins a trailing window (as the `chart` widget is
  today), not a fixed date range.
- **Exports** are built on the server, with a row cap set in the plan.

## Left to the builder (each plan states its call)

- Batch read per asset vs one `aggregate` call per point.
- Heatmap bucket (1 h) and the colour scale.
- The statistic behind "abnormal".
- Where the org-admin trend-point override is stored, and how an org with no
  override falls back to the catalog.
- The CSV/XLSX row cap.

## Build order

Start at once: `F4.297`, `F4.298`, `F4.300` (each needs only rows already ✅).
Then `F4.299` (after `F4.298`), `F4.301` (after `F4.300` and `F4.297`),
`F4.302` (after `F4.299` and `F4.300`), `F4.304` (after `F4.299`), and last
`F4.303`.

Expected scale, the latency target and the batch read are for the `F4.297` and
`F4.299` plans to measure and state.
