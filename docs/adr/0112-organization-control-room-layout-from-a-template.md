# ADR 0112 — Organization control-room layout from a template (`F4.317`)

## Status

**Accepted — 2026-11-06** (owner; proposed the same day). Source: owner rulings
2026-11-06 on the questions of `docs/plans/f4.317-organization-kpi-strip.md`
§8, asked one at a time. Line citations are to `main` at `a2ec5a4d`. No build
starts before the owner says "yes" to the step-3 plan.

**Implemented — 2026-11-06** as `F4.317` in six PRs: #1067 (migration `0126`),
#1069 (resolvers, prior seam, `kpis()`), #1072 (target, stock template, authoring
grant), #1073 (view service, routes, narrow dashboard grant), #1078 (web) and
#1079 (docs and the Q3 seed). Amendments 1 and 2 below landed with PR 1 and PR 3.
The estate "Sites online" release note (consequences) is in the `F4.317` BACKLOG row.

Promotes nothing out of `AGENTS.md` §6: §6 does not list organization-level
layouts or KPI strips.

| Ruling (2026-11-06) | Decision |
| --- | --- |
| 1 — strip only first; the whole organization page from the template is a later row | 1 |
| 2 — the default holds the estate four, five organization tiles and the cost KPIs | 6 |
| 2b — availability (24 h) is in the default too | 6 |
| 3 — a site is a location, on the organization tile and on the estate tile | 7 |
| 4 — the default is stock content drawn with no row | 3 |
| 5 — a location admin may also change the strip | 5 |
| 6 — "vs yesterday" stays on Total load and Open alarms; add a prior value if the resolver has none | 8 |

## Context

The estate level of the Control Room (`/control-room`, `DashboardPage`) shows a
coded strip of four `KpiTile`s — Total load, Sites online, Open alarms, PUE —
from `GET /api/v1/dashboard/kpis` (`apps/api/src/dashboard/dashboard.controller.ts:27`,
`DashboardService.kpis`, `dashboard.service.ts:461`). The organization level
(`/control-room/org/:organizationId`, `organization-page.tsx`) shows only
`LiveStatusStrip`: the live and not-live site counts (`F4.259`).

The owner ruled that the organization level must show a KPI strip scoped to
that organization, with more organization KPIs, and that the strip must come
from the template system so that every organization has it by default and can
change it later.

The template system has no organization surface. `bms.dashboard_templates.target`
is `'asset_group' | 'site'` (ADR 0087 Amendment 1 ruling Q3a;
`packages/shared/src/contracts/dashboard-templates.ts:333`). The site level has
`bms.site_control_room_views` to point the site page at a dashboard; the
organization level has no pointer. But an organization-wide dashboard already
exists as a shape (`location_id` and `asset_group_id` NULL), and the metric
catalog (ADR 0048) already resolves its widgets over the organization's assets,
intersected with the caller's readable set
(`apps/api/src/dashboard-builder/metric-catalog.service.ts:69-73, 136`).

The catalog cannot give three of the estate tiles: sites live / total, PUE, and
a critical-only alarm count. The catalog is closed in code
(`metricCatalogKeySchema`, `dashboard-builder.ts:641`) and in the database
(`dashboard_widget_sources_catalog_key_check`, last widened in migration `0096`).

Two counts of "sites" disagree today. `kpis()` counts distinct
`bms.assets.site_name` (`dashboard.service.ts:511-513`): the estate shows
"4 / 17". The organization cards count locations from `GET /dashboard/locations`:
10 + 6 = 16.

## Decision

1. **Scope.** This record covers the KPI strip at the top of the organization
   level only. The other sections of the organization page stay coded. A whole
   organization page from a template is a later row with its own record. The
   estate strip stays coded.

2. **A third template target, `organization`.** `dashboard_templates.target`
   gains `'organization'` in `dashboardTemplateTargetSchema` and in any
   database CHECK that holds the list. Its content is the flat `widgets` list.
   The write schema refuses `tabs` on this target, and in this phase refuses
   every widget type except `value_tile`. Versions, publish, archive, stock
   import, RLS and the `template_id` stamp are reused unchanged.

