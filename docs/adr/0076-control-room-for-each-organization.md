# ADR 0076 — A Control Room for each organization (`F3.66`–`F3.70`)

## Status

Accepted — drafted on 2026-09-25 from an owner observation, before any
implementation code. Eight scope questions and eight design questions were put
to the owner one at a time; all were ruled, and each ruling is recorded under
*Gate questions*. The owner reviewed and approved this written record on
2026-09-25.

Creates rows `F3.66`–`F3.70` and `F4.157` (the last with its own ADR, see
decision 12). Promotes nothing out of `AGENTS.md` §6. Retires the interim gate
`F4.156` when `F3.70` lands.

## Context

**The owner's observation.** `phe-admin@bms.local` (`organization_admin`,
organization `PHEWB` — Public Health Engineering, West Bengal) sees the whole
*Control Room 2D* menu and every `/cr-*` page. Those pages are the Eskom SMOC
data-centre control room. The owner's ruling: a user sees the control room of
their own organization, never another organization's.

**What the code does today (measured 2026-09-25 at `644be4e5`).**

- `apps/web/src/layouts/app-shell.tsx` `isVisible` gates `/cr-*` only for
  `scope.kind === "asset_group"`. The seven routes in `apps/web/src/app.tsx`
  check only for a login. `F4.156` closes this as an interim gate.
- The seven pages bind about 40 literal `CR-*` asset codes
  (`apps/web/src/components/live-svg/control-room-bindings.ts`). All 43 `CR-*`
  assets belong to `ESKOM` and sit at one location, **`RSMOC-WC`** (RSMOC
  Western Cape).
- **Not a data leak.** `GET /api/v1/assets`, `GET /api/v1/rules`,
  `points/:ref/recent`, `points/at-instant` and `/ws/telemetry` all filter by
  `readableAssetIds`. The PHE user gets the Eskom layout, labels and ratings
  from the bundle, with empty values.

**What PHEWB has.** Six pump-station locations (Lotapata, Bilsi, Salkumarhat,
Mora Nodir Kuthi, BhutnirGhat, Banchukamari), 50 assets (38 `electrical`, 12
`environment`), 252 points. **None of the 50 assets has a `template_id`**, so a
site view cannot be derived from asset templates (ADR 0067). Each location has
two asset groups: *Electrical* (6–8 members, roles set) and *Environment* (2
members, no roles).

**What already exists and is reused.**

- `/` (`DashboardPage`) groups location cards by organization from
  `GET /api/v1/dashboard/locations`. `/locations/:id` (`LocationDashboardPage`)
  shows one site from `GET /api/v1/dashboard/locations/:locationId`.
- `bms.dashboards` carries `location_id`, `asset_group_id`, `asset_id` with
  `dashboards_scope_check` (at most one). The viewer route renders any
  dashboard (ADR 0047).
- Section templates (`F3.36`, ADR 0049) instantiate against **one asset group**
  (`dashboard-templates-instantiate.service.ts`), resolving widget bindings
  through membership roles (`F3.37`).
- `ActiveAlarmsRail` (`F3.28`, ADR 0074) takes an explicit asset set, as ADR
  0074 decision 2 designed it to.
- `bms.point_keys` is a lookup table (`code`, `name`, `domain`, `unit`) with an
  admin page at `/admin/point-keys`.
- `F3.32` (mimic builder) is ⬜ with no ADR. ADR 0049 already requires its
  nodes to bind to a membership role, not an asset id.

## Gate questions

Scope, 2026-09-25:

1. **How is the defect resolved?** Options: a data gate only; the gate plus a
   PHE dashboard built by hand; a control room for each organization.
   **Ruled: a control room for each organization.**
2. **What does a Control Room show?** **Ruled: an organization overview, then
   a drill-down to each site.**
3. **How does a site view scale to a new organization with different
   assets?** Options: a generated view plus an optional template; template
   only; a drawn mimic. **Ruled: generated view plus optional template.** The
   owner added: the `F3.32` mimic must be usable inside the templates, and so
   inside a control-room site view (decision 7).
4. **Menu shape.** **Ruled: one "Control Room" entry with drill-down**, not
   one entry for each site.
5. **What does a global admin see first?** **Ruled: an organization list; any
   level with one item is skipped.**
6. **The seven SMOC pages.** **Ruled: they become the built-in site view of
   `RSMOC-WC` only.**
7. **The period before this lands.** **Ruled: ship the interim gate `F4.156`
   now.**
