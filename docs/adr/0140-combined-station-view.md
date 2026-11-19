# ADR 0140 — A combined station view over its RTU sites (`F4.240` part b)

## Status

**Accepted — 2026-11-19** (owner, in chat: "merge"; merged as #1455
`3c92c641`; proposed the same day). Plan:
[`docs/plans/f4.240-part-b-station-view.md`](../plans/f4.240-part-b-station-view.md),
with plan rulings Q1 and Q2 in its section 10.1. [ADR 0139](./0139-one-site-per-phe-rtu-and-grouped-site-cards.md)
decision 21 put `F4.240` part b out of scope, "later, only if the client
asks". On 2026-11-19 the owner asked for part b's scope record now. They had
already ruled that day that the build starts only after `F4.388` release C
is deployed. The owner gave eight rulings in chat on 2026-11-19, asked one at
a time, each taken as recommended (listed under *Rulings*). Lines marked
*(drafter)* are drafter calls that the plan may refine; the others are
rulings.

**Amends** [ADR 0098](./0098-location-tree-of-any-depth.md) decision 7, which
says a campus view over a subtree is "a later row": this record is that row.
It also amends ADR 0139 decisions 14, 17 and 21 and its *Consequences* entry
"the station's own page is empty if opened by its URL". See *Amends and
relates to*.
**Builds on** ADR 0098 (the location tree, the subtree grant), ADR 0139 (the
split, the grouped site cards, the unlinked station dashboard) and its
Amendment 1 (each site's copy takes its station's mimic and trend-strip
settings; open as GhochangFu/EMS#1454), [ADR 0113](./0113-pump-station-mimic-presets.md)
(the pump-station presets) and [ADR 0134](./0134-slab-utility-tariffs.md)
(the monthly bill). Code citations are to `main` at `2d0c1cda`.

## Rulings (owner, 2026-11-19)

Each answer is quoted as the owner picked it.

| # | Question | Ruling |
| - | -------- | ------ |
| Q1 | Where the station view lives | **"Station's own URL (Recommended)"**: `/control-room/site/<station id>` becomes the station view. The organization page's station header keeps its map-filter click and gains an "Open" link. The station crumb on each site page becomes a link. |
| Q2 | Both mimics, and their trend strips | **"Side by side, per site (Recommended)"**: a tab chooser (Overview, Electrical, Environment). For the chosen tab, each site's own copy is drawn, Lotapata I left and Lotapata II right (stacked on a phone), with its own mimic and trend strip. No new preset, no schema change. |
| Q3 | Energy and bill | **"Per site + a sum (Recommended)"**: each site's monthly bill side by side, plus a station total that is the sum of the two site bills, not re-priced. The energy chart covers both sites. The station's old tariff row is not shown. |
| Q4 | The station's unlinked site-layout dashboard | **"Keep it, hide it (Recommended)"**: the row, its tabs and the three empty groups stay untouched (ADR 0139 Q5 stands). The station page's dashboards list leaves it out. Deleting it can be its own row later. |
| Q5 | Which API reads walk the subtree | **"None change (Recommended)"**: no API, contract or schema change, so part b is web only. The station's "Assets & RTUs" entry links to each site's own tab. Calc `@site`/`@group` stays per location. |
| Q6 | What a user granted one site sees at the station URL | **"Not available (Recommended)"**: the not-available card, as for any location outside their scope. Their site page's station crumb stays plain text. Every panel reads its own site with that site's check. |
| Q7 | Release order after release C | **"Two web PRs (Recommended)"**: PR 1, the station page (totals, site cards, alarms, the header link, the crumb link, the old dashboard hidden). PR 2, the side-by-side tabs and the per-site bills with the sum. Then one read-only check on the demo host. `F4.390` PR 3 goes first if it is approved by then. |
| Q8 | The record's shape | **"New ADR 0140 (Recommended)"**: its own record, with a one-line pointer in each ADR it amends. |

**Order (owner, 2026-11-19):** the part b build starts only after `F4.388`
release C is deployed.

## Context

**The request.** ADR 0139 split each PHEWB station into one site per RTU
(release B, Lotapata, is live; release C, the other five, is being shipped).
Part a groups the site cards under a station header on the organization page.
The client now wants the station itself as one screen: the `F4.388` row's
order named it "a combined parent view (totals, alarms, both mimics)".

**What the station's own page does today** (`main` at `2d0c1cda`):

- **The page host.** `ControlRoomSitePage` finds the location in the caller's
  KPI list (`apps/web/src/pages/control-room/site-page.tsx:153-154`). If it is
  not there, the page shows `NotAvailableCard` (`:273`). It reads the
  resolved view (`:144-151`) and renders by its `kind`. ADR 0139 decision 7
  made the station's view `generated`.
- **The generated view matches the exact location.** It reads
  `WHERE wa.location_id = $1` (`apps/api/src/control-room/generated-site-view.service.ts:134-136`,
  `:148-149`). The station holds no asset, so its body is empty.
- **The lower cards** are findings, health, degradation and the scoped
  dashboards list (`site-page.tsx:259-268`). `ScopedDashboardsList` lists the
  dashboards scoped at the location
  (`apps/web/src/components/control-room/scoped-dashboards-list.tsx:27`). On
  the station that list would offer the unlinked station dashboard, whose
  groups are empty.

**What each part of a combined view would read:**

- **Totals.** The location KPI read matches the exact location
  (`apps/api/src/dashboard/dashboard.service.ts:154-160`). The station's own
  item reads 0 RTUs, 0 assets, 0 alarms and no kW. The organization header
  already adds up its sites in the browser from the same items:
  `groupSitesByParent` (`apps/web/src/lib/location-kpi-groups.ts:150-178`),
  `siteGroupRollup` (`:191-203`) and `sectionKw` for kW (`:205-210`).
- **Alarms.** The alarm list and summary location filter refuses a node the
  caller cannot read, then expands the node to its subtree
  (`apps/api/src/alarms/alarm-location-scope.ts:57-64`).
- **Energy.** The site's energy view asks `GET /reports/energy/…` with
  `locationIds=[site]`
  (`apps/web/src/components/control-room/site-energy-view.tsx:50-58`). The
  reports resolve it through `LocationAssetScopeService`, which walks the
  subtree (`apps/api/src/auth/location-asset-scope.service.ts:41-50`, used by
  `apps/api/src/reports/energy-view.service.ts`).
- **Bill.** The monthly bill reads the mapping of the exact location
  (`apps/api/src/tariffs/location-energy-bill.service.ts:69` →
  `readMappingsForLocation`, `apps/api/src/tariffs/location-tariff-read.ts:98-108`).
  The card takes one location (`site-energy-view.tsx:114`). The station keeps
  its own two-meter mappings (ADR 0139 decision 4a). A bill read at the
  station would price both meters on one slab set: a third figure, different
  from the two site bills.
- **Mimics and trend strips.** The pump-station template's Electrical and
  Environment tabs carry a `mimicPreset` and bind the location's `electrical`
  and `environment` groups by `groupCode`
  (`packages/shared/src/site-templates/pump-station-standard.ts:247-265`).
  Three rules apply:
  - A tab's group must sit at its dashboard's location
    (`dashboard_tabs_asset_group_id_location_id_fkey`,
    `packages/db/drizzle/0094_dashboard_tabs.sql:93`).
  - A group member must be an active asset at the group's location
    (`apps/api/src/admin/asset-groups/asset-groups.service.ts:260`).
  - A site widget reads its dashboard's location or its tab's group
    (`apps/api/src/dashboard-builder/site-widgets.service.ts:182-184`,
    `:270-271`). Only the two sustainability entries widen to a subtree
    (`apps/api/src/dashboard-builder/dashboard-scope-assets.ts:70-80`).

  The trend strip requires the asset group at the exact location
  (`apps/api/src/trend-points/trend-strip.service.ts:174-175`). So no
  dashboard at the station can show the sites' assets. One merged diagram
  would need a group spanning two locations, which the rules above forbid.
- **Calc.** `@site` and `@group('…')` resolve at the owning asset's exact
  location (`apps/api/src/calc/calc-scope.service.ts:183`, `:192`; ADR 0055
  decision 12; ADR 0098 decision 3).
- **Health.** The summary filter walks the subtree
  (`apps/api/src/asset-health/asset-health.service.ts:587-595`). The per-card
  score reads assets at the exact location (`scoresByLocation`, `:243`,
  `:612`).

**Access today.**

- A location grant resolves to its granted nodes and everything below them
  (`apps/api/src/auth/access-scope-sources.ts:193-212`).
- A parent the caller cannot read is set to `parentId: null`, never added
  (`withVisibleParents`, `:107-114`).
- The site routes answer 404 for a location not in `scope.locations`:
  `site-control-room-view.service.ts:160-166`,
  `generated-site-view.service.ts:110-117`, and `trend-points.service.ts:59-64`.

So a user granted only Lotapata I cannot open the station. Every caller who
can read the station (a station, ancestor, organization or global grant) can
read both of its sites.

## Decision

1. **The station view is the station's own site page** (Q1).
   `/control-room/site/<station id>` renders the station view when the
   location holds no asset of its own (`assetCount` 0) and at least one item
   in the caller's KPI list names it as `parentId`. This is the inverse of
   `siteLocations`' rule (`location-kpi-groups.ts:124-127`). The rule reads
   the KPI items, so no code names a level, a type or an organization (ADR 0098
   decision 7). It holds whatever the location's view row says: no dashboard
   at the station can bind its sites' assets (*Context*). A parent that holds
   assets of its own keeps its site page as today. *(drafter)*
2. **The header and the crumb link to it** (Q1).
   - On the organization page the station header keeps its map-filter click
     (ADR 0139 Q6) and gains an **Open** link to the station page.
   - On each site page the station crumb becomes a link. The crumbs come from
     the caller's KPI items (`controlRoomCrumbs`, `site-page.tsx:217`), so a
     caller who cannot read the station gets no station crumb (Q6).

   This amends ADR 0139 decisions 14 and 17. *(drafter: the link text)*
3. **What the station view shows** (Q1–Q3):
   - **a. Heading.** Crumbs `PHEWB › Lotapata`; the station's name; the
     organization as subtitle.
   - **b. Totals.** Sites live of total, assets, active alarms and kW, added
     up from the sites' KPI items in the browser, by the same function the
     organization header uses (`siteGroupRollup`, kW as `sectionKw`), so the
     two screens always agree. *(drafter: one function for both)*
   - **c. Site cards.** The station's sites as the existing site cards, each
     linking to its site page.
   - **d. Active alarms of both sites.** The alarm list filtered on the
     station, which the API expands to its subtree
     (`alarm-location-scope.ts:57-64`). The Site column names the office (ADR
     0139 decision 11). *(drafter: the plan picks the alarms component)*
   - **e. Both sites side by side** (Q2).
     - A tab chooser lists the sites' tabs by key (Overview, Electrical,
       Environment).
     - For the chosen tab, each site's own dashboard tab is drawn, in the KPI
       list's order (Lotapata I, then Lotapata II), left to right, and
       stacked below the phone breakpoint. Each half has the site's name and
       a link to its site page over it.
     - Each half is that site's own `SiteDashboardView`, with the site's slug,
       location and tab. Its mimic, its trend strip (with the settings ADR
       0139 Amendment 1 gives it) and every widget read through the site's
       own routes and checks.
     - *(drafter:)* A site whose view is not a `dashboard` draws its own view
       body. A tab key that one site lacks shows that half's empty state. More
       than two sites wrap, two per row (PHE has two).
   - **f. Energy and bill** (Q3). On the station's Trends & Energy tab:
     - The energy view covers both sites through the existing subtree read.
     - Each site's monthly bill appears side by side, one card per site, each
       reading its own mapping.
     - A **Station total** line adds the two site amounts for the same month.
       It is a sum, never re-priced. *(drafter:)* It shows only when every
       site bill answers in the same currency; otherwise it reads "—" with
       the reason.
     - The station view never reads the station's own tariff mappings.
     - *(drafter)* The trends half of that tab links to each site's Trends
       tab.
   - **g. Lower cards.** The findings, health and degradation cards stay when
     their read already walks the subtree; the plan checks each one and drops
     any card that reads the exact location. *(drafter)*
   - **h. Dashboards list** (Q4). `ScopedDashboardsList` on the station page
     leaves out the station's seeded site-layout copy. It finds that copy by
     a stored field (the template stamp), never by its name. *(drafter: the
     plan names the field)*
   - **i. Assets & RTUs** (Q5). The station's entry lists its sites, each
     linking to that site's own Assets tab. No table read runs for the
     station.
   - **j. No wall.** The wall shows a `dashboard` view only
     (`site-page.tsx:157-163`), and the station view is not one.
     *(drafter)*
