# ADR 0087 — One Control Room section and the SMOC standard site template (`F3.72`–`F3.75`)

## Status

Accepted — drafted on 2026-09-30 from an owner review of the three dashboard
sections and a clickable layout demo. Eleven scope questions were put to the
owner one at a time; all were ruled, and each ruling is recorded under *Gate
questions*. The owner approved this written record on 2026-09-30.

Creates rows `F3.72`–`F3.75`. Amends [ADR 0076](./0076-control-room-for-each-organization.md)
gate question 8 and decisions 1, 8 and 9, [ADR 0079](./0079-fixed-plant-mimic-widget.md)
decision 4 and [ADR 0081](./0081-mimic-layout-builder.md) decision 10 (see
*Amended records*); Amendment 2 narrows [ADR 0049](./0049-section-dashboard-templates.md)
decision 6 for a site-layout copy. Amendment 3 (accepted 2026-10-01) creates row `F3.77`. Promotes nothing out of `AGENTS.md` §6. `F3.72` ships in
the first stable version (gate question 9); `F3.73`–`F3.75` start after it.

## Context

**The owner's observation.** The product has three places that show
dashboards, and a user cannot tell which one to open first:

- `/` (`DashboardPage`) — every organization together: estate KPI tiles,
  location cards grouped by organization, Asset health and the 60-minute load
  trend. A location card opens `/locations/:id/dashboard`
  (`LocationDashboardPage`): KPI tiles, the RTU list and filter, the asset
  table with pages, the image gallery, work orders and module links.
- `/control-room` → `/control-room/org/:id` → `/control-room/site/:id`
  (ADR 0076) — no estate level. The same `LocationKpiCard` opens the site view
  here (`to` is overridden), so one site has two different drill-downs. The
  site view is `generated`, one `dashboard`, or `builtin` (the seven SMOC
  pages, `RSMOC-WC` only).
- `/dashboards` — the library and the builder (ADR 0047).

**The owner's target for the site level.** The SMOC layout of `RSMOC-WC`
(Overview plus one tab for each area) is the operations layout for every site
of every organization, made through the custom dashboard module.

**What the code can do today (measured 2026-09-30 at `e46d04cb`).**

- A site shows **one** dashboard (ADR 0076 decision 8). A dashboard has no
  tabs.
- The SMOC pages are hand-written React under
  `apps/web/src/components/control-room/smoc/` (about 4,100 lines), bound to
  about 40 literal `CR-*` asset codes of `ESKOM`
  (`components/live-svg/control-room-bindings.ts`).
- The builder has six widget types (`widgetTypeSchema`: `radial_gauge`,
  `tank_level`, `value_tile`, `chart`, `table`, `mimic`). The SMOC Overview
  also uses parts that are not widgets: `ActiveAlarmsRail`, `StateLegend`,
  `AssetClassStrip`, `ModuleSummaryCard`, `CriticalSystemsSummary`.
- A section template instantiates against **one asset group** (ADR 0049). No
  template targets a site (ADR 0076 decision 8 deferred it).
- The electrical mimic draws a distribution train (ADR 0082), but live breaker
  state, energised paths and bus topology are out of scope (ADR 0081 decision
  10, ADR 0082 decision 7).
- A `mimic` widget is refused on a dashboard that is not scoped to an asset
  group (`DashboardsService.putWidgets`, `MIMIC_SCOPE_MESSAGE`).

## Gate questions

Scope, 2026-09-30, after the owner reviewed the layout demo:

1. **One section or three?** **Ruled: one section** with drill-down:
   estate, then organization, then site. `/dashboards` stays as the library
   and the builder.
2. **What does the site level look like?** **Ruled: the SMOC layout, for
   every site**, made through the custom dashboard module.
3. **Delivery.** Options: three phases; one build; two phases. **Ruled:
   three phases** (`F3.73` is decisions 4–7, `F3.74` is decision 8, `F3.75`
   is decision 9).
4. **Can an admin change the layout of one site?** Options: a copy for each
   site; a locked standard; a locked standard plus extra tabs. **Ruled: a copy
   for each site** that an admin can edit. A later change to the template does
   not overwrite an edited copy (the ADR 0049 instance rule).
