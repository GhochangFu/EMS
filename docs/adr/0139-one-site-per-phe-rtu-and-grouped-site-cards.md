# ADR 0139 — One site per PHE RTU under its station, and site cards grouped under their parent (`F4.388`, `F4.240` part a)

## Status

**Accepted — 2026-11-19** (owner, in chat: "Yes, merge on green"; merged as
#1440 `529cc4f4`; proposed the same day). Raised by `F4.388` (the owner, from the client,
2026-11-18) and `F4.240` (raised 2026-10-10 by the `F2.10` closure). The owner
ruled the order on 2026-11-19 (recorded in both rows, #1439 `04b92a44`) and
gave eight rulings in chat on 2026-11-19, one at a time (listed under
*Rulings*); the second part of Q7 was a free-text answer, recorded verbatim
with the drafter's reading. Ruling Q5 was asked a second time after the migration review found
that `bms.dashboards` has no archive column. Rulings Q7 and Q8 were asked after
an impact audit of every reader of an asset's location (alarms, maintenance,
access, reports, ML, advisories, energy, tariffs, calc; see *Context*); Q7 was
asked a second time because the first question named one billing meter per
tariff, and each PHE tariff names two (ADR 0134 Amendment 3). The merge of this
record is the acceptance. Lines marked *(drafter)* are drafter calls that the plan may
refine; the others are rulings.

