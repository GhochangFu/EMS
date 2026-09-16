import { createHash } from "node:crypto";

import {
  DASHBOARD_GRID,
  MAX_DASHBOARD_WIDGETS,
  WIDGET_POINT_CARDINALITY,
} from "@bms/shared";
import type { TemplateDashboardView, TemplateDashboardWidget } from "@bms/shared";

import {
  assertDashboardBatchFits,
  dashboardName,
  dashboardSlug,
  dashboardWidgetRowsFor,
  MAX_DASHBOARD_WIDGET_ROWS,
  planView,
  TILE_H,
  TILE_W,
  TILES_PER_ROW,
} from "./asset-dashboards-plan";

/**
 * `F3.2` Task 5 — the pure half of ADR 0067: the dashboard slug and name a
 * (asset, view) pair derives, the per-view widget plan and its report, and the
 * batch bound.
 *
 * Nothing here touches a database or NestJS. The plan is provable against every
 * input the content contract permits, which is what the instantiate suite (Task
 * 6) can only observe indirectly through whatever fixture it happens to hold.
 *
 * One `it()` per claim in the sibling wrapper: `assert` throws, so two claims in
 * one case would hide the second.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function sameString(actual: string, expected: string, message: string): void {
  assert(actual === expected, `${message}\n  expected ${expected}\n  got      ${actual}`);
}

function sameNumber(actual: number, expected: number, message: string): void {
  assert(actual === expected, `${message}\n  expected ${expected}\n  got      ${actual}`);
}

/** `dashboards.slug` is `varchar(64)`, unique per organization. */
const SLUG_MAX_LENGTH = 64;
/** D2's floor: a punctuation-only pair still has to be a usable path segment. */
const SLUG_MIN_LENGTH = 2;
const SLUG_TRUNCATED_LENGTH = 55;
const SLUG_HASH_LENGTH = 8;
/** `dashboards.name` is `varchar(255)`, and Postgres counts CHARACTERS. */
const NAME_MAX_CODE_POINTS = 255;

/**
 * The slug contract, restated rather than imported: the value has to satisfy
 * `varchar(64)` and read as a path segment, and no exported schema states that
 * pair today.
 */
const SLUG_SHAPE = /^[a-z0-9-]{2,64}$/;

/**
 * One astral character, written as a code point rather than as itself: AGENTS.md
 * §4.5 forbids a literal pictograph in source, and the escape is the same two
 * UTF-16 code units that `String.prototype.slice` would split.
 */
const ASTRAL = String.fromCodePoint(0x1f600);

function tile(
  overrides: Partial<TemplateDashboardWidget> & { pointKeys: string[] },
): TemplateDashboardWidget {
  return {
    widgetType: "value_tile",
    config: {},
    title: "Tile",
    gridX: 0,
    gridY: 0,
    gridW: TILE_W,
    gridH: TILE_H,
    ...overrides,
  } as TemplateDashboardWidget;
}

function chart(pointKeys: string[]): TemplateDashboardWidget {
  return {
    widgetType: "chart",
    config: { series: "line", yAxisLabel: "kW" },
    title: "Trend",
    gridX: 0,
    gridY: 4,
    gridW: DASHBOARD_GRID.columns,
    gridH: 4,
    pointKeys,
  };
}

function points(...keys: string[]): ReadonlyMap<string, string> {
  return new Map(keys.map((key, index) => [key, `point-${index}`]));
}

/** P1 — the ordinary case: two clean parts joined by one hyphen. */
export function assertSlugJoinsTheLowerCasedCodeAndView(): void {
  sameString(
    dashboardSlug("TX-01", "overview"),
    "tx-01-overview",
    "an asset code and a view name join, lower-cased",
  );
}

/** P2 — non-ASCII drops and runs of punctuation collapse to one hyphen. */
export function assertSlugDropsNonAsciiAndCollapsesRuns(): void {
  sameString(
    dashboardSlug("Ünité 7", "Vue d'ensemble"),
    "nit-7-vue-d-ensemble",
    "every code point outside [a-z0-9] collapses, and the edges are stripped",
  );
}