5. **When does `RSMOC-WC` move onto the template?** Options: after parity; in
   phase 1; never. **Ruled: after parity** (phase 3). Until then it keeps its
   hand-written pages.
6. **The name of the menu entry.** Options: Control Room; Operations;
   Dashboard. **Ruled: "Control Room".**
7. **A user with one organization skips the estate level.** Options: move the
   estate panels down; no skip at estate; keep as is. **Ruled: keep the skip,
   and the organization level also shows Asset health and the load trend** for
   that organization.

Four more, the same day, after the draft found that a site-scoped dashboard
cannot hold a mimic (ADR 0079 decision 4). The demo had tagged the domain-tab
mimic as existing; that tag was wrong, and the owner was told before this
question:

8. **How does a mimic work on the site dashboard?** Options: each tab binds
   one asset group; each mimic widget names a group; no mimic on the site
   dashboard. **Ruled: each domain tab binds one asset group** of the site
   (decision 5).
9. **When does `F3.72` ship?** Options: after the first stable version; in
   it. **Ruled: in the first stable version** (merge cutoff 2026-09-30).
10. **Is the critical-systems list in phase 1?** **Ruled: yes** (decision 6).
11. **What does `/` do?** Options: show the user's Control Room entry level;
    redirect to `/control-room`. **Ruled: `/` shows the entry level**
    (decision 2).

## Decision

### The section (`F3.72`)

1. **One menu entry, "Control Room"**, with four levels. The "Dashboard" menu
   entry is removed.
   - **Estate** — the content of `/` today: the estate KPI tiles, one card
     for each organization, Asset health and the load trend. This level is the
     entry for a user whose scope holds more than one organization.
   - **Organization** — ADR 0076 decision 2, plus Asset health and the load
     trend for that organization (gate question 7).
   - **Site** — the site view. It gains an **"Assets & RTUs"** tab that holds
     the content of `/locations/:id/dashboard` without change.
   - The level-skip rule of ADR 0076 decision 2 stays.
2. **The old addresses keep working.** `/locations/:id/dashboard` redirects to
   the site's "Assets & RTUs" tab. `/` shows the user's Control Room entry
   level (estate, organization or site, by the level-skip rule) without a
   redirect, so the login landing does not change (gate question 11).
3. **Each level lists the dashboards for its scope** from the library, with a
   link to open each in `/dashboards`. The library itself does not change.

### The SMOC standard site template (`F3.73`, phase 1)

4. **A dashboard can have tabs.** The site view renders one dashboard with its
   tabs. The standard tab set is **Overview, then one tab for each asset
   domain present at the site** (for example `PHEWB`: SLD and ENV;
   `IONX-DEMO`: SLD, Water and ENV). "Assets & RTUs" (decision 1) is a fixed
   tab of the site view, beside the dashboard's tabs. It is not a dashboard
   tab and not a widget.
5. **A site template, "SMOC standard".** It makes one tabbed dashboard for a
   site, scoped to that site, bound through asset-group membership roles and
   point keys, never through asset ids or `CR-*` codes (ADR 0049 decision 4).
   The dashboard is a **copy for the site** that an admin can edit in the
   builder; it carries the template stamp, and a later template version does
   not overwrite an edited copy (gate question 4). **Each domain tab binds one
   asset group of the site** (gate question 8), and the widgets on that tab
   resolve their roles through that group. A `mimic` is therefore allowed on a
   tab that binds a group, and the template carries the mimic layout it names.
6. **New widget types**, extracted from the SMOC Overview and bound to roles:
   the active alarms rail, the state legend, the asset-class strip, the module
   summary card (it opens a tab of the same dashboard) and the critical-systems
   list (gate question 10). `widgetType` stays a closed vocabulary (ADR 0047 decision 2), so each
   type widens `dashboard_widgets_widget_type_check` in a migration.
7. **The generated view stays as the fail-safe** (ADR 0076 decision 5): a site
   with no copy, or whose copy is removed, shows the generated view with a
   notice, never an empty page.

### Later phases