**Amends** [ADR 0080](./0080-seed-owned-location-identity-and-boot-gate.md)
decisions 1 and 4 (the legacy PHE cleanup and its boot-gate count retire) and
[ADR 0098](./0098-location-tree-of-any-depth.md) *Drafter choices* 10 (the
organization's site cards stop being flat) and
[ADR 0134](./0134-slab-utility-tariffs.md) Amendment 3 for a split PHEWB
station (each site gets its own bill); see *Amends and relates to*.
**Builds on** ADR 0098 (the location tree), [ADR 0007](./0007-phe-mqtt-ingest-pilot.md)
(the PHE catalog seed), [ADR 0030](./0030-shared-api-contracts.md) (response
types are `z.infer`red from shared Zod schemas) and
[ADR 0113](./0113-pump-station-mimic-presets.md) (the pump-station site
layout). Code citations are to `main` at `04b92a44`.

## Rulings (owner, 2026-11-19)

| # | Question | Ruling |
| - | -------- | ------ |
| Q1 | How the 12 PHE RTUs move into their sites | **The seed moves them.** The seed maps each RTU to its own site under its station, creates the sites, moves each RTU with its assets in one statement, and builds each site's groups, dashboard and view. A per-station switch lets one station go first. |
| Q2 | The sites' names | **The RTU's name:** `Lotapata I`, `Lotapata II`, and so on. Asset names and the ADR 0111 labels (`PHE-MFM-000000003 · Lotapata I`) stay correct with no rename. |
| Q3 | The natural slug `phe-lotapata-i` is on the legacy cleanup's delete list | **Retire the cleanup** and its zero-count boot check in the same change, and use the natural slugs. |
| Q4 | The station's location type | **`campus`.** The 12 sites stay `pump_station`. |
| Q5 | The station's old site-layout dashboard after the move | First ruled "archive it"; `bms.dashboards` has no `archived_at` (only the template tables do), so asked again: **unlink it, keep the row.** The station's view becomes the generated kind; the dashboard row, its tabs and the emptied groups stay. Nothing is deleted and no migration. |
| Q6 | `F4.240` part a: the station header on the organization page | **A roll-up, and a click filters the map.** The station name with sites live, assets and active alarms; a click filters the site map to the station's sites. No link to a station page until part b. |
| Q7 | The station's tariff and monthly bill after the split | First asked with a wrong fact (one billing meter per tariff); asked again with both meters named: **split it into two site bills.** On who writes them and with which load, the owner in chat: "Sites: they will have their stations' organizations carry flight for Lota Pata 1 and Lota Pata 2. All have WBSCDCLs' current settings for tariff." Read as: **each site carries its station's tariff forward**, with the same WBSEDCL settings and its own meter (decision 4a). *(drafter reading; the owner confirms it by merging this record)* |
| Q8 | The asset `site_name` of a split station | **The site's name** (`Lotapata I`), so the alarms page's Site column, the work orders and the asset panel name the office (decision 11). |

**Order (owner, 2026-11-19, `F4.388` row):** one ADR for both rows;
`F4.240` in two parts (a, the grouped cards; b, a combined station view);
part a and the seed change side by side; the data move one station first
(Lotapata), then the other five; part b later, only if the client asks. No
release shows the flat list.

## Context

**The request.** PHE West Bengal (`PHEWB`) has six station locations. Each
holds two RTUs, and the client counts each RTU's office as its own site — for
example Lotapata 1 and Lotapata 2 under Lotapata.

**What the data says** (read-only, the demo host and
`packages/db/src/phe-catalog.json`, 2026-11-18 and 2026-11-19):

- Every station has two RTUs, each with its own IMEI (`rtu_code`), MQTT topic
  and GPS point, 220–610 m apart (Lotapata I and II: about 440 m). Each RTU has
  its own energy meter, main pump breaker, chlorine pump and RTU-health device:
  48 assets, 4 per RTU.
- Lotapata I and II write separate streams (40,814 and 39,326 rows in 24 h).
  The payload carries no IP address; the RTUs are cellular and publish to the
  vendor broker, so the IMEI is the identity. Only 5 of the 12 RTUs ingest on
  the demo host.
- Every station has exactly the three seeded asset groups (`pump-station`,
  `electrical`, `environment`), each holding assets of both RTUs, plus 1
  site-layout dashboard (tabs Overview, Electrical, Environment), 1
  control-room view, 1 tariff and 1 `bms.map_locations` row. Each tariff is
  an administrator's row (created 2026-11-15) and names both RTUs' MFM meters
  in `bms.location_tariff_meters` (for Lotapata, `PHE-MFM-000000003` on
  Lotapata I and `PHE-MFM-000000004` on Lotapata II). No location grant, no
  asset-group grant, no report schedule, no maintenance window, no calc
  parameter and no edge gateway names a PHE location or group.

**What the code does today.**

- **The tree exists** (ADR 0098): `bms.locations.parent_id`, the subtree grant,
  the map pin rule (`PIN_RULE`, `apps/api/src/map/map.service.ts:15`: a
  location is a pin when it has no active child or holds an active asset),
  subtree expansion in reports, schedules, health and sustainability, and the
  ancestor walk for calc parameters and tariffs
  (`apps/api/src/tariffs/location-tariff-read.ts`).
- **No API moves an RTU.** `updateRtuBodySchema` omits `locationId`
  (`packages/shared/src/contracts/rtu-writes.ts:43`). An asset `PATCH` refuses
  a location its RTU is not at ("RTU must belong to the selected location").
- **K4 binds an asset to its RTU's location.** `assets_rtu_id_location_id_fkey`
  (`packages/db/drizzle/0113_asset_rtu_composite_keys.sql:116-119`) references
  `bms.rtus (id, location_id)`, `ON UPDATE NO ACTION`, not deferrable. Moving
  the RTU first or the assets first, as two statements, fails at the end of
  the first.
- **The PHE seed runs on every deploy** (`deploy/aws/docker-compose.yml:165`,
  the `migrate` service runs `db:seed`; `bms-ctl rollback` re-deploys an older
  SHA, so its seed runs too) and writes, on every run, each RTU's
  `location_id` (`phe-pilot-seed.ts:415-416`, `ON CONFLICT (external_rtu_id)
  DO UPDATE SET location_id = EXCLUDED.location_id`) and each asset's
  `locationId` (`:494-510`) from the catalog station. A hand move is undone by
  the next deploy.
- **Location `slug` is unique across organizations**
  (`0010_phase5_location_access.sql:16`); **`code` is unique per
  organization** (`0016_org_location_rtu_hierarchy.sql:37-39` replaced
  `locations_code_unique` with `locations_org_code_idx`). (corrected
  2026-11-19, owner ruling B on PR 3) The seed finds a PHE station by slug and
  organization.
- **The legacy cleanup** (`cleanupLegacyPheRtuLocations`,
  `packages/db/src/hierarchy-seed.ts:459`, ADR 0080 decision 4) deletes on every
  boot each location whose slug is in `legacyLocationSlugs` — the RTU display
  names' slugs minus the stations' (`phe-pilot-seed.ts:162-185`), for example
  `phe-lotapata-i` — with its grants, asset groups and RTUs. The boot gate
  requires the count of those slugs to be zero (`verify-hierarchy-seed.ts:753`).
  Since ADR 0080 the cleanup deletes nothing after a database's first boot.
- **The asset-group seed follows the asset.** `seedAssetGroups`
  (`asset-groups-seed.ts:373-428`) upserts groups on `(asset.location_id, code)`
  and deletes **every** membership whose group sits at another location
  (`:377-385`), seeded or not, so groups follow a moved asset and the old ones
  are left empty.
- **The PHEWB site layouts** are seeded by `seedPhewbSiteLayouts`
  (`site-layout-seed-move.ts:345`), which resolves a station by the pair
  (slug, `meta.phe.stationCode`) (`site-layout-seed.ts:163-172`), inserts the
  dashboard and the view create-once (`ON CONFLICT DO NOTHING`), and runs the
  stock upgrade chain on untouched copies. The tabs bind the location's
  `pump-station`, `electrical` and `environment` groups
  (`pump-station-standard.ts:247-262`); `dashboard_tabs_asset_group_id_location_id_fkey`
  is `ON DELETE RESTRICT`.
- **`seedMapLocations` only inserts**, skipping a slug that exists.
- **The organization level is flat.** `GET /api/v1/dashboard/locations`
  (`dashboard.service.ts`) returns one item per active location, and
  `locationKpiSummarySchema` (`packages/shared/src/contracts/dashboard.ts:40`)
  has no `parentId`. The page splits cards into Live and Not live
  (`apps/web/src/lib/location-kpi-groups.ts:75`, `F4.259`). A location with no
  asset is a card reading "0 RTUs · 0 assets" in Not live, and it counts as a
  site. ADR 0098 drafter choice 10 kept this flat "until the campus view row".
- **The site map already filters by parent** (`organizationNodes`,
  `apps/web/src/lib/map-site.ts:80`, `F2.10`).

**Impact audit — who reads an asset's location** (code at `04b92a44`, demo
host read-only, 2026-11-19). No table stores a location or site snapshot for
an asset's data: `bms.alarms` keys on asset, RTU and rule; `bms.work_orders`
on asset; `ml.forecasts` and `ml.anomaly_scores` on asset (`0157`); the four
continuous aggregates have no location column. A scan of every JSON, text and
array column in `bms` and `ml` for a PHE station id found only
`bms.audit_log.payload` (10 rows of history). So every reader falls in one of
three kinds:

