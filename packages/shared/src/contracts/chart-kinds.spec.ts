import {
  CHART_KINDS_NEEDING_AGGREGATE,
  chartKindAggregateMessage,
  chartKindIssues,
} from "./chart-kinds";
import { templateDashboardWidgetSchema } from "./asset-template-content-writes";
import { sectionTemplateWidgetSchema } from "./dashboard-templates";
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
    JSON.stringify(CHART_KINDS_NEEDING_AGGREGATE) === JSON.stringify(["compare", "donut"]),
    `compare and donut are the kinds that need an aggregate, got ${JSON.stringify(CHART_KINDS_NEEDING_AGGREGATE)}`,
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