4. **The station's old dashboard stays and is hidden** (Q4). Its row, its
   tabs and the three empty groups stay untouched. The station's view row
   stays `generated`. ADR 0139 Q5 stands. Deleting the dashboard is its own
   row if it is ever wanted.
5. **No API, contract or schema change** (Q5). The station view reads:
   - `GET /api/v1/dashboard/locations` (the KPI items with `parentId`);
   - each site's own site routes;
   - the alarm list with the station as its location filter;
   - the energy view with the station as its location;
   - each site's monthly bill.

   The generated view, the location detail (the Assets tab), the trend strip,
   the bill, the location KPI and calc stay per location. Calc `@site` and
   `@group` stay per node (ADR 0055 decision 12, ADR 0098 decision 3). A
   formula that must span sites is its own row.
6. **Access** (Q6).
   - The station view opens only for a caller whose scope holds the station.
     That is a global, organization, ancestor or station grant, and each of
     those also covers both sites.
   - A caller granted one site only, or one group at a site, gets the
     not-available card at the station URL, as for any location outside
     their scope. The station's id stays hidden from them (ADR 0098 drafter
     choice 8, ADR 0139 decision 12), and their site page has no station
     crumb.
   - Every panel reads its own site through that site's own check, limited
     to the caller's assets. The station view adds no read that answers for
     a location the caller cannot read.