- **Follows the move, by a subtree or ancestor walk — no change needed.** The
  alarm list and summary filters (`apps/api/src/alarms/alarm-location-scope.ts:57`),
  maintenance cover (`apps/api/src/alarms/maintenance-cover.ts:45-46`, a
  window on a station still covers the moved assets), maintenance-window
  scope, location grants (`apps/api/src/auth/access-scope-sources.ts:195-197`),
  report schedules, the ML and findings filters
  (`apps/api/src/filter-options/asset-filter-scope.service.ts:59`), Copilot
  tools, calc parameters and the per-asset tariff for cost
  (`apps/api/src/tariffs/location-tariff-read.ts:111-140`). The dedupe key,
  the alarm bar, escalation and notification routing carry no location.
- **Follows the move, by the asset's current location — labels change.**
  Alarm, work-order, ML, advisory (E1.6) and degradation (E1.5) rows show
  the site as the location, for past rows too; the alarm statistics and the
  energy reports show two site rows where one station row was, for past
  periods too. Advisories need the location's own time zone and do not fall
  back (`apps/api/src/advisories/advisories.reads.ts:110`), which decision 3
  covers.
- **Exact location — the gaps this record closes or names.**
  - The **monthly bill** reads the mapping of the exact location
    (`readMappingsForLocation`, `location-tariff-read.ts:104`, from
    `location-energy-bill.service.ts:69`), and the site Energy tab asks for
    the site (`MonthlyBillCard locationId`, `apps/web/src/components/control-room/site-energy-view.tsx:114`).
    After a split the sites would show no bill (Q7, decision 4a).
  - The asset's free-text **`site_name`** is what the alarms page's Site
    column (`apps/web/src/pages/alarms-page.tsx:491`, its CSV at `:105`), the
    work orders (`work-orders-page.tsx:606,715`,
    `apps/web/src/components/work-orders/work-order-detail-drawer.tsx:93`)
    and the asset panel (`apps/web/src/components/assets/asset-detail-panel.tsx:70`)
    show. The PHE seed writes it from the
    catalog station on every deploy (`phe-pilot-seed.ts:494,510`), so both
    offices would read "Lotapata" (Q8, decision 11).
  - The **station's own page** — the generated view
    (`apps/api/src/control-room/generated-site-view.service.ts:136`), the
    location detail (`dashboard.service.ts:259,295,435`) and health by
    location (`asset-health/asset-health.service.ts:612-630`) — matches the
    exact location, so it is empty once the station holds no asset (see
    *Consequences*).
  - A calc formula's `@site`, `@group('…')`, `@domain('…')` and qualified
    codes resolve at the owner's exact location
    (`apps/api/src/calc/calc-scope.service.ts:183`), so after a split they see
    one site. No PHE template point or asset point formula uses one (demo
    host, 2026-11-19).
  - An asset-group grant names a group, and the station's groups are emptied
    (decision 5). None exists on the demo host.