8. **`F3.74` (phase 2) — live breaker state on the electrical mimic**:
   breaker state, energised paths and bus topology, which ADR 0081 decision 10
   and ADR 0082 decision 7 left out. This row needs its own ADR before build.
9. **`F3.75` (phase 3) — `RSMOC-WC` onto the template**, only when the
   template shows everything the seven SMOC pages show today (gate question
   5). Then the hand-written SMOC pages and the `builtin` view kind are
   removed; the `/cr-*` redirects stay.

### Amended records

10. This record amends:
    - **ADR 0079 decision 4** (a mimic only on a dashboard scoped to one asset
      group): a mimic is also allowed on a dashboard tab that binds one asset
      group (decision 5).
    - **ADR 0081 decision 10** (no layouts in dashboard templates): the site
      template may name a mimic layout (decision 5).

    And ADR 0076:
    - **Gate question 8** ("reuse their reads; both pages stay"): `/` and
      `/locations/:id/dashboard` become levels of the Control Room
      (decisions 1 and 2).
    - **Decision 1**: the Control Room entry also replaces the "Dashboard"
      entry.
    - **Decision 8** (one dashboard, no site target for templates): a site
      shows one **tabbed** dashboard, and the site template is in scope
      (decisions 4 and 5).
    - **Decision 9** (built-in SMOC): the `builtin` kind is retired in phase 3
      (decision 9).

### Design questions for the step-3 plan

11. Not decided here; each plan puts them to the owner:
    - How tabs are stored (a column on `bms.dashboard_widgets`, or a new
      `bms.dashboard_tabs` table), and how a tab stores its asset group.
    - How a template names a mimic layout, and how the copy gets a layout
      for its own organization (a layout is a tenant row, ADR 0081).
    - How the site template is stored (a target on `bms.dashboard_templates`,
      or a new table), and whether its content can name several asset groups.
    - When the copy is made: at site creation, by a backfill for the existing
      sites, by an admin action, or all three.
    - How a site view row points at the copy (`bms.site_control_room_views`
      `kind = 'dashboard'`, or a new kind).
    - The exact content of the Overview tab and of each domain tab.

## Consequences

- **One place to start.** A user opens "Control Room" and drills down. The
  library stays for authors and for dashboards that are not a site layout.
- **Schema changes** in `F3.73` (tabs, the site template, the widened
  `widgetType` CHECK) go through `migration-reviewer` and `security-reviewer`
  (tenant isolation on each new table, ADR 0043/0045).
- **`F3.72` needs no schema change** and ships in the first stable version,
  before `F3.73`. Until
  `F3.73` lands, a non-SMOC site keeps its generated or dashboard view.
- **Two implementations of the SMOC layout exist until phase 3**: the
  hand-written pages for `RSMOC-WC` and the template for every other site.
- **Open elsewhere:** the "Domain-first navigation IA" decision
  (`docs/BACKLOG.md`, raised 2026-08-16) also touches the sidebar. This record
  does not settle it.
- **`chore(agents):` owed** after `F3.72` lands: `AGENTS.md` names `/` as the
  dashboard and the Control Room as a separate entry. That sweep is a separate
  PR (§9.10).
- **Reference:** the owner-reviewed layout demo is the canvas artifact
  "Unified Operations Demo" (version 3, 2026-09-30). Its menu label
  "Operations" is superseded by gate question 6.

## Amendment 1 (2026-09-30, `F3.73`) — decision-11 rulings

The owner ruled each design question of decision 11 on 2026-09-30, one at a
time, after a research pass at `main` `9a03f67a`. The owner then approved the
step-3 plan (`docs/plans/f3.73-smoc-site-template.md`), including every plan
decision listed below. The rulings settle decision 11; decisions 4 to 7 stand.

**When `F3.73` ships (owner ruling, 2026-09-30).** The *Status* section says
`F3.73`–`F3.75` start after the first stable version. The owner ruled that a
complete `F3.73` pull request — green and reviewed — may merge before the v1
merge cutoff (2026-10-01 13:00 IST; first set at 09:00, moved twice by the owner the
same day), each on the owner's explicit merge. A pull request that is not
complete by then waits for v1. `PR4` merges only together with `PR5` (owner
ruling 2026-10-01): its seed points demo sites at tabbed copies that only
`PR5`'s web can draw. `F3.74` and `F3.75`
are unchanged.