8. **Overlap with `/` and `/locations/:id`.** **Ruled: reuse their reads; both
   pages stay.**

Design, 2026-09-25:

9. **Site view setting (section 2).** Ruled as decisions 3–6 below.
10. **Generated view layout.** **Ruled: site KPIs, then one panel for each
    asset domain, one card for each asset.**
11. **Main points on a card.** **Ruled: a rank on `bms.point_keys`**, not a
    list in code, not all points.
12. **Dashboard site view in v1.** **Ruled: one dashboard for each site**,
    scoped to the site or to one of its groups. Templates get no site target.
13. **Old `/cr-*` addresses.** **Ruled: tabs under the site route; `/cr-*`
    redirects.**
14. **SMOC access rule.** **Ruled: a user who can read the site opens it**, the
    same rule as every site view.
15. **Who sees the Control Room menu.** **Ruled: every role with a non-empty
    scope.**
16. **Location type.** The PHE sites carry type `rsmoc` because the type is a
    fixed Eskom list. **Ruled: a separate row and ADR (`F4.157`), in
    parallel.**

## Decision

### Routes and shell (`F3.66`)

1. **One menu entry, "Control Room"**, visible to every role whose scope is not
   `none`. It replaces the *Control Room 2D* group.
2. **Three levels, each skipped when it holds one item:**
   - `/control-room` — the organization list: a card for each readable
     organization with its site count, sites online and active alarms. Built
     from `GET /api/v1/dashboard/locations`, grouped by organization as `/`
     already does.
   - `/control-room/org/:organizationId` — the organization overview: a card
     for each readable site with live status and KPIs, and `ActiveAlarmsRail`
     over that organization's readable assets.
   - `/control-room/site/:locationId` — the site view (decisions 3–8).

   A user whose scope holds one organization lands on its overview; a user
   whose scope holds one site lands on that site. A breadcrumb names the
   levels above.

### The site view setting (`F3.67`)

3. **New table `bms.site_control_room_views`**, at most one row for each site:
   `location_id` (primary key, FK `bms.locations`), `organization_id` (for the
   `tenant_isolation` RLS policy, as on `bms.locations`), `kind`,
   `dashboard_id` (FK `bms.dashboards`, set only when `kind = 'dashboard'`),
   `builtin_key` (set only when `kind = 'builtin'`), `updated_at`,
   `updated_by`. **A site with no row shows the generated view** — no backfill,
   no admin action for a new organization or site.
4. **`kind` (`generated` | `dashboard` | `builtin`) and `builtin_key`
   (`smoc`) are CHECK constraints, not lookup tables.** Every value needs code
   to render it, so a new value is always a release. This is the ADR 0047
   `widgetType` reasoning; the dynamic-vocabulary rule applies where behaviour
   can be data, and here it cannot.
5. **Cross-table rules are enforced in the API service**: the dashboard
   belongs to the same organization, and is scoped to that site or to one of
   the site's asset groups. **Fail safe:** a removed dashboard or an unknown
   built-in key renders the generated view with a notice, never an empty page.
6. **Who may change it:** the master-data roles that may edit the site —
   `admin`, `organization_admin`, `location_admin` within their scope. Each
   change is audited. The control is a "Control Room view" field on the
   location admin page. The seed sets `RSMOC-WC` to `builtin` / `smoc`
   (Eskom demo data belongs in the seed, not the migration).

### The three site view kinds

7. **Generated (`F3.68`).** The site KPIs from the `/locations/:id` read; then
   one panel for each asset domain present at the site; one card for each
   asset with its live status (the ADR 0027 staleness gate) and its main
   points, live over `/ws/telemetry`. **Main points** come from a new column
   `bms.point_keys.headline_rank smallint NULL`: a card shows its four
   highest-ranked points and an "All points" link; an asset with no ranked
   point shows its first four points by `point_key`. The seed ranks `kw`,
   `kwh_total`, `pf`, `frequency_hz` and the on/off points (`*_on`,
   `breaker_*`). Ranks are edited on `/admin/point-keys`.
8. **Dashboard (`F3.69`).** The site view renders one existing dashboard in
   the dashboard viewer. v1 adds no site target to section templates: an admin
   who wants several asset groups in one view builds one site-scoped dashboard
   in the builder. **The `F3.32` mimic arrives as a widget type** in the ADR
   0047 builder, bound to membership roles (ADR 0049); it therefore appears in
   templates, in dashboards and in this site view with no change here. `F3.32`
   keeps its own row and needs its own ADR.