## Decision

### Part 1 — the seed splits a station (`F4.388`)

1. **A split list in the seed.** The PHE seed carries a list of station codes
   to split, declared once in `packages/db/src` (for example
   `PHE_SPLIT_STATION_CODES`). It is source, not an environment variable, so a
   cold start and the demo host agree. A station not on the list is seeded as
   today, except as decision 4 says (Q1). *(drafter: the name and the file)*
2. **A split station is a parent.** The seed keeps finding the station as
   today and writes its type as **`campus`** (Q4); its name, code, slug and
   coordinates do not change.
3. **One site per RTU under it.** For each RTU of a split station the seed
   creates or updates one child location: `parent_id` = the station; type
   `pump_station`; name = the RTU's catalog `RTUDisplayName` (Q2); slug =
   `stationSlug(RTUDisplayName)`, for example `phe-lotapata-i` (Q3); code =
   `PHE-<StationCode>-<suffix>`, for example `PHE-CBLTPT1-I` *(drafter)*;
   latitude and longitude from that RTU's catalog row; timezone and province
   as the station's; `meta.phe` with the station's `stationCode` and the RTU's
   `edgeRtuId`. The `locations_tree_guard` trigger checks the write, as it
   checks every location write.
   - **Identity.** The seed adopts a site only by the triple slug,
     `meta.phe.stationCode` and `meta.phe.edgeRtuId`, never by slug alone
     (ADR 0080 decision 4). Before it inserts, it reads the holders of the
     slug and the code on the superuser pool, as ADR 0080 ruling 16 does for
     ESKOM: a holder that is not this site — another organization's row, or
     an administrator's PHEWB row — is logged and the site is skipped, so its
     RTU stays where it is. Never `23505`, never a takeover.