/** P3 — over the column width: 55 characters, a hyphen, and eight hex. */
export function assertAnOverflowingSlugIsTruncatedAndHashed(): void {
  const code = "a".repeat(60);
  const view = "b".repeat(20);
  const joined = `${code}-${view}`;
  const slug = dashboardSlug(code, view);

  sameNumber(slug.length, SLUG_MAX_LENGTH, "an overflowing slug lands on exactly the column width");
  sameString(
    slug.slice(0, SLUG_TRUNCATED_LENGTH),
    joined.slice(0, SLUG_TRUNCATED_LENGTH),
    "the prefix is the untruncated join, cut at 55",
  );
  sameString(
    slug.slice(SLUG_TRUNCATED_LENGTH, SLUG_TRUNCATED_LENGTH + 1),
    "-",
    "one hyphen separates the prefix from the digest",
  );
  const digest = slug.slice(SLUG_TRUNCATED_LENGTH + 1);
  assert(
    /^[0-9a-f]{8}$/.test(digest),
    `the digest is eight LOWER-case hex characters (the charset is [a-z0-9-], not seededRuleCode's [A-Z0-9_-]); got ${digest}`,
  );
  sameString(
    digest,
    createHash("sha256").update(joined).digest("hex").slice(0, SLUG_HASH_LENGTH),
    "the hash is taken over the UNTRUNCATED join",
  );
}

/**
 * P3, second half — the claim the length assertions cannot make. A digest taken
 * over the cut prefix would give these two inputs the same slug, and every
 * assertion above would still pass.
 */
export function assertTwoInputsDifferingPastTheCutGetDifferentSlugs(): void {
  const shared = "a".repeat(SLUG_TRUNCATED_LENGTH + 4);
  const first = dashboardSlug(shared, "view-one");
  const second = dashboardSlug(shared, "view-two");

  sameString(
    first.slice(0, SLUG_TRUNCATED_LENGTH),
    second.slice(0, SLUG_TRUNCATED_LENGTH),
    "the control: the two inputs are identical up to the cut",
  );
  assert(
    first !== second,
    `two inputs differing only past character ${SLUG_TRUNCATED_LENGTH} must not collide; both gave ${first}`,
  );
}

/** P4 — a punctuation-only pair normalises to nothing and is padded to the floor. */
export function assertADegenerateSlugIsPaddedToTwoCharacters(): void {
  sameString(dashboardSlug("-", "_"), "--", "a degenerate pair still reaches the two-character floor");
  assert(
    dashboardSlug("", "").length >= SLUG_MIN_LENGTH,
    "two empty parts still reach the floor",
  );
}

/**
 * P8, the vocabulary pin — the fallback lattice is derived for ONE key per tile.
 *
 * `planFeaturedTiles` does not read `WIDGET_POINT_CARDINALITY.value_tile.max`,
 * because `[key].slice(0, max)` would be dead code on a one-element array and
 * would read as a single-source use while constraining nothing. This is where
 * the equality is held: if the vocabulary ever lets a tile bind two points, the
 * fallback must be re-derived, and this case says so instead of the lattice
 * quietly binding one key of two.
 */
export function assertTheFallbackBindsOneKeyPerTileByVocabulary(): void {
  sameNumber(
    WIDGET_POINT_CARDINALITY.value_tile.max,
    1,
    "a value tile binds one point; widen this and planFeaturedTiles must be re-derived",
  );
  const view: TemplateDashboardView = { featured: ["a", "b"] };
  const plan = planView("overview", view, points("a", "b"));
  sameNumber(plan.widgets[0]?.points.length ?? -1, 1, "the first tile binds its own key only");
  sameString(plan.widgets[0]?.points[0]?.pointKey ?? "", "a", "and it is the key at its index");
  sameNumber(plan.resolutions[0]?.boundPoints ?? -1, 1, "the report counts that one binding");
}

/**
 * P5 — the slug survives every hostile input, INCLUDING inputs the content
 * contract does not permit.
 *
 * The table is deliberately wider than the contract: a view key is
 * `safeKeySchema.pipe(z.string().min(1).max(64))`, so the empty and
 * whitespace-only rows are unreachable through the API today. They are here
 * because this function is also called with `assets.code`, which carries no
 * character restriction at all, and because a later caller is not bound by
 * today's reachability.
 */