3. **The default is stock content, with no row.** A stock template,
   `organization-standard`, lives in `packages/shared/src/site-templates/`
   beside `smoc-standard.ts`. When an organization has no view row (decision 4),
   the organization page draws the strip from that stock content, resolved
   through the catalog at organization scope. Every organization, new ones
   included, has the strip with no admin action. This is ADR 0076 decision 5's
   fail-safe, one level up. The seed may make copies for demo organizations;
   no migration, site creation or onboarding step makes one.

4. **A pointer table, `bms.organization_control_room_views`.** Columns:
   `organization_id` (PK, FK `bms.organizations`), `dashboard_id` (FK
   `bms.dashboards`, ON DELETE SET NULL), `updated_at`, `updated_by`. FORCE RLS
   on own organization (ADR 0043/0045), tenant-scoped in the creating
   migration. The row points at an organization-wide dashboard copied from a
   published `organization` template. Routes (final names in the step-3 plan):
   read, set ("Make organization layout": copy the published template and write
   the row in one transaction) and delete ("Reset to default"). The instantiate
   service gains an `organization` arm.

5. **Who may change the strip.** A global admin, an organization admin of that
   organization, and a `location_admin` of that organization. The
   `location_admin` grant is narrow: that organization's `organization`-target
   templates, its view row, and the one dashboard the row points at. It does
   not widen the `F3.1d` rule for any other organization-wide dashboard
   (`dashboards.service.rls.integration.test.ts:578`). An asset-group-scoped
   user may not change the strip. Every user who can open the page reads the
   strip, and each tile resolves over that user's readable assets only.

6. **The default tiles** (owner rulings 2 and 2b), in this order:

   | # | Tile | Source |
   |---|---|---|
   | 1 | Total load (kW) | `sustainability.total {kw, sum}` |
   | 2 | Sites live (live / total locations) | new `sites.live.count` |
   | 3 | Open alarms, with the critical count | `alarms.active.count`, new `tone` param |
   | 4 | PUE | new `pue.ratio` |
   | 5 | Energy today (kWh) | `sustainability.total {kwh_today, sum}` |
   | 6 | Water today (kL) | `sustainability.total {kl_today, sum}` |
   | 7 | Assets offline | `assets.offline.count` |
   | 8 | Asset health | `assets.health.score` |
   | 9 | Open work orders | `workorders.open.count` |
   | 10 | Energy cost today | `sustainability.total {energy_cost_today, sum}` |
   | 11 | Water cost today | `sustainability.total {water_cost_today, sum}` |
   | 12 | Energy cost this month | `sustainability.total {energy_cost_this_month, sum}` |
   | 13 | Water cost this month | `sustainability.total {water_cost_this_month, sum}` |
   | 14 | Availability (24 h, %) | `sustainability.total {availability_pct_24h, avg}` |

   A cost tile shows `organizations.currency` as its unit: the cost point keys
   carry unit `""` on purpose (ADR 0070 decision 8,
   `packages/db/src/point-key-units.ts:728-731`). A roll-up tile shows its
   `coverage` when `fresh < carrying`. A tile with no data shows "—" and the
   reason.

7. **A site is a location.** `sites.live.count` counts the locations in scope
   with at least one asset that reports inside the live window
   (`REPORTING_ASSETS_CTE_SQL`), and returns the location total in `coverage`.
   The estate "Sites online" tile moves to the same rule in this row:
   `DashboardService.kpis()` counts locations, not `site_name`. The estate
   tile then agrees with its organization cards.

8. **"vs yesterday" on catalog tiles.** Total load and Open alarms keep the
   delta. If the catalog resolve response has no prior value for a catalog
   source, it gains one, on ADR 0074 decision 5's rule: the same instant 24 h
   before `asOf`, on each metric's own definition.

9. **Catalog changes.** `metricCatalogKeySchema` and the database CHECK gain
   `sites.live.count` and `pue.ratio` (both `shape: "metric"`, no params).
   `alarms.active.count` gains an optional `tone` param (`"critical"` only in
   this phase) in `METRIC_CATALOG_PARAMS_WRITE`, `.strict()`, with no id. The
   containment and label tests are updated with the keys.