7. **Releases** (Q7). After `F4.388` release C is deployed (owner,
   2026-11-19), each PR after the owner's yes on the plan:
   - **PR 1 (web):** decisions 1, 2, 3a–d, 3g–j and 4.
   - **PR 2 (web):** decisions 3e and 3f.
   - Then one read-only check on the demo host.
   - If `F4.390` is approved by then, its PR 3 (the site page's list poll at
     60 s) lands first, because the station page loads two sites at once.
8. **Out of scope:**
   - a merged two-train mimic preset, and a combined trend strip;
   - a station bill priced on both meters;
   - calc aggregates over a subtree;
   - subtree reads for the generated view or the Assets table;
   - deleting the station's old dashboard;
   - a partial station view for a user granted one site;
   - a wall for the station page;
   - a combined view for a parent that holds assets of its own.

## Security

- **No new read path.** The station view uses reads that already exist and
  already check scope (decision 5). Each site panel is the site's own page
  body, behind the site's own 404 rule.
- **No new id leak.** The station view adds no path that gives the station's
  id to a caller who cannot read the station: the KPI list nulls `parentId`
  (ADR 0139 decision 12), and the site routes answer 404 (decision 6).
  (corrected 2026-11-19 by the security review of PR 1:)
  - The dashboards list (`GET /api/v1/dashboards`) and the dashboard detail
    are scoped by organization (ADR 0047 Amendment 2 ruling 2,
    `apps/api/src/dashboard-builder/dashboards.service.ts:145-164`).
  - So a dashboard scoped at the station, for example its old site-layout
    copy (Q4), carries the station's `locationId` to any reader in its
    organization, a one-site grantee included.
  - This is unchanged by this record. Widget data stays gated by the
    caller's readable assets.
  - Narrowing location-scoped dashboard reads by the readable locations
    would be its own row.
