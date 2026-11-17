import { expectAccepts, expectRejectsAt, POINT_A } from "./dashboard-writes.spec";

import { widgetTypeSchema } from "./dashboard-builder";
import { putDashboardWidgetsBodySchema, widgetWriteSchema } from "./dashboard-writes";
import { ML_FINDINGS_WIDGET_SHOW, mlFindingsWidgetConfigSchema } from "./ml-findings-widget";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/**
 * An `ml_findings` widget (`E1.9f`, ADR 0135 Amendment 8 decision 13). It binds no point and no
 * source; its config holds renderer options only (`show`, `paragraph`), both optional (R-u).
 */
const validMlFindingsWidget = {
  widgetType: "ml_findings" as const,
  title: "Findings",
  gridX: 0,
  gridY: 0,
  gridW: 6,
  gridH: 4,
  config: { show: "both", paragraph: true },
  points: [],
  sources: [],
};

const withConfig = (config: unknown): unknown => ({ widgets: [{ ...validMlFindingsWidget, config }] });

/** The arm exists, last, and `{}`, `{ show: "anomalies" }` and `{ paragraph: false }` parse. */
export function acceptsAnMlFindingsWidget(): void {
  assert(
    widgetWriteSchema.options.length === widgetTypeSchema.options.length,
    `every widget type needs a write arm — ${widgetTypeSchema.options.length} types, ` +
      `${widgetWriteSchema.options.length} arms`,
  );
  assert(
    widgetWriteSchema.options.at(-1)?.shape.widgetType.value === "ml_findings",
    "the ml_findings arm is appended last, so no existing arm index moves",
  );
  expectAccepts(putDashboardWidgetsBodySchema, { widgets: [validMlFindingsWidget] }, "the builder's own config");
  expectAccepts(putDashboardWidgetsBodySchema, withConfig({}), "an empty config (both keys are optional)");
  expectAccepts(putDashboardWidgetsBodySchema, withConfig({ show: "anomalies" }), "show only");
  expectAccepts(putDashboardWidgetsBodySchema, withConfig({ paragraph: false }), "paragraph only");
}

/** `.strict()` refuses an unknown key, and `show` is closed. */
export function refusesAnMlFindingsConfigOutsideItsTwoKeys(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    withConfig({ show: "both", paragraph: true, limit: 5 }),
    ["widgets", 0, "config"],
    ["limit"],
    "an ml_findings config holds show and paragraph only — limit is an unrecognized key",
  );
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    withConfig({ show: "all" }),
    ["widgets", 0, "config", "show"],
    ["Invalid enum value"],
    "show is both, forecasts or anomalies",
  );
  assert(
    JSON.stringify(ML_FINDINGS_WIDGET_SHOW) === JSON.stringify(["both", "forecasts", "anomalies"]),
    "the three show values (ADR 0135 Amendment 8 decision 13)",
  );
  // R-u: no `.default()`, so the parsed config is exactly what was sent.
  const parsed = mlFindingsWidgetConfigSchema.parse({});
  assert(JSON.stringify(parsed) === "{}", "no default fills a missing key (R-u, the ADR 0030 trap)");
}

/** It binds nothing: a point or a source is a 400 at its own field. */
export function refusesAnMlFindingsBinding(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...validMlFindingsWidget, points: [{ pointId: POINT_A }] }] },
    ["widgets", 0, "points"],
    ["at most 0"],
    "an ml_findings widget with a point must be refused — its scope is the dashboard's",
  );
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...validMlFindingsWidget, sources: [{ catalogKey: "alarms.active.count", params: {} }] }] },
    ["widgets", 0, "sources"],
    ["at most 0"],
    "an ml_findings widget with a catalog source must be refused",
  );
}
