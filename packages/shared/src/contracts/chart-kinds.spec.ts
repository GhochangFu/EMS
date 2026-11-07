import {
  CHART_KIND_LABELS,
  CHART_KINDS_NEEDING_AGGREGATE,
  chartKindAggregateMessage,
  chartKindIssues,
  HEATMAP_MAX_WINDOW_MINUTES,
  HEATMAP_MIN_WINDOW_MINUTES,
  HEATMAP_ONE_POINT_MESSAGE,
  HEATMAP_WINDOW_MESSAGE,
} from "./chart-kinds";
import { templateDashboardWidgetSchema } from "./asset-template-content-writes";
import { sectionTemplateWidgetSchema } from "./dashboard-templates";
import { chartSeriesKindSchema } from "./dashboard-builder";
import { putDashboardWidgetsBodySchema } from "./dashboard-writes";

/**
 * `F4.323` / ADR 0047 Amendment 7 — the per-kind rules of the `chart` widget. Assertions live
 * here; `chart-kinds.test.ts` is the Vitest entry point (ADR 0014).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const POINT_A = "44444444-4444-4444-8444-444444444444";
const POINT_B = "55555555-5555-4555-8555-555555555555";

const chart = (config: Record<string, unknown>, points = [POINT_A]) => ({
  widgetType: "chart" as const,
  title: "Kind",
  gridX: 0,
  gridY: 0,
  gridW: 6,
  gridH: 4,
  config,
  points: points.map((pointId, sortOrder) => ({ pointId, role: "series" as const, sortOrder })),
});

export function compareAndDonutNeedAnAggregate(): void {
  assert(
    JSON.stringify(CHART_KINDS_NEEDING_AGGREGATE) === JSON.stringify(["compare", "donut", "heatmap"]),
    `compare, donut and heatmap are the kinds that need an aggregate, got ${JSON.stringify(CHART_KINDS_NEEDING_AGGREGATE)}`,
  );
  for (const series of ["compare", "donut"] as const) {
    const issues = chartKindIssues({ series }, 2);
    assert(
      issues.length === 1 &&
        JSON.stringify(issues[0]?.path) === JSON.stringify(["config", "aggregate"]) &&
        issues[0]?.message === chartKindAggregateMessage(series),
      `${series} without aggregate must be one issue at config.aggregate, got ${JSON.stringify(issues)}`,
    );
    assert(
      chartKindIssues({ series, aggregate: "sum" }, 2).length === 0,
      `${series} with an aggregate must pass`,
    );
  }
}

export function timeKindsNeedNoAggregate(): void {
  for (const series of ["line", "area", "bar", "scatter", "step"] as const) {
    assert(chartKindIssues({ series }, 3).length === 0, `${series} without aggregate must pass`);
  }
}

export function theLiveWritePathRefusesAtTheWidget(): void {
  const result = putDashboardWidgetsBodySchema.safeParse({
    widgets: [chart({ series: "line" }), chart({ series: "donut" }, [POINT_A, POINT_B])],
  });
  assert(result.success === false, "a donut without aggregate must be refused on PUT :id/widgets");
  const issues = result.success ? [] : result.error.issues;
  const hit = issues.find((issue) => JSON.stringify(issue.path) === JSON.stringify(["widgets", 1, "config", "aggregate"]));
  assert(
    hit?.message === chartKindAggregateMessage("donut"),
    `the refusal must sit at widgets[1].config.aggregate, got ${JSON.stringify(issues)}`,
  );

  const ok = putDashboardWidgetsBodySchema.safeParse({
    widgets: [
      chart({ series: "step" }),
      chart({ series: "compare", aggregate: "sum", windowMinutes: 1_440 }, [POINT_A, POINT_B]),
      chart({ series: "donut", aggregate: "avg" }, [POINT_A, POINT_B]),
    ],
  });
  assert(ok.success === true, `step, compare and donut with aggregate must parse: ${JSON.stringify(ok.error?.issues)}`);
}

export function theAssetTemplatePathRefusesTheSameRule(): void {
  const base = { gridX: 0, gridY: 0, gridW: 6, gridH: 4, widgetType: "chart", pointKeys: ["kw", "kva"] };
  const refused = templateDashboardWidgetSchema.safeParse({ ...base, config: { series: "compare" } });
  assert(refused.success === false, "a template compare chart without aggregate must be refused");
  const issues = refused.success ? [] : refused.error.issues;
  assert(
    issues.some(
      (issue) =>
        JSON.stringify(issue.path) === JSON.stringify(["config", "aggregate"]) &&
        issue.message === chartKindAggregateMessage("compare"),
    ),
    `the refusal must sit at config.aggregate, got ${JSON.stringify(issues)}`,
  );
  const ok = templateDashboardWidgetSchema.safeParse({ ...base, config: { series: "compare", aggregate: "sum" } });
  assert(ok.success === true, `a template compare chart with aggregate must parse: ${JSON.stringify(ok.error?.issues)}`);
  const grid = templateDashboardWidgetSchema.safeParse({ ...base, gridX: 8, config: { series: "line" } });
  assert(
    grid.success === false && grid.error.issues.some((issue) => JSON.stringify(issue.path) === JSON.stringify(["gridW"])),
    "the grid rule still refuses at gridW beside the kind rule",
  );
}

export function theSectionTemplatePathRefusesWithTheWidgetKey(): void {
  const base = {
    key: "share",
    title: null,
    gridX: 0,
    gridY: 0,
    gridW: 6,
    gridH: 4,
    bindings: [
      { assetRoleCode: "meter", pointKey: "kw" },
      { assetRoleCode: "meter", pointKey: "kva" },
    ],
    sources: [],
    widgetType: "chart",
  };
  const refused = sectionTemplateWidgetSchema.safeParse({ ...base, config: { series: "donut" } });
  assert(refused.success === false, "a section template donut without aggregate must be refused");
  const issues = refused.success ? [] : refused.error.issues;
  assert(
    issues.some(
      (issue) =>
        JSON.stringify(issue.path) === JSON.stringify(["config", "aggregate"]) &&
        issue.message === `Widget "share": ${chartKindAggregateMessage("donut")}`,
    ),
    `the refusal must name the widget key at config.aggregate, got ${JSON.stringify(issues)}`,
  );
  const ok = sectionTemplateWidgetSchema.safeParse({ ...base, config: { series: "donut", aggregate: "sum" } });
  assert(ok.success === true, `a section template donut with aggregate must parse: ${JSON.stringify(ok.error?.issues)}`);
}

/**
 * `F4.323` PR 2 (ADR 0047 Amendment 7 item 5) — the heatmap: exactly one point, an aggregate,
 * and a window of 7 to 30 days, which is the read ladder's hourly rung exactly.
 */