4. **The move is one statement, and never back.** Before the RTU upsert, the
   seed moves each RTU of a split station whose `location_id` is not its site,
   together with every asset wired to it, in **one** data-modifying statement
   — `WITH r AS (UPDATE bms.rtus … RETURNING id, location_id) UPDATE
   bms.assets a SET location_id = r.location_id FROM r WHERE a.rtu_id = r.id`
   — so K4 is checked once, on the final rows (Q1). The assets take the site
   from `r`'s `RETURNING`, not from a read of `bms.rtus`, which would see the
   old row. The match is by `external_rtu_id` and `rtu_id`, never by a name.
   Assets without an RTU stay where they are. The RTU and asset upserts then
   write the RTU's current location, so a second run moves nothing.
   **Rollback-safe:** the seed never moves an RTU back. For a station not on
   the list, an RTU that already sits at a child site of its own station
   stays there, and the upserts write that site, so a re-deploy of an older
   release after release B does not raise K4. *(drafter: the reverse move,
   if ever wanted, is its own row)*

   4a. **Each site carries its station's tariff forward** (Q7, drafter
   reading). In the same
   transaction, after the move, for each site whose RTU the move statement
   moved **in this run** (its `RETURNING`), and only when that site has no
   tariff mapping of its own, the seed copies each of the station's
   `bms.location_tariffs` rows (`tariff_key`, `sanctioned_load`,
   `sanctioned_load_unit`, `effective_from`, `effective_to`) to the site,
   with only the meters of that mapping that now sit at the site
   (`bms.location_tariff_meters`; `billing_meter_asset_id` = the station's
   billing meter if it is at the site, else the lowest asset id, the list
   order of `apps/api/src/tariffs/location-tariffs.service.ts:385`). A
   mapping with no meter at the site is not copied. The match is by asset
   id, never by a name (ADR 0080 decision 4). **Once per move:** a later run
   moves nothing, so it copies nothing — an administrator's later edit (for
   example each office's own sanctioned load), a deleted site mapping, and a
   station mapping added later are never copied again. The station's rows
   stay unchanged, as its dashboard does (Q5). The seed logs each copy and
   writes no audit row (no actor), as `db:seed`'s other writes do (ADR 0134
   Amendment 2); the API's `master.location_tariff.create` row
   (`location-tariffs.service.ts:150-160`) is for an administrator's write.
   *(drafter)* `location_tariffs_no_overlap` is per location and the
   site has no row, and each copied meter sits at the site, so ADR 0134's
   subtree rule holds. *(drafter: the copy keeps the station's dates, so the
   site's past months bill too; the station rows stay)*
5. **Groups follow by the existing rule.** `seedAssetGroups` runs after the
   move and builds each site's `pump-station`, `electrical` and `environment`
   groups; it removes the moved assets from every group at the station. On
   the demo host those are only the three seeded groups, and no asset-group
   grant names a PHE group (read 2026-11-19); the plan re-reads both before
   release B. If a grant then names a station group, the release stops and
   the owner is asked, because the emptied group would grant no asset.
   *(drafter)* No change to that seed.
6. **Each site gets the pump-station layout.** `seedPhewbSiteLayouts`
   (`site-layout-seed-move.ts:345`) gains the 12 sites, resolved by the same
   (slug, `meta.phe.stationCode`) pair — each site carries its station's code
   — with the same create-once rule and upgrade chain: one dashboard
   (`site-layout-phe-lotapata-i`), its three tabs bound to the site's groups
   (ADR 0113's presets) and one `dashboard` view. `siteLayoutPheSlugs`
   (`verify-hierarchy-seed.ts:728,776`) gains the 12 site slugs.
7. **The station's old dashboard is unlinked** (Q5). Once, when a station is
   first split, and only when the station's view still names the seeded
   site-layout dashboard: the view row becomes `kind = 'generated'` with
   `dashboard_id = NULL` (allowed by `site_control_room_views_kind_check` and
   `_dashboard_id_check`, `0082:38-41`). The dashboard row, its tabs and the
   three emptied groups stay. Nothing is deleted and nothing is archived.
8. **The legacy cleanup retires** (Q3). Removed in the same change:
   `cleanupLegacyPheRtuLocations` and its import and call (`seed.ts:13,134,245`);
   `legacyLocationSlugs` (`phe-pilot-seed.ts:185`) and its completeness entry
   (`verify-hierarchy-expected.ts:138`, which throws on an empty list); the
   boot gate's "PHEWB legacy per-RTU locations" count
   (`verify-hierarchy-seed.ts:671,753`); and their specs
   (`verify-hierarchy-expected.spec.ts:116-175`,
   `verify-hierarchy-expected.test.ts:64`,
   `tests/f4.169-f4.170-verifier-boot-gates.integration.test.ts`,
   `tests/f4.169-f4.170-seed-owned-rows.integration.test.ts`). The zero-count
   becomes a **shape check**: a PHEWB location whose slug is an RTU's slug
   must be a child of that RTU's station and carry the matching `meta.phe`
   pair, so a legacy row that survives on an old database (a restore from an
   old backup) stops the boot instead of being adopted. This amends ADR 0080
   decisions 1 and 4.
9. **The map follows the sites.** The PHE map seed adds one map row per site
   of a split station. The station's existing row stays; `PIN_RULE` hides it
   (a station with active children and no asset is not a pin), so the map
   shows two pins and the station is a filter (ADR 0098 decision 11).
   *(drafter)*
10. **The boot gate counts the new shape.** Presence of the 6 station codes
    stays; it adds presence of each split station's sites, each RTU and asset
    of a split station at its site, and a view row on each site; the
    asset/RTU location-mismatch count and the pump-station member rule
    (`ag.location_id = a.location_id`, `:736`) stay as they are.
11. **`site_name` names the site** (Q8). For an asset that sits at a child
    site of its station, the PHE seed's asset write sets `site_name` to the
    site's `bms.locations.name` as decision 3 writes it (`Lotapata I`)
    instead of the catalog `StationName` (`phe-pilot-seed.ts:494`); every
    other PHE asset keeps the catalog name. The simulator's seed wiring reads
    only ESKOM assets and skips `PHE-` codes (`hierarchy-seed.ts:337-338`),
    the simulator runtime filters on `SIM_SITE_NAMES`
    (`apps/sim/src/index.js:629`), which names no PHE station, and the
    location backfill reads only `location_id IS NULL`
    (`asset-groups-seed.ts:26-36`), so none reads a PHE `site_name`. A re-deploy of a release older than release B writes the
    catalog name back; that is cosmetic and the next release restores it.

### Part 2 — site cards grouped under their parent (`F4.240` part a)

12. **The location KPI item names its parent.** `locationKpiSummarySchema`
    gains `parentId: string | null`, additive (ADR 0030). The server sets it
    to `null` when the caller cannot read the parent, as `/auth/me` does
    (ADR 0098 drafter choice 8). No route or permission changes.
13. **The organization level groups cards under their parent.** When an
    organization's items include a parent, the page shows each parent as a
    **header** over its children's cards. A parent that holds no asset shows
    no card of its own; a parent that holds assets shows its own card first
    in its group. An organization with no tree renders as today. No code
    names a level or an organization (ADR 0098 decision 7). This amends ADR
    0098 drafter choice 10.
14. **The header** (Q6) shows the parent's name and a roll-up of its subtree
    from the same KPI items — sites live of total, assets, active alarms — and
    a click sets the site map's parent filter to that parent. It links to no
    station page.
15. **Live and Not live** (`F4.259`) hold groups: a group sits under Live when
    at least one of its sites is live, and each card keeps its own badge.
    *(drafter)*
16. **A site is counted once.** Each site count counts a location only when
    it is a leaf or holds an asset (the `PIN_RULE`), so PHEWB reads 12 sites,
    not 18: the organization card and header (`siteCount` from
    `summary.locationCount`, `apps/web/src/lib/control-room-levels.ts:34`;
    `organization-card-grid.tsx:42-45`; `organization-page.tsx:163`) and the
    estate tile (`sitesTotal`, `dashboard.service.ts:520-599`, shown at
    `dashboard-page.tsx:179`). *(drafter: the plan confirms each source)*
17. **The site page's crumbs name the parent** as plain text (`PHEWB ›
    Lotapata › Lotapata I`). *(drafter)*

### Part 3 — releases

18. **Release A:** Part 2 and Part 1 with an **empty** split list, plus the
    cleanup's retirement (decision 8) and the never-back rule (decision 4).
    Nothing moves on the demo host; PHEWB looks as today.
19. **Release B:** the split list names Lotapata (`CBLTPT1`). The deploy's
    seed moves Lotapata. Checked on the demo host before release C.
20. **Release C:** the list names the other five stations.
21. **Out of scope.** `F4.240` part b (a combined station view with totals,
    alarms and both mimics) — later, only if the client asks; the `F4.240` row
    stays open for it. A "move RTU" admin action. A reverse move. Renaming
    RTUs or assets. Splitting any organization other than PHEWB.

## Security

- **Access widens by the existing subtree rule.** A grant on a station covers
  both its sites (ADR 0098 decision 4). No PHE location or asset-group grant
  exists on the demo host today; organization grants are unchanged.
- **The new contract field leaks no id.** `parentId` is `null` when the
  caller cannot read the parent (decision 12); the plan proves it as ADR 0098's
  tripwire proves `/auth/me`.
- **The move stays inside one organization.** The seed writes under the PHEWB
  tenant context; the composite organization FKs on `rtus` and `assets` and
  the tree guard refuse anything else.
- **No takeover by slug.** A site is adopted only by its triple (decision 3);
  a foreign holder of the slug or code is logged and skipped.
- **Retiring the cleanup removes a delete path**, it adds none; the shape
  check keeps a surviving legacy row from being adopted silently.
- **The tariff copy only adds rows, inside PHEWB** (decision 4a). It runs
  under the PHEWB tenant context, so the `0155`/`0156` row-security legs
  check each row and meter; it never edits or deletes a tariff row and never
  writes a site that already has one.

## Dependencies

None. No new npm package and **no migration**: `campus` is seeded (`0103`),
`parent_id` exists (`0103`), and a `generated` view with no dashboard is
allowed by `0082`'s CHECKs, and the tariff copy writes the existing
`bms.location_tariffs` and `bms.location_tariff_meters` (`0155`, `0156`).
One additive contract field in `packages/shared/src/contracts/`.

## Amends and relates to

- **ADR 0080 — decisions 1 and 4 amended.** The legacy PHE cleanup and its
  zero-count retire; the count becomes the shape check of decision 8. The
  rest of decision 4 (no move or delete by a free-text match) stands and
  governs decision 3's identity rule. This record's merge is the amendment;
  ADR 0080 gains a one-line pointer to it in the same change.
- **ADR 0098 — *Drafter choices* 10 amended.** The organization's site cards
  group under their parent (decision 13). Decision 7 (the control room stays
  per node) and decision 11 (the pin rule) stand. ADR 0098 gains a one-line
  pointer in the same change.
- **ADR 0134 — Amendment 3 amended for a split PHEWB station.** Amendment 3
  billed one station for both meters because WBSEDCL sent one bill per
  station; after a split, each site has its own bill with its own meter
  (decision 4a). The several-meter mapping itself stands. ADR 0134 gains a
  one-line pointer in the same change.
- **ADR 0007** — relates; decision 4a's "the seed asserts once, then the
  operator owns it" is not extended to locations: the seed keeps owning PHE
  RTU and asset locations. The tariff copy (this record's decision 4a)
  follows ADR 0007 decision 4a's rule: the seed writes a site's tariff once, then the administrator owns it.
- **ADR 0113** — relates; each site gets the pump-station layout; the
  station's copy is unlinked, not upgraded.
- **ADR 0111** — relates; labels are unchanged (`<code> · <RTU>`).

## Consequences

- **History stays.** Telemetry, alarms, work orders, ML forecasts, anomaly
  scores and findings, advisories and degradation rows are keyed by asset, so
  no row moves; the alarm list and other screens show the site as the asset's
  location from the move on, for past rows too (ADR 0098 decision 8). The
  alarm statistics and the energy reports show two site rows where one
  station row was, for past periods too.
- **Ingest does not change.** Bindings route by `rtu_code`; the topics and
  RTUs are the same rows.
- **Each site has its own bill** (decision 4a). The site Energy tab reads
  the site's mapping, and the per-asset cost reads find the nearest mapping,
  now the site's. The amounts differ from the one station bill: each site
  bill takes its own slabs and, until an administrator sets each office's own
  load on the Tariff page, the station's full sanctioned load, so the fixed
  charge counts that load once per site. The station keeps its two-meter
  mappings and bill, on no linked screen.
- **The station's own page is empty if opened by its URL.** It matches the
  exact location (*Context*, impact audit) and the station holds no asset.
  No screen links to it (decisions 9, 14 and 17); an old bookmark shows an
  empty page until part b.
- **A calc aggregate at a split station sees one site.** No PHE formula uses
  one today; a later formula that must span both sites needs part b or its
  own row.
- **A failed move stops the boot.** The seed runs in the `migrate` service; if
  the move statement fails, the deploy fails and `bms-ctl rollback` returns to
  the last release, whose seed does not move the RTUs back (decision 4).
- **Each station keeps an unlinked dashboard** with three empty groups. It
  can show in the admin dashboard list under the station; part b may reuse or
  replace it.
- **Owed after the build:** the `F4.388` closure; the `F4.240` row edited to
  part a done, part b open; an `AGENTS.md` catch-up through a separate
  `chore(agents):` PR if any section then names the flat organization level
  or the legacy cleanup (none does today).

## Verification owed

- **Database.**
  - The move statement passes K4 on a fixture station with two RTUs and eight
    assets, as `bms_owner` under the PHEWB tenant context.
  - An integration test seeds a cold database with a **non-empty** split
    list, twice: run 2 moves nothing, creates nothing and leaves every row
    equal to run 1 (CI's committed list is empty in release A, so only this
    test runs the split path there).
  - A rollback test: seed with the list, then seed with the list empty; the
    RTUs stay at their sites and the boot gate passes.
  - A slug or code held by another organization or by an admin's PHEWB row
    is logged and skipped, never adopted, never `23505`.
  - The shape check stops the boot on a planted legacy-slug row that is not a
    child of its station.
  - After the move, each split station's three groups have zero members and
    each site's three groups hold its 4 assets with roles.
  - After the move, each site holds one copy of each station tariff with only
    its own meter; run 2 copies nothing; a site mapping an administrator
    edited or deleted is not written again on the next boot; the station's
    mappings are unchanged.
  - Each moved asset's `site_name` is its site's name; an asset of a station
    not on the list keeps the catalog name.
  - A cold start (roles, migrate, seed) passes with the list empty; telemetry
    row counts per asset are equal before and after a split.
- **API.** `parentId` on `GET /api/v1/dashboard/locations` for a child, a
  root, and a child whose parent the caller cannot read (`null`). The
  energy bill of a site after a split names one meter.
- **Web (jsdom).** The grouped cards; the header roll-up; the map filter on a
  header click; Live/Not live with groups; each site count of decision 16;
  the crumbs of decision 17; an organization with no tree renders as today.
- **Demo host, release B** (read-only checks; owner yes before the deploy):
  re-read groups, grants, tariffs and their meters, maintenance windows, calc
  formulas with a scope, and edge gateways at the PHE stations first; then
  Lotapata I and II exist under Lotapata with one RTU and 4 assets each; both
  keep ingesting; the station's view is generated and its dashboard row is
  unlinked; the organization page shows one Lotapata header over two cards;
  the map shows two pins; the Energy tab of each site shows its own bill; the
  alarms page's Site column reads Lotapata I or Lotapata II.