export function assertEveryHostileInputProducesAContractShapedSlug(): void {
  const inputs: Array<[string, string]> = [
    ["TX-01", "overview"],
    ["Ünité 7", "Vue d'ensemble"],
    ["-", "_"],
    ["", ""],
    ["   ", "\t\n"],
    [ASTRAL, `${ASTRAL}${ASTRAL}`],
    ["\u{1D518}\u{1D52B}\u{1D526}\u{1D531}", "\u{1D519}\u{1D526}\u{1D522}\u{1D534}"],
    ["a".repeat(64), "b".repeat(64)],
    ["A".repeat(64), "B".repeat(64)],
    ["../../etc/passwd", "overview"],
    ["TX_01", "over view"],
    ["tx--01", "--overview--"],
    ["0", "0"],
    ["Ä", "Ö"],
    ["asset code with spaces", "view name with spaces"],
    ["%20%20", "%2F"],
    ["CR-BATT-1", "trends"],
    ["<script>", "alert(1)"],
    ["日本語", "ダッシュ"],
    ["mixed-123-ABC", "MiXeD-456-def"],
  ];

  for (const [code, view] of inputs) {
    const slug = dashboardSlug(code, view);
    assert(
      SLUG_SHAPE.test(slug),
      `dashboardSlug(${JSON.stringify(code)}, ${JSON.stringify(view)}) = ${JSON.stringify(slug)} must match ${SLUG_SHAPE}`,
    );
  }
}

/** P6 — the name is cut to 255 CHARACTERS, which is what `varchar(255)` counts. */
export function assertTheNameIsCutToTwoHundredFiftyFiveCodePoints(): void {
  const name = dashboardName("a".repeat(300), "v");
  sameNumber(
    Array.from(name).length,
    NAME_MAX_CODE_POINTS,
    "a long name is cut to the column width, counted in code points",
  );
  sameString(
    dashboardName("Feeder 1", "overview"),
    "Feeder 1 · overview",
    "a short name is the asset name, the separator and the view",
  );
}

/**
 * P6, second half — `String.prototype.slice` counts UTF-16 code units, so a cut
 * that lands inside a surrogate pair emits a lone surrogate. The length
 * assertion above passes either way, which is why this is its own case.
 */
export function assertAnAstralPairAtTheCutIsNotSplit(): void {
  // 254 plain characters, then an astral pair sitting exactly on the boundary.
  const assetName = `${"a".repeat(NAME_MAX_CODE_POINTS - 1)}${ASTRAL}${"b".repeat(50)}`;
  const name = dashboardName(assetName, "overview");
  const codePoints = Array.from(name);

  sameNumber(codePoints.length, NAME_MAX_CODE_POINTS, "the cut still lands on the column width");
  sameString(
    codePoints[codePoints.length - 1] ?? "",
    ASTRAL,
    "the astral pair at the cut survives whole",
  );
  assert(
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(name),
    `the cut name carries no lone surrogate: ${JSON.stringify(name)}`,
  );
}

/** P7 — a view with `widgets[]`: the template's own layout, copied verbatim. */
export function assertPlannedWidgetsCopyTheTemplateVerbatim(): void {
  const widget = chart(["kw", "kva"]);
  const view: TemplateDashboardView = { featured: ["kw"], widgets: [widget] };
  const plan = planView("overview", view, points("kw", "kva"));

  sameNumber(plan.widgets.length, 1, "one planned widget per template widget");
  const planned = plan.widgets[0];
  assert(planned !== undefined, "the widget was planned");
  sameString(planned.title ?? "", "Trend", "the title is copied");
  sameString(planned.widgetType, "chart", "the widget type is copied");
  sameNumber(planned.gridX, widget.gridX, "gridX is copied");
  sameNumber(planned.gridY, widget.gridY, "gridY is copied");
  sameNumber(planned.gridW, widget.gridW, "gridW is copied");
  sameNumber(planned.gridH, widget.gridH, "gridH is copied");
  sameString(
    JSON.stringify(planned.config),
    JSON.stringify(widget.config),
    "the config is copied verbatim",
  );
  sameNumber(planned.points.length, 2, "both keys resolved");
  sameString(planned.points.map((p) => p.pointKey).join(","), "kw,kva", "points keep key order");
}

/** P7 — the role a bound point takes depends on the widget type. */
export function assertAChartBindsSeriesAndATilePrimary(): void {
  const view: TemplateDashboardView = {
    featured: ["kw"],
    widgets: [chart(["kw"]), tile({ pointKeys: ["kw"] })],
  };
  const plan = planView("overview", view, points("kw"));

  sameString(plan.widgets[0]?.pointRole ?? "", "series", "a chart's points are series");
  sameString(plan.widgets[1]?.pointRole ?? "", "primary", "every other type binds a primary point");
}