export function theHeatmapRules(): void {
  assert(HEATMAP_MIN_WINDOW_MINUTES === 10_080 && HEATMAP_MAX_WINDOW_MINUTES === 43_200, "7 to 30 days in minutes");
  const ok = { series: "heatmap" as const, aggregate: "avg" as const, windowMinutes: 10_080 };
  assert(chartKindIssues(ok, 1).length === 0, "a 7-day, one-point, averaged heatmap passes");
  assert(chartKindIssues({ ...ok, windowMinutes: 43_200 }, 1).length === 0, "30 days passes");

  const at = (issues: ReturnType<typeof chartKindIssues>) => issues.map((i) => i.path.join("."));
  assert(
    JSON.stringify(at(chartKindIssues({ ...ok, aggregate: undefined }, 1))) === JSON.stringify(["config.aggregate"]),
    "a heatmap needs an aggregate",
  );
  assert(
    JSON.stringify(at(chartKindIssues(ok, 2))) === JSON.stringify(["points"]) &&
      chartKindIssues(ok, 2)[0]?.message === HEATMAP_ONE_POINT_MESSAGE,
    "a second point is refused at points",
  );
  for (const windowMinutes of [undefined, 10_079, 43_201, 1_440]) {
    const issues = chartKindIssues({ ...ok, windowMinutes }, 1);
    assert(
      JSON.stringify(at(issues)) === JSON.stringify(["config.windowMinutes"]) && issues[0]?.message === HEATMAP_WINDOW_MESSAGE,
      `window ${windowMinutes} is refused at config.windowMinutes, got ${JSON.stringify(issues)}`,
    );
  }
  assert(chartKindIssues(ok, 0).length === 0, "zero points is each path's own rule, not the kind's");

  const refused = putDashboardWidgetsBodySchema.safeParse({
    widgets: [chart({ series: "heatmap", aggregate: "avg", windowMinutes: 4_320 }, [POINT_A, POINT_B])],
  });
  const paths = refused.success ? [] : refused.error.issues.map((i) => i.path.join("."));
  assert(
    paths.includes("widgets.0.points") && paths.includes("widgets.0.config.windowMinutes"),
    `PUT :id/widgets refuses both, got ${JSON.stringify(paths)}`,
  );
  const accepted = putDashboardWidgetsBodySchema.safeParse({ widgets: [chart(ok)] });
  assert(accepted.success === true, `a valid heatmap saves: ${JSON.stringify(accepted.error?.issues)}`);
}

