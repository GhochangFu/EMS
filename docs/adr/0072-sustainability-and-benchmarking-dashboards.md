# ADR 0072 — Sustainability and benchmarking dashboards (`E4.2`)

## Status

Proposed — drafted 2026-09-22 at the §10 gate, before any implementation
code. Six gate questions are put to the owner one at a time; each ruling is
recorded under *Gate questions* and carried into *Decision*.

Promotes nothing out of `AGENTS.md` §6 — the ESG module is `E4.x`, not a §6
item (ADR 0070 *Consequences*). The `chore(agents):` sweep owed is the status
line and the §2 dashboards row, as a separate PR (§9.10).

## Context

`E4.2` (Track C, Wave 4, P1, *"Sustainability & benchmarking dashboards
(daily→enterprise, cross-site) + stakeholder persona defaults"*, `Depends:
E4.1, F3.1`, effort 4–6) was written on 2026-08-17 from the SOW mapping
(`docs/archive/sow-ems-pending-features.md:104`, SOW §7 and §9). Both
dependencies are closed: `F3.1` on 2026-08-30 and the `E4.1` umbrella on
2026-09-20 (ADR 0070, `E4.1c` #506). ADR 0070 §9 defers two things to this
row by name: *"`E4.2` is where they [Water Recycle % and Operational
Efficiency %] are shown"* and *"Cross-site benchmarking and enterprise
roll-ups — `E4.2`, on the read-time surface Context 8 names, over the tags
this ADR stores"*. Nine things are true of the repository today, each read
from source on 2026-09-22.

**1. The tags exist, per asset, and only per asset.** `E4.1c` authored 29
`bms-calc-v3` derived codes onto the stock catalog
(`packages/shared/src/sustainability-point-keys.ts`). The "today" class is
carried by eight stock classes: `kl_today` and `water_cost_today` on the six
water classes (WTP, STP, ETP, RO, softener, cooling tower),
`energy_cost_today` and `co2_kg_today` on the feeder, `co2_avoided_kg_today`
on the solar PV array; `kwh_today` is MEASURED on the feeder (ADR 0070
Amendment 2, Q3). Every value is stored in
`bms.point_values` against one asset. Nothing sums them across the assets of
a site, and nothing places two sites side by side. That read-time roll-up is
the whole of the "benchmarking" half of the row.

**2. The `sustainability` section already exists, with an empty skeleton.**
Migration `0056` (ADR 0049) seeds `bms.dashboard_sections` with six codes,
the sixth `sustainability` (*"Energy, water and emissions rollups across the
plant"*), and the stock catalog carries `sustainability-overview`
(`apps/api/src/admin/dashboard-templates/stock-catalog.ts:668`, `stockVersion:
1`). Its content is three catalog tiles (alarms, work orders, health) and one
table — nothing about energy, water or emissions — and its own comment says
why: a section template binds an **asset-group role plus a point key** (ADR
0049 decision 4), `bms.asset_roles` has no sustainability role, and adding
one is *"a product decision, not a display tweak, and not this file's to
make"*. So the surface the row needs has a home, a section code and a stock
slot, and no data path into it.

**3. The read-time surface exists and its parameter column is still
unread.** ADR 0048's `METRIC_CATALOG`
(`packages/shared/src/contracts/dashboard-builder.ts:556`) has five entries
— `alarms.active.count`, `alarms.active`, `workorders.open.count`,
`workorders.open`, `assets.health.score` — resolved by
`MetricCatalogService` (`apps/api/src/dashboard-builder/metric-catalog.service.ts`)
through `GET /api/v1/dashboards/:id/catalog-values`, scoped by the
dashboard's `location_id` / `asset_group_id` intersected with the caller's
readable assets. `bms.dashboard_widget_sources.params` is stored, CHECKed as
an object (migration `0054`), parsed on write by
`METRIC_CATALOG_PARAMS_WRITE` — and *"declares no fields for any entry, so
there is no parameter to read"* (the service's docblock). ADR 0070 Context 8
named this surface for `E4.2`, and it is still exactly as described there. An
entry that needs a point key and an aggregate is the first entry with a
field on its write schema, which that docblock anticipates: *"When an entry
first needs a filter, it is a field on that entry's write schema … never a
query-string parameter."*

**4. The two executive KPIs are refused three times on record.**
`docs/ux/ion-exchange-reference-alignment.md:97` places *Water Recycle %* and
*Operational Efficiency %* in the integrated dashboard's KPI row; the
clarification document says *"We will not guess a formula that appears on an
executive screen"*; ADR 0050 §"Not in this ADR" declined Operational
Efficiency; ADR 0070 Context 3 ships *"no factor values and no KPI
definitions"*, and decisions 2–6 make both **authorable by the client** as a
`v3` formula over their own meters and parameters. B14 is still unanswered
(`docs/BACKLOG.md` §8.1 lists A2, A5, B15, C22a, C20 as the answers that
moved). This row therefore inherits a hard constraint: it may show a slot
for each KPI and must ship **no formula** behind it.

**5. The personas are unanswered too.** SOW §9 names six stakeholder groups
(Executive Management, Plant Operations, Maintenance, Sustainability, Utility
Managers, Facility Managers). Handover question **C19**
(`docs/ion-exchange-client-handover-2026-08-17.md:354`) asks which exist at
first deployment, who reviews each, and whether each has a preferred landing
screen — and C19 is not among the §8.1 answers. `bms.users.role`
(`packages/shared/src/contracts/auth.ts:10`) is a six-value **authorization**
enum (`admin`, `organization_admin`, `location_admin`, `asset_group_admin`,
`operator`, `viewer`), not a persona vocabulary; nothing in the schema
records a user's or a role's default landing screen. "Stakeholder persona
defaults" has no reviewer, no vocabulary and no column.

**6. The sidebar has no Sustainability entry and no Analytics entry.**
`apps/web/src/layouts/app-shell.tsx:14-57` lists the navigation: Overview,
Sites, Energy at the top; Dashboard, Alarm Centre, Alarm Philosophy,
Dashboards, Assets, Sites Map, Electrical SLD, HVAC · CRAC, Energy Analytics;
the seven control-room pages; Maintenance, Schedule Centre; Rule Engine,
Reports. The reference sidebar
(`docs/ux/ion-exchange-reference-alignment.md:94`) is flat and carries
**Sustainability** beside Analytics and Reports. A section dashboard instance
is reached today only through `/dashboards` and its slug.

**7. `F3.28` owns the KPI ribbon of `/`, and it is human-gated.** BACKLOG §7.2
maps *"Sustainability nav entry, recycle %, efficiency KPIs"* to `E4.1 ·
E4.2` and §7.3 maps *"KPI period-delta + icons, legend"* to `F3.28`, which
has no wave because the §5 *Reference layout language* ⚠ decision holds it.
`KpiTile` has no comparison-to-prior-period concept. If this row edits the
`/` ribbon it absorbs gated scope; if it adds tiles without a period delta it
ships a half of `F3.28`'s tile twice.

**8. "Enterprise" is the organization, and the campus tier does not exist.**
The client's ladder is asset → subsystem → building/site → campus/township →
enterprise (C22a); the shipped shape is Organization → Location → Asset →
Point (ADR 0008). `F2.10` (⬜, ADR-gated, §5 *Hierarchy extension* ⚠) is the
campus tier. A cross-site roll-up here is therefore over `bms.locations` of
one organization, and an organization-wide dashboard (`location_id IS NULL`)
is the enterprise view. The multi-organization branch of
`withOrganizationReadScope` (ADR 0043) already runs a global admin's read on
the fleet pool; a roll-up entry inherits that and adds no cross-tenant read.

**9. The freshness of a "today" tag is the correctness risk of a roll-up.**
A scheduled derived point is re-evaluated every `intervalSeconds` of its
definition (`apps/api/src/calc/calc-schedule.ts`), and `E4.1b` ruled that a
stalled refresh fails closed (`budgetDefect`, `windows_unresolved`). An
asset whose last `kl_today` sample is from yesterday — its RTU offline, its
definition excluded, its window unresolved — contributes yesterday's total
to today's site figure if the roll-up sums latest values blindly. The
`minCoverageRatio` concept exists on the calc side
(`asset-templates-point-rows.ts`, `E4.1c` "fail closed on null"); nothing on
the read side reports coverage.

## Gate questions

**Q1 — Where does the surface live, and where is the line with `F3.28`?**
*(a)* **The existing `sustainability` section: `sustainability-overview`
goes to `stockVersion: 2` with the roll-up tiles and the benchmark table,
and one sidebar entry *Sustainability* opens the organization's instance of
it. The `/` KPI ribbon is untouched; the two executive KPIs join it under
`F3.28` when that row is gated.** *(b)* A new fixed page `/sustainability`
beside `/energy`, hand-built like `EnergyPage`. *(c)* (a) plus the two KPI
tiles on `/`'s ribbon now, without a period delta. **Recommended (a)** — the
section, the stock slot and the instantiation path are ADR 0049's and
already shipped; (b) builds a second dashboard pattern for one page; (c)
ships half of `F3.28`'s tile inside a human-gated row.

**Q2 — The read path for the roll-up.** *(a)* **Two new `METRIC_CATALOG`
entries, the first with fields on their write schema: `sustainability.total`
(shape `metric`, params `{ pointKey, aggregate: "sum" | "avg" }`) and
`sustainability.by_location` (shape `dataset`, same params, one row per
location in scope, columns `locationCode · locationName · value · coverage`).
Both aggregate the LATEST sample of `pointKey` per asset in the dashboard's
scope ∩ the caller's scope, and the period is the tag's own (`*_today`,
`*_this_month`).** *(b)* Read-time window maths over the continuous
aggregates in each location's zone — re-implementing `E4.1b`'s calendar
planning at read time. *(c)* A dedicated `GET /api/v1/sustainability/…`
outside the catalog. **Recommended (a)** — it is the surface ADR 0070 Context
8 named, it puts the parameter on the write schema as the service docblock
prescribes, and the period stays a property of the stored tag so the engine's
timezone and budget rules apply once. (b) duplicates `calc-windows.service`
with a second set of edge cases; (c) is a route the builder cannot bind.

**Q3 — Periods beyond today.** *(a)* **This row authors `*_this_month` and
`*_this_year` derived points for the five today quantities of Context 1
(`kl`, `water_cost`, `energy_cost`, `co2_kg`, `co2_avoided_kg`) on the eight
classes that carry them, with the same formula and a calendar window — the
stock catalog bumps those classes once more.** *(b)* Read-time aggregation of daily maxima of the `*_today` tag in
the location's zone. *(c)* Today only; monthly and annual are a follow-up
row. **Recommended (a)** — the engine already resolves `this_month` and
`this_year` in the location's zone with the `1d` view (ADR 0070 decisions 5–6,
Amendment 1), so a monthly tag costs one definition and a budgeted read; (b)
is wrong across an IST midnight unless the `5m` buckets are re-planned at
read time — which is (a) done twice; (c) leaves the row's own name
("daily→enterprise") unmet.

**Q4 — The two executive KPIs.** *(a)* **Two vocabulary codes,
`water_recycle_pct` and `operational_efficiency_pct` (unit `%`), seeded into
the point-key catalog with NO stock formula, and two tiles in the stock
template bound to `sustainability.total { pointKey, aggregate: "avg" }`. A
tile whose scope carries no asset with the point renders the catalog's
empty state ("no source"); it fills the day the client authors a `v3`
formula under that code on their template.** *(b)* Ship a placeholder
formula. *(c)* Omit the tiles until B14 answers. **Recommended (a)** — it is
the only option consistent with the three refusals in Context 4 that still
gives the client a slot with a name; (b) is the refused thing; (c) hides
that the slot exists.

**Q5 — Persona defaults with C19 open.** *(a)* **Nothing in this row. The
Sustainability section is the Sustainability persona's screen; a per-role or
per-user landing preference is a new row, `F3.xx`, gated on C19 and on the §5
*Reference layout language* decision, and this ADR records that.** *(b)*
Add `bms.users.default_dashboard_id` now as a per-user landing preference.
*(c)* Map the six SOW personas onto the six `bms.users.role` values.
**Recommended (a)** — the personas have no reviewer and no vocabulary
(Context 5); (b) is a schema change for a preference nobody has asked for by
name; (c) conflates authorization with audience, which `asset_group_admin`
(ADR 0058) already shows are different axes.

**Q6 — Split the row?** *(a)* **One row, two pull requests, serial: PR 1
the two catalog entries with their write-schema fields, the freshness rule
and the coverage figure (`apps/api`, `packages/shared`); PR 2 the stock
points of Q3, `sustainability-overview` v2 with the tiles and the benchmark
table, the sidebar entry, and the tile's coverage rendering (`apps/api` stock,
`apps/web`).** *(b)* Split into `E4.2a` (read path) and `E4.2b` (content and
surface) as `F3.5` was. **Recommended (a)** — effort 4–6 and no ⭐ enabler;
`F3.5`'s split earned its two closure rows on a queue and a renderer, and
this row has neither.

## Decision

*(Filled in from the rulings.)*

## Ruled here without a question

1. **Freshness.** An asset contributes to a roll-up only when its latest
   sample of `pointKey` is younger than **three times the point's own
   `intervalSeconds`**; otherwise it is excluded and counted in the
   denominator of `coverage`. `coverage` is `fresh / carrying`, where
   `carrying` is the number of assets in scope whose template declares the
   point. A roll-up over zero carrying assets is the catalog's existing
   `null` (no source); a roll-up with `coverage < 1` is a value **with** the
   ratio beside it, never a value alone — the tile shows "n of m assets".
2. **Aggregate per point kind.** `sum` for a quantity (kWh, kL, cost, kg);
   `avg` for a ratio (`%`). The write schema accepts either; the stock
   template binds the right one, and the ADR does not derive it from the
   unit.
3. **The roll-up is over the dashboard's scope, never wider.** A location
   dashboard sums its location; an organization dashboard sums every
   location the caller can read. `sustainability.by_location` lists
   locations in the same scope, in `code` order, and a location with no
   carrying asset is a row with `null` value and `0/0` coverage — present, so
   a site with no meters is visible as such rather than absent.
4. **Money is in the organization's currency** (`bms.organizations.currency`,
   ADR 0070 decision 7). A roll-up under the multi-organization branch of
   `withOrganizationReadScope` over two currencies is `null` with reason
   `mixed_currency`, the `energy-cost.ts` rule unchanged.
5. **No new dependency.** Nothing under §9.4 moves.
6. **`E4.3` and `E1.6` are not here.** Water balance is `E4.3`; money on
   advisories is `E1.6`. The campus tier is `F2.10`.

## Dependencies

None.

## Consequences

*(Filled in from the rulings.)*
