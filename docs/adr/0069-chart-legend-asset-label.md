# ADR 0069 — A chart legend that names the asset: `assetCode` on the widget point DTO

## Status

Accepted — drafted and ruled 2026-09-18 under `F3.43`. The four gate
questions (§"Gate questions") were put to the owner one at a time, in order,
before any implementation code (AGENTS.md §10, `backlog-cycle` step 2), and
each was ruled **as recommended**. Three further rulings were taken by the
drafting agent as routine calls and are listed in §"Ruled here without a
question" so the owner can overturn any of them at the plan gate.

## Context

`F3.43` (Track C, P2, Wave 2, *"A chart legend that names the asset, not the
point key"*) was created 2026-09-02 by the §4.6 browser pass on the Sheet 02
demo dashboard ([#275](https://github.com/GhochangFu/EMS/pull/275)),
immediately after [#274](https://github.com/GhochangFu/EMS/pull/274) landed
the legend that made the defect visible.

What the code does today, re-measured on `main` at `8e4a2a82` before drafting:

- `widgetDataFor` (`apps/web/src/lib/dashboard-widget-data.ts:492-502`) names
  every chart series `point.pointKey`. Its own comment records why: *"`pointKey`
  is the only human-readable field this DTO carries … A nicer legend (an
  asset-qualified name) needs a second round trip per point, which plan §15 Q4
  already declined for the whole row; do not 'fix' this into a fetch."*
- `buildChartOption` (`widget-echarts-option.ts:145-152`) keys the legend by
  `series[].name`. ECharts collapses equal names into one legend entry, so a
  chart bound to five breakers' `kw` shows five plots and one legend item.
  `/dashboards/ionsite-electrical-overview` is the reproduction. It is **not
  seeded** — `docs/ion-exchange-electrical-dashboard-2026-09-02.json` says it is
  replayed by hand — so the verification stack replays it before the browser
  layer runs (plan-gate ruling, 2026-09-18).
- `dashboardWidgetPointDtoSchema`
  (`packages/shared/src/contracts/dashboard-builder.ts:678-687`) carries `id`,
  `pointId`, `role`, `sortOrder`, `assetId`, `pointKey` and `unit`. `assetId`
  is a bare UUID; `pointKey` is the only human-readable field. `apps/web` has
  nothing better to name a series with, and no local fix exists.

**The fact this ADR turns on.** `resolveBoundPoints`
(`apps/api/src/dashboard-builder/dashboard-point-scope.ts:52-79`) — the one
read that fills every `DashboardWidgetPointDto` — **already `innerJoin`s
`bms.assets`**, for the explicit organization predicate the file docblock
insists on, and selects nothing from it. `assets.code` and `assets.name` are
therefore one column away on a join that already runs. The row fenced off a
second fetch, and correctly; this decision adds no fetch and no join. The
label rides the response that already exists.

The change crosses `packages/shared` and `apps/api`: every response type is
`z.infer`red from the contract (ADR 0030), so widening the DTO is a §10
promotion, and this is the ADR it needs.

## Gate questions

Put to the owner one at a time, in this order. Each carried a recommendation
and each was ruled as recommended.

**Q1 — Which asset field the DTO gains.** `assetCode` (varchar 64, the
`Asset · <code>` convention `dashboardSummaryDtoSchema` adopted under ADR
0067); `assetName` (varchar 255, what `assetPointPickerRowSchema` chose under
ADR 0047 Amendment 6); or both. **Ruled: `assetCode`.** The legend is
`type: "scroll"` at `fontSize: 10` in a band 28 px tall; a 255-character name
is unreadable there and a code is not. The point picker row carries `assetName`
and not `assetCode`; that difference is recorded in Q4 rather than papered
over.

**Q2 — How a series is named.** Always `<assetCode> · <pointKey>`; only when
the widget's bindings span more than one asset; or only when two bindings share
one `pointKey`. **Ruled: always.** One rule and no branch. A conditional name
changes when a sibling binding is added, so the same binding would read
differently on two widgets and differently before and after an edit. The
legend renders only for more than one series (`#274`), so a single-series
chart shows nothing new; its tooltip gains the asset, which is not a cost.

**Q3 — Where the composition lives.** A named pure helper beside
`widgetDataFor`, or a template literal inline at line 497. **Ruled: a named
helper**, `seriesNameFor(point)`, exported from `dashboard-widget-data.ts`.
The guard the row owes can reach it directly, and `widgetDataFor`'s own spec
proves the wiring. `widget-echarts-option.ts` is not touched — the row's own
exclusion, restated here because it is the obvious wrong place to "fix" this.

**Q4 — Whether the builder's inspector labels follow.** `pointBindingLabel`
(`dashboard-builder-form.ts:142`, a loaded binding) and `addPoint`
(`widget-inspector.tsx:80`, a freshly picked point) both read
`pointKey (unit)`. **Ruled: no — the legend only.** Only the loaded path could
gain the code today (the picker row has none), so a freshly picked point and a
loaded one would read differently until the next save. Both labels keep their
text; both docblocks stop asserting that the DTO carries no asset name
(§"Consequences"). Extending the picker row is a second contract change and is
not decided here.

## Decision

### 1. `dashboardWidgetPointDtoSchema` gains `assetCode`

```ts
export const dashboardWidgetPointDtoSchema = z.object({
  id: z.string().uuid(),
  pointId: z.string().uuid(),
  role: widgetPointRoleSchema,
  sortOrder: z.number().int(),
  assetId: z.string().uuid(),
  // ADR 0069 — the asset's own code, from the `bms.assets` join `resolveBoundPoints`
  // already makes. Bound to the column (`varchar(64)`, §4.8) and required, never
  // nullable: the join is inner, so a binding whose asset does not resolve is not
  // returned at all rather than returned with a null label.
  assetCode: z.string().max(64),
  pointKey: z.string().max(128),
  unit: z.string().max(32).nullable(),
});
```

`packages/shared` only. `DashboardWidgetPointDto` is `z.infer`red, so every
consumer's type widens with it. The write body
(`PutDashboardWidgetsBody`, `{pointId, role, sortOrder}`) is unchanged: a
client never sends a label, and `buildPutWidgetsPayload` keeps dropping it.

### 2. Three API sites change together, and a parse gates them

- `ResolvedBoundPoint` (`dashboard-point-scope.ts:32-41`) gains
  `readonly assetCode: string`.
- The `select` in `resolveBoundPoints` adds `assetCode: assets.code`. No new
  join, no new predicate: the `innerJoin(assets, …)` and the
  `eq(assets.organizationId, organizationId)` leg are already there, and the
  organization guard the file docblock describes now protects the label for
  the same reason it protects `assetId`.
- `mapDashboardWidget` (`dashboards.service.ts:104-112`) copies
  `assetCode: point.assetCode` into the DTO.

The mapper ends in `merged as DashboardWidgetDto`, and its own docblock records
that an omitted key *"is not a type error, not an API error, and not visible
until a browser opens a dashboard"* — that is how `sources` shipped defaulted
under `F3.35`. So the gate for this decision is not the compiler: a case in
`dashboards.service.spec.ts` runs the mapper's output through
`dashboardWidgetPointDtoSchema.parse` and fails on the missing key, and
`dashboard-point-scope.integration.spec.ts` asserts the resolved row's
`assetCode` equals the fixture asset's own `code` (it already asserts the
fleet-pool organization predicate; the label rides the same case).

### 3. `seriesNameFor` in `apps/web`, and `widgetDataFor` uses it

```ts
/** ADR 0069 Q2 — always asset-qualified, never conditional on the siblings. */
export function seriesNameFor(point: Pick<DashboardWidgetPointDto, "assetCode" | "pointKey">): string {
  return `${point.assetCode} · ${point.pointKey}`;
}
```

`widgetDataFor`'s chart branch sets `name: seriesNameFor(point)`. The
separator is the middle dot the summary badge already uses
(`Asset · <code>`). Nothing else in `dashboard-widget-data.ts` changes;
`widget-echarts-option.ts`, `chart-widget.tsx` and `ChartFooter` are untouched
(Q3).

### 4. The guard the row owes

A case in `dashboard-widget-data.spec.ts`: a `chart` widget with **two
bindings that share one `pointKey` and differ in `assetId`/`assetCode`**
produces two series whose names differ. Two bindings with distinct
`pointKey`s are not the guard — they were distinguishable before this ADR and
prove nothing. The case is run once with decision 3 reverted to `point.pointKey`
to show it reddens, and that run is recorded in the closure row.

### 5. The inspector keeps its labels (Q4)

`pointBindingLabel` and `addPoint` keep `pointKey (unit)`. No web contract
other than decision 1 changes; `assetPointPickerRowSchema` is untouched.

## Ruled here without a question

6. **`assetCode`, not `assetName`, and the separator is ` · `.** Q1 chose the
   field; the separator follows the one precedent in this app for the same
   pairing (`Asset · <code>`, ADR 0067) rather than inventing a second.
7. **The field is required.** A nullable label would need a fallback branch in
   `seriesNameFor` for a row the inner join can never produce. §4.8 says a
   response contract states what the store can hold, and the store cannot hold
   a binding whose asset is absent (`asset_points.asset_id` is a NOT NULL FK).
8. **The prose this change falsifies lands in the feature commit, not the
   `chore(agents):` sweep.** Code docblocks are not sweep items. Four are named
   in §"Consequences" so a reviewer can tick them.

## What this ADR does not decide

- Whether the point picker row (`assetPointPickerRowSchema`) also gains
  `assetCode`, and with it whether the inspector labels become
  asset-qualified. Q4 declined it for this row; it is a follow-up row if wanted.
- Any change to `widget-echarts-option.ts`, `ChartFooter`, tooltip formatting
  or legend placement. `#274` is complete.
- Any per-widget option to hide the asset prefix. Q2 ruled one rule, no branch.

## Dependencies

None. No new package in any workspace.

## Consequences

- **Fixture sites, enumerated from the source rather than from a green run.**
  The schema gains a required field, so every literal built as a
  `DashboardWidgetPointDto` needs `assetCode`. Grep `role: "series"|"primary"`
  ∧ `pointKey` on `main` at `8e4a2a82` finds eight files:
  `apps/web/src/lib/dashboard-widget-data.spec.ts` (10 literals),
  `packages/shared/src/contracts/dashboard-builder.spec.ts` (5),
  `apps/web/src/lib/dashboard-builder-form.spec.ts` (5),
  `apps/api/src/dashboard-builder/dashboards.service.spec.ts` (3),
  `apps/web/src/lib/dashboard-widget-data-catalog.spec.ts`,
  `apps/web/src/lib/dashboard-widget-data-aggregate.spec.ts`,
  `apps/web/src/lib/dashboard-duplicate.spec.ts` and
  `apps/web/src/components/dashboards/duplicate-dashboard-dialog.spec.tsx`
  (1 each). The plan re-runs the grep; a literal typed loosely enough to
  compile without the field is exactly the kind the parse in decision 2 exists
  to catch.
- **A ninth site, and it was a producer, not a fixture (review finding,
  2026-09-18).** `readBack` in
  `apps/api/src/admin/dashboard-templates/dashboard-templates-instantiate.service.ts`
  built the point rows with its own select and parsed the result through
  `dashboardDtoSchema` from `unknown` — so the grep above (literals with a
  `role`) did not find it, the compiler did not see it, and every instantiation
  whose bindings resolved committed the dashboard and then answered 500 from
  the read-back. Two integration suites reddened. Fixed by replacing the select
  with `resolveBoundPoints`, so the contract now has one producer of point
  rows. The lesson is in the row: **enumerate producers by the parse call, not
  by the literal.**
- **Prose falsified by this change, fixed in the feature commit (ruling 8):**
  `dashboard-widget-data.ts:493-496` (the "only human-readable field … do not
  'fix' this into a fetch" comment — rewritten to say the label rides the
  existing join, not deleted; the refusal of a second fetch still stands);
  `dashboard-builder-form.ts:38-43` and `:139-141` (both assert the DTO carries
  no asset name); `packages/shared/src/contracts/dashboard-builder.ts:669-677`
  (the `F3.1b` widening docblock, including its "`F3.1c` would need a second
  round trip" clause); `widget-catalog.ts:64-67` (`WidgetSeries.name`'s
  provenance sentence).
- **The API spec runner.** `apps/api/vitest.config` includes
  `src/**/*.test.ts` only; a case added to `dashboards.service.spec.ts` runs
  only if the 17-line `dashboards.service.test.ts` invokes the suite it lives
  in. The plan names which exported runner the new case joins.
- **Verification layers (§4.6).** Contract: the `packages/shared` spec.
  API: the mapper parse and the integration spec (needs `DATABASE_URL`; report
  a skip as a skip). Web: `dashboard-widget-data.spec.ts` (the guard) and
  `widget-echarts-option.spec.ts` unchanged and green. Browser: one
  `javascript_tool` read of the live ECharts instance on
  `/dashboards/ionsite-electrical-overview` — `legendData` must return five
  distinct names where the row measured five copies of `kw`; sent to
  `browser-verifier`. Database: N/A — no schema change.
- **Cascade.** No row lists `F3.43` in `Depends`. The follow-up this ADR
  declines (picker row + inspector labels) has no row and is created only if
  the owner wants it.
- **`AGENTS.md` / roadmap.** No §6 line moves. The status line gains this ADR in
  the closure's separate `chore(agents):` PR (§9.10), as every row since
  ADR 0047 has done.