/** The heatmap's point and window rules on the two template paths, beside a positive case each. */
export function theTemplatePathsRefuseTheHeatmapRules(): void {
  const ok = { series: "heatmap", aggregate: "avg", windowMinutes: 10_080 };
  const asset = { gridX: 0, gridY: 0, gridW: 6, gridH: 4, widgetType: "chart" };
  const assetBad = templateDashboardWidgetSchema.safeParse({ ...asset, pointKeys: ["kw", "kva"], config: { ...ok, windowMinutes: 4_320 } });
  const assetPaths = assetBad.success ? [] : assetBad.error.issues.map((i) => i.path.join("."));
  assert(
    assetPaths.includes("points") && assetPaths.includes("config.windowMinutes"),
    `the asset template refuses two point keys and a 3-day window, got ${JSON.stringify(assetPaths)}`,
  );
  assert(templateDashboardWidgetSchema.safeParse({ ...asset, pointKeys: ["kw"], config: ok }).success, "one key, 7 days, parses");

  const section = { key: "pattern", title: null, gridX: 0, gridY: 0, gridW: 6, gridH: 4, sources: [], widgetType: "chart" };
  const two = [
    { assetRoleCode: "meter", pointKey: "kw" },
    { assetRoleCode: "meter", pointKey: "kva" },
  ];
  const sectionBad = sectionTemplateWidgetSchema.safeParse({ ...section, bindings: two, config: { ...ok, windowMinutes: undefined } });
  const issues = sectionBad.success ? [] : sectionBad.error.issues;
  assert(
    issues.some((i) => i.path.join(".") === "points" && i.message === `Widget "pattern": ${HEATMAP_ONE_POINT_MESSAGE}`) &&
      issues.some((i) => i.path.join(".") === "config.windowMinutes" && i.message === `Widget "pattern": ${HEATMAP_WINDOW_MESSAGE}`),
    `the section template refuses both, under its key, got ${JSON.stringify(issues)}`,
  );
  assert(
    sectionTemplateWidgetSchema.safeParse({ ...section, bindings: two.slice(0, 1), config: ok }).success,
    "one binding, 7 days, parses",
  );
}

/** `F4.324` — one plain label per kind, in the contract's order (ADR 0099 Amendment 16 decision 3). */
export function everyKindHasItsPlainLabel(): void {
  assert(
    JSON.stringify(Object.keys(CHART_KIND_LABELS)) === JSON.stringify(chartSeriesKindSchema.options),
    `one label per kind, in order; got ${JSON.stringify(Object.keys(CHART_KIND_LABELS))}`,
  );
  assert(CHART_KIND_LABELS.donut === "Share (donut)" && CHART_KIND_LABELS.line === "Trend", "the owner's labels");
}