## Consequences

- One forward-only migration: the target CHECK (if present), the new table with
  RLS, the catalog CHECK. The migration reviewer checks it.
- The `location_admin` grant (decision 5) is a new write path on an
  organization-wide row. The security reviewer checks it before merge.
- `LiveStatusStrip` leaves the organization page; tile 2 carries its numbers.
- The estate "Sites online" value changes (for example "4 / 17" becomes
  "4 / 16"). This is intended, and the release note says so.
- Deferred: the whole organization page from a template; a "worst site"
  dataset; one total-cost tile over two point keys; widget types other than
  `value_tile` on the `organization` target.
- Amends ADR 0087 (Amendment 1 ruling Q3a, the target enum), ADR 0048 (the
  closed catalog) and ADR 0076 decision 5 (the fail-safe, now at two levels).
- After acceptance: a `docs/BACKLOG.md` row `F4.317`, and a `chore(agents):`
  sweep if AGENTS.md names the template targets.

## Amendment 1 — 2026-11-06

**Owner ruling Q1b (2026-11-06), on the build plan's question 1.** Tile 3 binds
two catalog keys, `alarms.active.count` and a new `alarms.critical.count`. There
is no `tone` param. This supersedes the sentence in decision 9 that gave
`alarms.active.count` an optional `tone` param.

Why: tile 3 binds two sources on one widget (ruling Q1), and the write path
cannot hold the same `catalog_key` twice on one widget.

- `dashboard_widget_sources_widget_key_key UNIQUE (widget_id, catalog_key)`
  (`packages/db/drizzle/0054_dashboard_widget_sources.sql:153`) refuses a second
  `alarms.active.count` row on the widget, whatever its `params`.
- `noDuplicateSources` (`packages/shared/src/contracts/dashboard-writes.ts:318`)
  refuses it in the write contract first.
- The viewer keys a resolved value by `(widgetId, catalogKey)`
  (`apps/web/src/lib/dashboard-widget-data.ts:223`), so two bindings of one key
  on one widget would share one value.

A second key needs none of these to change.

What changes:

- **Decision 6, row 3** now reads: Open alarms, with the critical count —
  `alarms.active.count` + new `alarms.critical.count`.
- **Decision 9** now reads: `metricCatalogKeySchema` and the database CHECK
  gain `sites.live.count`, `pue.ratio` and `alarms.critical.count` (all three
  `shape: "metric"`, no params, `.strict()` `{}` in
  `METRIC_CATALOG_PARAMS_WRITE`). `alarms.active.count` is unchanged.
  `alarms.critical.count` counts the open alarms whose severity has tone
  `critical`. This is the `DashboardService.kpis()` critical predicate
  (`apps/api/src/dashboard/dashboard.service.ts:516`). Migration `0126`'s
  catalog CHECK lists thirteen keys.

## Amendment 2 — 2026-11-06

**Owner ruling (2026-11-06), on the stock strip's tile 6.** Water today binds
`sustainability.total { pointKey: "kl_today", aggregate: "sum", balanceRole:
"intake" }`, as the `sustainability-overview` stock tile does
(`apps/api/src/admin/dashboard-templates/stock-catalog.ts:779`). Only tile 6
changes.

Why: `kl_today` is carried by every water stage's inlet, not only the plant's
intake. Without `balanceRole` the sum counts each stage's inlet, so at a
multi-stage plant one kilolitre of intake is counted once per stage it passes.
The role narrows the carrying set to the assets whose balance role is `intake`
(ADR 0073 decision 2), which is the plant's water drawn today.

What changes:

- **Decision 6, row 6** now reads: Water today (kL) —
  `sustainability.total {kl_today, sum, balanceRole: intake}`.
- Publish checks the role like any other template source: the write schema
  accepts it (`METRIC_CATALOG_PARAMS_WRITE`) and
  `assertSourceParamsBalanceRolesActive` requires `intake` to be a live
  `bms.water_balance_roles` code (seeded by migration `0080`).
