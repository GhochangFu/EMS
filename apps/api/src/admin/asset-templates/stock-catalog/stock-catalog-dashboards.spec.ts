import { STOCK_ASSET_TEMPLATE_CATALOG } from "./stock-catalog";
import { assert } from "./stock-catalog.spec";
import type { StockAssetTemplateEntry } from "./types";

/**
 * `F3.2` Task 8 — the build-time gate over `content.dashboards`, which nothing
 * else in this pack checks. `stock-catalog.spec.ts`'s `checkEntry` parses every
 * entry under `stockAssetTemplateDtoSchema` and `createAssetTemplateBodySchema`
 * (so the widget/grid/cardinality shape is already enforced there — a widget
 * this file never has to re-validate for well-formedness), and
 * `collectContentPointRefs` / `assertContentRefsResolve` close the same
 * "undeclared key" hole at create/update/publish/import time. What none of
 * those checks does is confirm that a stock entry's `featured` and widget
 * `pointKeys` name a **measured, non-manual** point — the only kind
 * `AssetDashboardsInstantiateService` can ever bind a value into at
 * instantiation (plan §3): a `derived` key has no `asset_points` row to read,
 * and a `manual` row is never populated by the ingest path either. A typo'd or
 * mis-tiered key would sail through both existing gates and surface only as a
 * silently unbound tile on a real asset's first dashboard.
 *
 * Named `stock-catalog-dashboards.spec.ts` — a new pair, not an addition to
 * `stock-catalog.spec.ts`, which is at the §4.5 1000-line cap (plan Task 8).
 * `assert` is imported from that file rather than restated, the same way
 * `stock-catalog-deferrals.spec.ts` does; nothing here is imported back into
 * either of those files.
 *
 * Five claims, C1–C5 (plan §5 Task 8 table):
 *
 *  - **C1** — every catalog entry carries `content.dashboards.overview`, and
 *    the count checked is both `=== catalog.length` (nothing skipped) and
 *    `>= 27` (anti-vacuity: this cannot go green over an empty catalog).
 *  - **C2** — every `featured` key and every widget's `pointKeys` entry is a
 *    key the entry actually declares in `points[]`, with `kind === "measured"`
 *    and `meta.tier !== "manual"`.
 *  - **C3** — exactly one `chart` widget per view; the `value_tile` count
 *    equals `featured.length`; tile `i` binds `featured[i]`, in order.
 *  - **C4** — no two widgets on one view overlap on the grid. The DB carries
 *    no overlap constraint (`dashboard_widgets_grid_bounds_check` only bounds
 *    a widget against the canvas, not against its siblings), so this is the
 *    only place the rule is enforced.
 *  - **C5** — the positive control on C2's checker itself: a synthetic entry
 *    whose `featured` names a point it never declares must be REFUSED. Without
 *    this, C2 passing over 27 real entries would be indistinguishable from a
 *    checker that validates nothing.
 */

/** One declared point, reduced to the two fields C2 cares about. */
type DeclaredPoint = { readonly kind: string; readonly tier: string | undefined };

function declaredPointIndex(entry: StockAssetTemplateEntry): Map<string, DeclaredPoint> {
  const index = new Map<string, DeclaredPoint>();
  for (const point of entry.points) {
    index.set(point.pointKey, { kind: point.kind, tier: point.meta?.tier });
  }
  return index;
}

/**
 * C2's mechanism, exported so C5 can run it directly against a fixture rather
 * than against the real catalog — the positive control this checker needs to
 * prove it can fail at all.
 */
export function assertDashboardPointKeysResolve(entry: StockAssetTemplateEntry): void {
  const declared = declaredPointIndex(entry);
  const views = entry.content?.dashboards ?? {};
  for (const [viewName, view] of Object.entries(views)) {
    const checkKey = (key: string, where: string): void => {
      const point = declared.get(key);
      assert(
        point !== undefined,
        `${entry.code}/${viewName}: ${where} references "${key}", which this entry does not declare in points[]`,
      );
      if (!point) return;
      assert(
        point.kind === "measured",
        `${entry.code}/${viewName}: ${where} key "${key}" is kind "${point.kind}", not "measured" — a ` +
          "derived point has no asset_points row to read at instantiation",
      );
      assert(
        point.tier !== "manual",
        `${entry.code}/${viewName}: ${where} key "${key}" is tier "manual" — a manual row is never ` +
          "populated at instantiation",
      );
    };
    view.featured.forEach((key) => checkKey(key, "featured"));
    for (const widget of view.widgets ?? []) {
      widget.pointKeys.forEach((key) => checkKey(key, `widget "${widget.widgetType}"`));
    }
  }
}