- **The subtree reads it uses are bounded.** The alarm filter refuses a node
  the caller cannot read before it walks (`alarm-location-scope.ts:59-61`).
  The energy view's walk is bound to the placed organization and limited to
  the caller's readable assets (`location-asset-scope.service.ts:41-50`).
- **The bill sum adds only amounts the caller already reads**, one per site,
  each from that site's own bill read.

## Dependencies

None. No npm package, no migration, no contract field, no route.
`apps/web` only.

## Amends and relates to

- **ADR 0098: decision 7 amended.** "A campus view that aggregates a subtree
  is a later row" is this record. A site's control room stays per node. A
  parent with sites and no assets of its own gets the station view, built
  from per-node reads. Decision 3 (`@site` is the asset's own node) and
  decision 11 (the pin rule) stand. ADR 0098 gains a one-line pointer in the
  same change.
- **ADR 0139: decisions 14, 17 and 21 amended.** The header gains an Open link
  (14), the station crumb becomes a link for a reader of the station (17), and
  part b leaves decision 21's out-of-scope list. Q5 (keep the row) and Q6 (the
  header click filters the map) stand. The *Consequences* entry "the
  station's own page is empty if opened by its URL" no longer holds once part
  b ships. ADR 0139 gains a one-line pointer and inline notes at decisions 14,
  17 and 21 in the same change.