/** P7 — some keys resolve and some do not: the widget is planned with fewer points. */
export function assertAPartlyResolvedWidgetReportsPartial(): void {
  const view: TemplateDashboardView = { featured: ["kw"], widgets: [chart(["kw", "kva", "pf"])] };
  const plan = planView("overview", view, points("kw", "pf"));

  sameNumber(plan.widgets[0]?.points.length ?? -1, 2, "only the keys that resolve are bound");
  sameString(
    plan.widgets[0]?.points.map((p) => p.pointKey).join(",") ?? "",
    "kw,pf",
    "the unresolved key is dropped and the rest keep their order",
  );
  sameNumber(plan.resolutions[0]?.boundPoints ?? -1, 2, "the report counts the bound points");
  sameString(plan.resolutions[0]?.outcome ?? "", "partial", "some but not all resolved is `partial`");
}

/** P7 — no key resolves: still a planned widget, reported `unresolved`. */
export function assertAWidgetWhoseKeysAllMissIsStillPlanned(): void {
  const view: TemplateDashboardView = { featured: ["kw"], widgets: [chart(["kw", "kva"])] };
  const plan = planView("overview", view, points("nothing"));

  sameNumber(plan.widgets.length, 1, "the widget is planned even with nothing to bind");
  sameNumber(plan.widgets[0]?.points.length ?? -1, 0, "it arrives with zero bindings");
  sameString(plan.resolutions[0]?.outcome ?? "", "unresolved", "nothing resolved is `unresolved`");
}

/**
 * P7b — a `value_tile` may legally declare no point key at all
 * (`WIDGET_POINT_CARDINALITY.value_tile.min` is 0), and that widget is not
 * short of anything. `bound` with `boundPoints: 0` is the designed report.
 */
export function assertAWidgetWithNoPointKeysReportsBound(): void {
  sameNumber(
    WIDGET_POINT_CARDINALITY.value_tile.min,
    0,
    "the control: the authoring schema really does accept a tile with no key",
  );
  const view: TemplateDashboardView = { featured: ["kw"], widgets: [tile({ pointKeys: [] })] };
  const plan = planView("overview", view, points("kw"));

  sameNumber(plan.resolutions[0]?.boundPoints ?? -1, 0, "nothing was asked for");
  sameString(
    plan.resolutions[0]?.outcome ?? "",
    "bound",
    "a widget that asked for nothing is short of nothing",
  );
}

/** P7 — the report carries the ruled constants for a single asset. */
export function assertTheReportCarriesNoRolesAndOneMatchedMember(): void {
  const view: TemplateDashboardView = { featured: ["kw"], widgets: [chart(["kw"])] };
  const plan = planView("overview", view, points("kw"));

  sameNumber(plan.resolutions[0]?.assetRoleCodes.length ?? -1, 0, "an asset template has no roles");
  sameNumber(plan.resolutions[0]?.matchedMembers ?? -1, 1, "one asset is one matched member");
}

/** P8 — the featured fallback lays value tiles on the lattice, left to right. */
export function assertTheFeaturedFallbackLaysTilesOnTheLattice(): void {
  const keys = ["a", "b", "c", "d", "e", "f"];
  const view: TemplateDashboardView = { featured: keys };
  const plan = planView("overview", view, points(...keys));

  sameNumber(plan.widgets.length, 6, "one tile per featured key");
  const lattice = plan.widgets.map((w) => `${w.gridX},${w.gridY}`).join(" ");
  sameString(lattice, "0,0 3,0 6,0 9,0 0,2 3,2", "four tiles per row, two rows deep");
  for (const [index, planned] of plan.widgets.entries()) {
    sameString(planned.widgetType, "value_tile", `tile ${index} is a value tile`);
    sameNumber(planned.gridW, TILE_W, `tile ${index} is three columns wide`);
    sameNumber(planned.gridH, TILE_H, `tile ${index} is two rows high`);
    sameString(planned.title ?? "", keys[index] ?? "", `tile ${index} is titled with its point key`);
    sameString(JSON.stringify(planned.config), "{}", `tile ${index} carries an empty config`);
  }
  sameNumber(plan.omittedFeatured, 0, "nothing was omitted");
  sameNumber(TILES_PER_ROW, DASHBOARD_GRID.columns / TILE_W, "the row width comes from the canvas");
}