### Rulings

1. **Q1 Tab storage — a tabs table and a database rule.** New
   `bms.dashboard_tabs` (`id`, `organization_id`, `dashboard_id` ON DELETE
   CASCADE, `tab_key`, `label`, `sort_order`, `asset_group_id` NULL = Overview,
   ON DELETE RESTRICT). `dashboard_widgets.tab_id` is nullable (NULL = legacy
   single canvas) with a composite FK `(dashboard_id, tab_id)` →
   `dashboard_tabs(dashboard_id, id)`. The same-location rule (a tab's group is
   at the dashboard's site) is held **in the database**: `UNIQUE (id,
   location_id)` on `asset_groups` and on `dashboards`, and composite FKs from
   the tab, so a later PATCH of the dashboard's location fails `23503` and
   answers 400. FORCE RLS with legs: own organization, parent dashboard, asset
   group.
2. **Q2 Mimic — presets in the template.** Each domain tab's mimic is
   `{source:'preset', preset:<domain>}`. No layout is copied. An admin can
   switch a copy's mimic to a drawn layout in the builder later.
3. **Q3a Template storage — a target column.** `bms.dashboard_templates.target`
   (`'asset_group' | 'site'`, default `'asset_group'`). Content gains optional
   `tabs`; old rows still parse. Instantiate gains a site arm. Versions, stock
   import, RLS and the `template_id` stamp are reused.
4. **Q3b Tab group — a domain column plus an override.** Nullable
   `asset_groups.domain`, an FK to `bms.asset_domains(code)`, filled for seeded
   groups. The copy action picks the group of each domain automatically. If a
   domain has two groups at the site, the admin picks one in the action, and a
   bulk run skips that site and reports it.
5. **Q4 Copy timing — a per-site action, a bulk action and seed demo sites.**
   The per-site "Make site layout" button sits on the no-copy notice (one
   transaction: copy from the organization's **published** site template, point
   the site view at it; never replaces a builtin row or an existing row). The
   bulk organization action is the backfill (one transaction per site; it skips
   sites that have a row and `RSMOC-WC`, and reports the skips). The seed makes
   copies only for seed-owned demo sites (PHEWB pump stations, CSMOC Gauteng)
   through the same shared planner. **Not** at site creation, **not** at
   onboarding, **not** in a migration.
6. **Q4b No groups — the action makes groups.** One group per asset domain at
   the site (`code` = domain, `domain` set), the site's assets of that domain
   as members, in the same transaction. Roles stay empty until an admin sets
   them.
7. **Q5 Site view — keep kind `dashboard`.** No change to
   `site_control_room_views`. The web knows a copy by the template stamp (the
   DTO exposes `templateId`) and shows tabs. One new closed notice value,
   "no site layout yet", only at a site with no view row in an organization
   that holds a published site template.
8. **Q6a Status — alarms and offline.** A module card and a critical-systems
   row show the worst active alarm severity in the tab's group plus the offline
   asset count, computed on the server. There is no rule-match state (breaker
   state is `F3.74`).
9. **Q6b Content — the proposed layout.**
   - Overview (no group): a state legend; four value tiles on site metrics
     (Active alarms `alarms.active.count`, Total load kW `sustainability.total`
     kw sum, Asset health `assets.health.score`, Offline assets
     `assets.offline.count`); an asset-class strip; an active-alarms rail; one
     module summary card per domain tab (it opens that tab); a critical-systems
     list.
   - Domain tab (one group): four role-bound value tiles (SLD: incomer kW, PF,
     frequency, main bus kW; UPS: load %, backup minutes; HVAC: supply and
     return air, cooling kW; ENV: average temperature, humidity; Water: inlet
     flow, tank level); the domain preset mimic; an active-alarms rail scoped to
     the group; a table of the group's assets.
   - The seed gives roles to UPS, battery, HVAC, IT and environment assets
     (matched on asset code for `CR-UPS` and `CR-BATT`, which are in the
     electrical domain).
10. **Q6b correction — add `assets.offline.count`.** A new catalog metric with
    the same site and group scope as `alarms.active.count`. It reuses the server
    offline count of Q6a.

### Owner answers to the plan's open questions (2026-09-30)

- **OQ1 + OQ2 — a template tab's `groupCode` breaks the tie.** Ruling Q3b (one
  group per domain, the admin picks) and the Q6b layout (a UPS tab) disagree
  where one domain has two groups at a site (`electrical` and `ups-battery`).
  The template names the group; the admin picks only when the named group is
  absent and two candidates remain. The `ups` and `it` tabs stay, and every
  seeded site resolves with no choice.
- **OQ3 — a new `site` row ("Site layouts")** in `dashboard_sections`.
- **OQ4 — the newest published** `target='site'` template of the organization,
  for the per-site button only.
- **OQ5 — not an owner question.** Whether the `dashboard_widgets` policy gains
  a tab leg is `security-reviewer`'s call on PR1. If it asks, it is one
  statement in migration `0094` before merge.
- **OQ6 — two new role codes**, `leak-sensor` and `smoke-detector`, in
  migration `0095`, given to the seeded `CR-LEAK-*` and `CR-SMOKE-*` sensors.
  Leak and smoke datasets and tables stay `F3.75`.
- **OQ7 — 40 widgets per tab and 8 tabs per dashboard.** A dashboard with no
  tabs keeps 40.

### Plan decisions (approved by the owner on 2026-09-30)

- **D0 File split.** The dashboard DTO block moves from
  `packages/shared/src/contracts/dashboard-builder.ts` to a new
  `dashboard-dto.ts`, before PR1, so the builder contract file stays under the
  1000-line cap.
- **D1 Tabs table.** The Overview tab stores `location_id NULL`, so its
  composite FK is inert and a dashboard with only an Overview tab can still move
  scope. The `dashboard_widgets` policy is **not** re-created: the composite FK
  pins a widget's tab to its own dashboard and the existing policy already
  checks that dashboard's organization (see OQ5).
- **D2 Per-tab cap.** The 40-widget cap applies per tab and to the legacy
  canvas; at most 8 tabs (OQ7).
- **D4 Section row.** A new `site` row in `dashboard_sections` gives the NOT NULL
  `section` an honest value. `target` is the behaviour switch; `section` stays
  display grouping (OQ3).
- **D5 Group picking.** A tab whose domain has no group at the site is
  **omitted**. Every Overview `module_summary_card` whose target tab is omitted
  is **dropped** and reported. The tie-break order per tab is: the admin's
  choice; the untaken group of the tab's domain whose code equals the tab's
  `groupCode`; the single untaken candidate; else ambiguous (per-site: the admin
  picks; bulk: skip and report).
- **D6 Three routes, one service.** `POST /admin/locations/:id/site-layout`,
  the site arm of `POST /admin/dashboard-templates/:id/instantiate` and
  `POST /admin/dashboard-templates/:id/apply-to-sites` (bulk) all delegate to
  one `SiteLayoutService`. **Removed-copy rule:** a site whose view row is
  `kind = 'dashboard'` with `dashboard_id IS NULL` (an admin deleted the copy
  and `ON DELETE SET NULL` left the row) is a removed copy, not an existing
  view. The action updates that row in place and asserts one row changed; every
  other existing row (builtin, generated, a live dashboard) is refused with 409.
  Ruling Q4 forbids replacing a builtin row or an existing copy, and a removed
  copy is neither.
- **D8 SMOC standard content.** The UPS and IT tabs are gap-fills the Q6b layout
  implies; the `water` tab names `groupCode` `water`. The content is exported
  as the subpath `@bms/shared/site-templates` and is not re-exported from the
  shared index, so the widget configuration stays out of the web bundle.
- **D12 Seed.** Seed ownership is per organization (ESKOM: the CSMOC Gauteng
  identity, never `RSMOC-WC`; PHEWB: the six pump stations). The seed passes
  explicit group choices. `IT_LOAD` keeps a NULL domain (a formula group, not a
  domain group). `demo-water-plant` gets `domain = 'water'`. The verifier counts
  view rows on the seed-resolved locations, never dashboard slugs.
- **`assets.list` dataset.** It has no `role` column; the resolver signature
  returns asset ids only. A role column on the group assets table stays
  `F3.75`.

## Amendment 2 (2026-10-01, `F3.73`) — a copy leaves out a tile that binds nothing

An Impeccable design critique of the merged `F3.73` layout (`main`
`6d4d0505`) found role value tiles that show only a dash on a seeded site:
a tile whose role has no member at the site, or whose members carry none of its
point keys (for example *Cooling kW* on a site with no CRAC). The owner asked
for every implementation finding to be fixed, and on 2026-10-01 ruled that the
copy rule below stands and is recorded here. Decisions 4 to 7 and Amendment 1
are otherwise unchanged.

- **The omission rule.** A site-layout copy leaves out a `value_tile` that has
  role bindings, no catalog source, and resolves **zero** points at the site
  (`isUnboundRoleTile` in `packages/shared/src/site-layout-planner.ts`). Every
  other widget type, and a tile with a catalog source, is copied as before. The
  rest of the tab is packed left in template order (`packAfterRemoval`), so the
  copy has no hole and no tile overlaps a tall neighbour. This extends plan
  decision D5, which until now left out only a whole tab and its Overview
  cards.
- **Reported, never silent.** The `201` body of
  `POST /admin/locations/:id/site-layout` (and each `made[]` entry of
  `apply-to-sites`) carries `omittedTiles: { tabKey, widgetKey }[]` beside
  `droppedCards`, and the audit row records the same tiles as `tabKey/widgetKey`
  strings. The seed writes no audit row; its return value (`made[]`) lists them. ADR 0049 Amendment 2
  decision 1 (a per-widget report) is kept: a tile left out is named in the
  answer, not lost.
- **ADR 0049 decision 6 is narrowed, not reversed.** Instantiating a
  `target = 'dashboard'` template still imports a widget with zero bindings.
  Only a site-layout copy (the three routes of plan decision D6, and the seed),
  which knows the site, leaves an unbound role tile out. Once a point exists at
  the site, an admin can add the tile in the builder and bind it.
- **The seed applies the same rule to its own copies.** On a database that ran
  an earlier seed, `planCopyPackUpgrade` (`packages/db/src/site-layout-seed-upgrade.ts`)
  deletes an unbound role tile and packs the tab **only** while that tab holds
  exactly what the seed wrote: every template widget once, at its stock rect,
  and the deleted tile holds no point row and no source row. The delete repeats
  the rect and the empty bindings in its predicate, so a tile an admin moved or
  bound since the read stays. A tab an admin changed is left whole. The step is
  idempotent: a packed tab no longer stands at the stock rects.

## Amendment 3 (2026-10-01, `F3.77`) — the site Overview leads with alarms, and a wall mode

**Status: accepted** — the owner approved this written record on 2026-10-01.

An Impeccable critique of the site layout (2026-10-01, 20/40) found that the
Overview hides the alarms and shows each domain's status three times. After the
critique fixes merged (#681, `b21eadad`), the owner shaped a redesign with
`/impeccable shape` and confirmed the brief on 2026-10-01
(`docs/plans/f3.73-overview-shape.md`; product record `apps/web/PRODUCT.md`).
The owner ruled each question one at a time. This amendment creates row
**`F3.77`** for the build. Decisions 4 to 7 and Amendments 1 and 2 are
otherwise unchanged.

### Rulings

1. **Users.** The site Overview serves the shift operator and the site engineer
   with equal weight. The normal view serves both; wall mode serves the
   operator on a wall screen.
2. **No colour change.** The palette, the state colours, the brand accent and
   the ADR 0085 surfaces stay as they are. The owner declined an ISA-101
   grey-for-normal conversion.
3. **SMOC standard stock v3, Overview tab only.** The Overview reads, top to
   bottom: problem tiles (Active alarms, Offline assets, Total load, Asset
   health); the active alarms rail (8 columns) beside one Systems list
   (4 columns); the asset-class strip; the state legend last, as one compact
   row. The domain tabs do not change.
4. **One status, shown once.** The Systems list is the `critical_systems_list`
   widget, with one row per domain tab: status, counts and an Open link. It
   replaces both the module cards and the critical-systems list on the stock
   Overview. `module_summary_card` stays in the widget vocabulary for admins.
   The alarm rail is the only alarm list on the Overview.
5. **Tab status markers.** Every group tab of a tabbed site dashboard shows a
   marker in the tab's tone (the server's `tabTone`) and its count of active
   alarms, as text as well as colour, in the site view, the viewer and the
   builder. The Overview and "Assets & RTUs" have no status and no marker. A tab
   whose members the caller cannot read shows "Outside scope", never a zero.
   The data is the existing Overview read (`tabs[]`); there is no new endpoint.
6. **A seventh widget icon, `offline`.** The closed icon vocabulary
   (`widgetIconSchema`) gains `offline`. It is widened together with the web
   icon map (`apps/web/src/components/widget-icon.tsx`) and the F3.35 tile-icon
   gate (`tests/f3.35-tile-icon-vocabulary.test.ts`). The Offline assets tile
   uses it, so the tile no longer shares `alert` with Active alarms.
7. **Wall mode, a toggle on the site view.** `?wall=1` hides the app shell and
   enlarges the type. A thin top bar shows the site name, a live clock and the
   time of the newest read. The mode rotates through the site's dashboard tabs
   (not "Assets & RTUs"), every 30 s by default (choices 15, 30, 60 and 120 s),
   with equal turns for every tab. A key press or a click pauses it; a visible
   control resumes it. The URL keeps the mode, the interval and the tab
   (`?wall=1&every=30&tab=<key>`); an unknown value falls back to the default.
8. **No auth change for wall use.** When the API answers 401, wall mode shows a
   full-screen "Session ended — sign in" state, never the last data as if it
   were live. After sign-in, the app returns to the same wall URL: the web
   keeps the return path (today `login-page.tsx` always goes to `/`). This is a
   web-only change to the sign-in redirect. It accepts a same-origin path only
   (no open redirect), and it does not change the token or the session
   lifetime. A lost socket or stale reads show in the top bar, by the existing
   stale rule. A long-lived wall session is not in scope; it would need its own
   ADR.
9. **v3 reaches existing copies only where they are untouched.** The seed
   upgrades a seeded copy's Overview tab to v3 only while that tab holds
   exactly the v2 content at the rects its own site-layout copy wrote,
   **including the packing of Amendment 2**. Each site packs its cards
   differently, so the gate compares with that site's own packed plan, not with
   the raw template. An Overview that an admin changed stays as it is. A copy
   made after v3 gets v3. The seed supersedes its own stock template row
   whenever that row's `stock_version` is below the current one (not only for
   v1), and archives it under the same rule as v1 was: only when the
   organization's newest `smoc-standard` row is the seed's own.
10. **Order with `F3.74`.** `F3.74` (ADR 0088) also changes the stock
   template: its SLD tab gets the `lv_single_line` preset and a breaker
   table, and the Overview gets a compact SLD mimic about 6 columns wide. ADR
   0088 says only "a new published version", so the order is recorded here
   (agreed 2026-10-01 with the `F3.74` work, which notes it in its own plan):
   `F3.77` takes stock v3 and makes the seed-upgrade predicate general (ruling 9);
   `F3.74` rebases onto it and takes v4. The compact SLD goes in the row below
   the alarms rail and the Systems list, in the left half; in v4 the
   asset-class strip moves to the right half of that row. In v3 the strip
   spans the full width.

### Out of scope

The colours and tokens; auth and the session lifetime; the content of the domain
tabs; the mimic (`F3.74`, ADR 0088); `RSMOC-WC` (`F3.75`); the generated view.

### Consequences

- The stock template is content: v3 bumps `stockVersion` to 3 in
  `packages/shared/src/site-templates/smoc-standard.ts`, and the seed upgrade
  (`packages/db/src/site-layout-seed-upgrade.ts`) gains a v2 → v3 step for the
  Overview tab.
- A widened icon vocabulary is a contract change (ADR 0030); the web and the
  API deploy together.
- Wall mode is a view of the existing site view. It adds no route, no API and
  no role gate. The only sign-in change is the same-origin return path (ruling
  8).
