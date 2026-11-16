import { expectAccepts, expectRejectsAt, POINT_A } from "./dashboard-writes.spec";

import { widgetTypeSchema } from "./dashboard-builder";
import { putDashboardWidgetsBodySchema, widgetWriteSchema } from "./dashboard-writes";
import { FORECAST_WIDGET_ACTUAL_HOURS, forecastWidgetConfigSchema } from "./forecast-widget";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const POINT_B = "77777777-7777-4777-8777-777777777777";

/**
 * A `forecast` widget (`E1.4c`, ADR 0135 Amendment 3 C1). It binds exactly one point, as a
 * `dashboard_widget_points` row, and no source; its config is `{}` (plan R11).
 */
const validForecastWidget = {
  widgetType: "forecast" as const,
  title: "Chiller load",
  gridX: 0,
  gridY: 0,
  gridW: 6,
  gridH: 4,
  config: {},
  points: [{ pointId: POINT_A }],
  sources: [],
};

/** The arm exists, last, and a widget with its one point parses. */
export function acceptsAForecastWithOnePoint(): void {
  assert(
    widgetWriteSchema.options.length === widgetTypeSchema.options.length,
    `every widget type needs a write arm — ${widgetTypeSchema.options.length} types, ` +
      `${widgetWriteSchema.options.length} arms`,
  );
  assert(
    widgetWriteSchema.options.at(13)?.shape.widgetType.value === "forecast",
    "the forecast arm is the fourteenth (index 13), so no arm index moved when E1.2d appended anomaly",
  );
  expectAccepts(putDashboardWidgetsBodySchema, { widgets: [validForecastWidget] }, "a forecast with one point");
}

/** No point, two points, or a source: each a 400 at its own field. */
export function refusesAForecastWithoutExactlyOnePoint(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...validForecastWidget, points: [] }] },
    ["widgets", 0, "points"],
    ["at least 1"],
    "a forecast with no point must be refused — its point cardinality is {min: 1, max: 1}",
  );
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...validForecastWidget, points: [{ pointId: POINT_A }, { pointId: POINT_B }] }] },
    ["widgets", 0, "points"],
    ["at most 1"],
    "a forecast with two points must be refused",
  );
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...validForecastWidget, sources: [{ catalogKey: "alarms.active.count", params: {} }] }] },
    ["widgets", 0, "sources"],
    ["at most 0"],
    "a forecast with a catalog source must be refused",
  );
}

/** The config is strict and empty: a unit is an unrecognized key (the unit comes from the point). */
export function refusesAForecastConfigKey(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...validForecastWidget, config: { unit: "kW" } }] },
    ["widgets", 0, "config"],
    ["unit"],
    "a forecast config declares nothing — a unit is an unrecognized key",
  );
  assert(forecastWidgetConfigSchema.safeParse({}).success, "the shared forecast config is {}");
  assert(FORECAST_WIDGET_ACTUAL_HOURS === 24, "the widget draws the last 24 h of actuals (plan R10)");
}