- **ADR 0139 Amendment 1** (GhochangFu/EMS#1454): relates. Each site's copy
  carries its station's mimic and trend-strip settings, which the side-by-side
  halves show.
- **ADR 0113**: relates. The presets are unchanged; each half draws its
  site's preset.
- **ADR 0134**: relates. Each site bill is ADR 0134's bill for that site. The
  station total is a sum of bills, not a bill.
- **ADR 0055 decision 12**: unchanged.

## Consequences

- **The station URL shows the station.** An old bookmark and the new links
  open the combined view for any reader of the station.
- **The station page doubles the site page's reads.** Two sites' dashboards
  poll on one screen. That is why `F4.390` PR 3 goes first if it is approved
  (decision 7). The KPI list poll is shared with the rest of the control room.
- **The station's own KPI item still reads 0 assets.** Only this page and the
  organization header add up the sites. Any other screen that reads the
  station's own item is unchanged.
- **The station total is not the old station bill.** Each site bill takes its
  own slabs and fixed charge (ADR 0139 Consequences). The old two-meter station
  bill stays on no screen.
- **Owed after the build:** the `F4.240` row closed (parts a and b done). An
  `AGENTS.md` catch-up through its own `chore(agents):` PR if a section then
  says the control room is per node with no combined view (`AGENTS.md`
  around line 1733 names `F4.240` as raised).

## Verification owed

- **Web (jsdom):**
  - The station view renders for a location with sites and no assets. A
    leaf, and a parent with assets of its own, render the site page.
  - The totals equal the organization header's roll-up for the same items.
  - The alarms read is called with the station id.
  - Two `SiteDashboardView`s render, each with its own site's slug, location
    and tab; the tab chooser switches both.
  - The bill sum shows, and reads "—" on a currency mismatch or a failed site
    bill.
  - The dashboards list leaves out the seeded station copy.
  - The header's Open link; the crumb link only when the station is readable.
  - A KPI list without the station (a user granted one site) shows the
    not-available card at the station URL.
- **A request tripwire:** a spec lists every request the station page makes.
  The only ones that name the station are the view resolve, the alarm list
  filter, the energy view and the lower cards decision 3g keeps. None of them
  is the station's bill, location detail, generated view or trend strip.
- **API (existing behaviour, asserted):** for a user granted one site, `GET
  /api/v1/control-room/sites/<station>/view` is 404, and `parentId` on that
  site's KPI item is `null`.
- **Demo host** (read-only, after PR 2 is deployed): each of the six station
  pages opens from its header. Its totals equal the header's. Its two halves
  name both sites and their mimics draw. Each bill names one meter and the
  total equals their sum. The station's old dashboard is not listed.