export function assertC1(catalog: readonly StockAssetTemplateEntry[]): void {
  let checked = 0;
  for (const entry of catalog) {
    const overview = entry.content?.dashboards?.overview;
    assert(overview !== undefined, `${entry.code}: content.dashboards.overview is missing`);
    if (overview) checked += 1;
  }
  assert(
    checked === catalog.length,
    `C1: ${checked} of ${catalog.length} catalog entries carry content.dashboards.overview`,
  );
  assert(checked >= 27, `C1 anti-vacuity: expected at least 27 entries with an overview view, got ${checked}`);
}

export function assertC2(catalog: readonly StockAssetTemplateEntry[]): void {
  for (const entry of catalog) {
    assertDashboardPointKeysResolve(entry);
  }
}

export function assertC3(catalog: readonly StockAssetTemplateEntry[]): void {
  for (const entry of catalog) {
    const overview = entry.content?.dashboards?.overview;
    if (!overview) continue; // C1 already fails this entry
    const widgets = overview.widgets ?? [];
    const charts = widgets.filter((widget) => widget.widgetType === "chart");
    assert(charts.length === 1, `${entry.code}: overview must carry exactly one chart widget, got ${charts.length}`);
    const tiles = widgets.filter((widget) => widget.widgetType === "value_tile");
    assert(
      tiles.length === overview.featured.length,
      `${entry.code}: ${tiles.length} value_tile widgets but featured.length is ${overview.featured.length}`,
    );
    tiles.forEach((tile, index) => {
      assert(
        tile.pointKeys[0] === overview.featured[index],
        `${entry.code}: tile ${index} binds "${String(tile.pointKeys[0])}", expected featured[${index}] ` +
          `"${overview.featured[index]}"`,
      );
    });
  }
}

type GridRect = { readonly gridX: number; readonly gridY: number; readonly gridW: number; readonly gridH: number };

function rectanglesOverlap(a: GridRect, b: GridRect): boolean {
  return (
    a.gridX < b.gridX + b.gridW &&
    b.gridX < a.gridX + a.gridW &&
    a.gridY < b.gridY + b.gridH &&
    b.gridY < a.gridY + a.gridH
  );
}

export function assertC4(catalog: readonly StockAssetTemplateEntry[]): void {
  for (const entry of catalog) {
    const overview = entry.content?.dashboards?.overview;
    if (!overview) continue; // C1 already fails this entry
    const widgets = overview.widgets ?? [];
    for (let i = 0; i < widgets.length; i += 1) {
      for (let j = i + 1; j < widgets.length; j += 1) {
        assert(
          !rectanglesOverlap(widgets[i]!, widgets[j]!),
          `${entry.code}: widgets ${i} and ${j} of the overview view overlap on the grid`,
        );
      }
    }
  }
}

/**
 * A synthetic entry whose `featured` names a key the entry never declares in
 * `points[]`. Never added to the catalog — it exists only to prove C2's
 * checker can fail.
 */
const UNDECLARED_KEY_FIXTURE: StockAssetTemplateEntry = {
  code: "f32-spec-undeclared-dashboard-key",
  name: "Spec fixture — undeclared dashboard key",
  assetType: "test_rig",
  domain: "electrical",
  description: "F3.2 Task 8 C5 fixture — proves assertDashboardPointKeysResolve is not vacuous.",
  stockVersion: 1,
  content: {
    contentVersion: 1,
    dashboards: {
      overview: {
        featured: ["not_a_declared_point_key"],
      },
    },
  },
  points: [
    {
      kind: "measured",
      pointKey: "kw",
      label: "Active power",
      unit: "kW",
      required: true,
      sortOrder: 0,
      meta: { tier: "core" },
      sourceDataKeyPattern: null,
      formula: null,
      formulaDialect: null,
      calcTrigger: null,
      calcIntervalSeconds: null,
      maxInputAgeSeconds: null,
      minCoverageRatio: null,
    },
  ],
};

export function assertC5(): void {
  let refused: string | null = null;
  try {
    assertDashboardPointKeysResolve(UNDECLARED_KEY_FIXTURE);
  } catch (err) {
    refused = err instanceof Error ? err.message : String(err);
  }
  assert(
    refused !== null && /does not declare/.test(refused),
    `C5: an entry whose featured array names an undeclared point key must be refused, naming the rule — ` +
      `got ${String(refused)}`,
  );
}

/** Exported so the `.test.ts` wrapper's five `it()`s each call one claim directly. */
export const STOCK_CATALOG_FOR_DASHBOARD_TESTS = STOCK_ASSET_TEMPLATE_CATALOG;