9. **Built-in SMOC (`F3.70`).** For `RSMOC-WC` only. The seven pages become
   tabs at `/control-room/site/:locationId/{overview,sld,ups,battery,hvac,env,it}`.
   The `/cr-*` routes redirect there. The per-area rule for asset-group users
   (`lib/control-room-access.ts`) stays on the tabs. **Access is "can read the
   site"**, which replaces `F4.156`'s "can read a `CR-*` asset" rule; `F3.70`
   removes that gate. The `CR-*` bindings stay (ADR 0074 decision 2).

### Order

10. `F3.67` first — every other row reads its setting. Then `F3.66` and
    `F3.68` in parallel. Then `F3.69` and `F3.70`.
11. Tenant isolation is proved at each layer, not assumed: an integration test
    for the setting's RLS and service rules, jsdom specs for the level skip and
    the fail-safe, and a browser run as `phe-admin` and as `admin`.
12. **`F4.157`** — the location type becomes a lookup table so a PHE site can
    be a pump station, not `rsmoc`. About ten places hold the fixed list
    (`locationTypeSchema`, the shared contracts, onboarding, the map, the admin
    page, the seeds). It gets its own ADR and runs in parallel; the Control
    Room does not read the location type.

## Consequences

- **A new organization needs no release and no configuration** to get a
  working Control Room: the generated view renders from its assets and points.
  An admin improves a site by pointing it at a dashboard.
- **Two schema changes**: `bms.site_control_room_views` (`F3.67`) and
  `bms.point_keys.headline_rank` (`F3.68`). Both go through
  `migration-reviewer`.
- **The `/cr-*` addresses become redirects.** Saved links keep working. The
  seven page files move under the site route; their content does not change.
- **The *Control Room 2D* menu group is removed** (`F3.66`), and with it the
  menu half of `F4.156`.
- **Deferred:** a site target for section templates (ruled out of v1); several
  dashboards for one site; the mimic builder itself (`F3.32`); moving the SMOC
  pages to a template with a mimic (a later row, after `F3.32`).
- **Merge skew:** `F3.30` (ADR 0075) edits `app-shell.tsx` for its status
  footer, and `F4.156` edits the same file. Whichever merges second rebases.
- **`chore(agents):` owed** after `F3.66` lands: `AGENTS.md` names the
  control-room pages by their `/cr-*` routes (the `F3.28` status block near
  L550–L575, the Phase 5 history near L616–L671, and the §2 *Operations* row).
  Those lines and the status line need the new routes, as a separate PR
  (§9.10).

## Amendment 1 (2026-09-26, F3.68)

Owner ruling on a stale point's value in the generated site view: shown,
dimmed, rather than blanked. This departs from ADR 0027 decision 3 for this
view only; every other page keeps decision 3 as written.

## Amendment 2 (2026-09-26, F3.68)

1. **A third schema change: `bms_tenant` may not set `headline_rank`.**
   Decision 7's column lives on the fleet-wide `bms.point_keys`, and ADR 0051
   Amendment 1 decision 1 leaves `bms_tenant` a table-level `INSERT` there so
   onboarding can extend the catalog. That `INSERT` covered the new column, so
   an organization's onboarding path could have set a fleet-wide display rank.
   Migration `0084` adds `bms.point_keys_refuse_tenant_headline_rank()` and its
   `BEFORE INSERT` trigger, which raise `42501` when `current_user` is
   `bms_tenant` and `NEW.headline_rank` is not null. Every other writer (the
   admin API on the fleet pool, the seed, the migrator) is unchanged.
2. **A trigger, not a column grant** (owner ruling). A column-level `INSERT`
   grant that leaves out `headline_rank` refuses the whole onboarding insert:
   Drizzle names every column, the unset ones as `DEFAULT`, and Postgres checks
   the privilege of every named column. A column grant would also need a new
   grant for every later column on this table.
3. **Known limit.** The guard names one role. A future login role that inherits
   `bms_tenant` would pass it; today every environment logs in as `bms_tenant`
   itself and no role is a member of it. A deployment that changes that needs a
   follow-up migration.

The generated read's latest-value lookup is bounded to a literal 7-day window
(owner ruling, the same day): a point with no sample in 7 days shows "—". The
unbounded form sorted the whole site history on every request (70 s for
`RSMOC-WC` on the dev database).