/** P9 — the fallback stops at the widget cap, and says how many keys it dropped. */
export function assertTheFallbackStopsAtTheWidgetCapAndReportsTheOmitted(): void {
  const keys = Array.from({ length: 50 }, (_, index) => `k${index}`);
  const view: TemplateDashboardView = { featured: keys };
  const plan = planView("overview", view, points(...keys));

  sameNumber(plan.widgets.length, MAX_DASHBOARD_WIDGETS, "the cap is the dashboard's widget limit");
  sameNumber(plan.omittedFeatured, 10, "the surplus keys are counted, not silently dropped");
  const last = plan.widgets[plan.widgets.length - 1];
  sameNumber(last?.gridX ?? -1, 9, "the last tile sits in the fourth column");
  sameNumber(last?.gridY ?? -1, 18, "the last tile sits on the tenth row of tiles");
  sameNumber(plan.resolutions.length, MAX_DASHBOARD_WIDGETS, "one resolution per planned widget");
}

/**
 * P9, second half — `omittedFeatured` is a fallback statement. A view with
 * `widgets[]` never materialises `featured`, so nothing there was omitted.
 */
export function assertOmittedFeaturedIsZeroWhenTheViewHasWidgets(): void {
  const keys = Array.from({ length: 50 }, (_, index) => `k${index}`);
  const view: TemplateDashboardView = { featured: keys, widgets: [chart(["k0"])] };
  const plan = planView("overview", view, points(...keys));

  sameNumber(plan.widgets.length, 1, "the template's own widgets win over the fallback");
  sameNumber(plan.omittedFeatured, 0, "`featured` is not the source here, so nothing was omitted");
}

/** P10 — the widget key is the view name and the index, unique within the view. */
export function assertWidgetKeysAreTheViewAndIndexAndUnique(): void {
  const view: TemplateDashboardView = {
    featured: ["kw"],
    widgets: [tile({ pointKeys: ["kw"] }), tile({ pointKeys: ["kw"] }), chart(["kw"])],
  };
  const plan = planView("overview", view, points("kw"));

  sameString(
    plan.resolutions.map((r) => r.widgetKey).join(","),
    "overview#0,overview#1,overview#2",
    "the key is `<view>#<index>`",
  );
  sameNumber(
    new Set(plan.resolutions.map((r) => r.widgetKey)).size,
    plan.resolutions.length,
    "every key in a view is distinct",
  );
  const fallback = planView("trends", { featured: ["kw", "kva"] }, points("kw", "kva"));
  sameString(
    fallback.resolutions.map((r) => r.widgetKey).join(","),
    "trends#0,trends#1",
    "the fallback keys its tiles the same way",
  );
}

/** P11 — the batch counts the fallback's tiles as well as the authored widgets. */
export function assertWidgetRowsCountsTheFallbackAndTheWidgets(): void {
  const views: Record<string, TemplateDashboardView> = {
    a: { featured: Array.from({ length: 50 }, (_, index) => `k${index}`) },
    b: { featured: ["k"], widgets: [tile({ pointKeys: ["k"] }), chart(["k"])] },
  };
  sameNumber(
    dashboardWidgetRowsFor(views),
    42,
    "a capped fallback contributes 40 and an authored pair contributes 2",
  );
  sameNumber(dashboardWidgetRowsFor({}), 0, "no view is no widget");
  sameNumber(
    dashboardWidgetRowsFor({ a: { featured: ["k"], widgets: [] } }),
    1,
    "an EMPTY widgets array falls back to featured, exactly as planView does",
  );
}

/** P12 — the batch bound: the limit passes, one row over it is refused by name. */
export function assertTheBatchBoundAcceptsTheLimitAndRefusesOneMore(): void {
  sameNumber(MAX_DASHBOARD_WIDGET_ROWS, 8_000, "the bound is the MAX_POINT_ROWS figure");
  assertDashboardBatchFits(200, 40);

  let message = "";
  try {
    assertDashboardBatchFits(201, 40);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assert(message !== "", "one row over the bound must throw");
  assert(
    message.includes("201 assets × 40 widgets"),
    `the message names both numbers as themselves, not as digits of 8040: ${message}`,
  );
  assert(message.includes("8040"), `the message names the row count: ${message}`);
  assert(message.includes("8000"), `the message names the limit: ${message}`);
}

/** P12 — and the refusal is the API's 400, not a bare `Error`. */
export function assertTheBatchBoundThrowsABadRequest(): void {
  let status = 0;
  try {
    assertDashboardBatchFits(201, 40);
  } catch (error) {
    const response = error as { getStatus?: () => number };
    status = typeof response.getStatus === "function" ? response.getStatus() : 0;
  }
  sameNumber(status, 400, "an over-large batch is the caller's fault, so it is a 400");
}
