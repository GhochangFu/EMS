import { expectAccepts, expectRejectsAt, POINT_A } from "./dashboard-writes.spec";

import { widgetTypeSchema } from "./dashboard-builder";
import { putDashboardWidgetsBodySchema, widgetWriteSchema } from "./dashboard-writes";
import { ANOMALY_WIDGET_HOURS, anomalyWidgetConfigSchema } from "./anomaly-widget";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const POINT_B = "77777777-7777-4777-8777-777777777777";

/**
 * A `anomaly` widget (`E1.2d`, ADR 0135 Amendment 5 ruling 4(c)). It binds exactly one point, as a
 * `dashboard_widget_points` row, and no source; its config is `{}` (plan R16).
 */
const validAnomalyWidget = {
  widgetType: "anomaly" as const,
  title: "Chiller anomaly",
  gridX: 0,
  gridY: 0,
  gridW: 6,
  gridH: 4,
  config: {},
  points: [{ pointId: POINT_A }],
  sources: [],
};

/** The arm exists, last, and a widget with its one point parses. */
export function acceptsAAnomalyWithOnePoint(): void {
  assert(
    widgetWriteSchema.options.length === widgetTypeSchema.options.length,
    `every widget type needs a write arm — ${widgetTypeSchema.options.length} types, ` +
      `${widgetWriteSchema.options.length} arms`,
  );
  assert(
    widgetWriteSchema.options.at(-1)?.shape.widgetType.value === "anomaly",
    "the anomaly arm is appended last, so no existing arm index moves",
  );
  expectAccepts(putDashboardWidgetsBodySchema, { widgets: [validAnomalyWidget] }, "an anomaly with one point");
}

/** No point, two points, or a source: each a 400 at its own field. */
export function refusesAAnomalyWithoutExactlyOnePoint(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...validAnomalyWidget, points: [] }] },
    ["widgets", 0, "points"],
    ["at least 1"],
    "an anomaly with no point must be refused — its point cardinality is {min: 1, max: 1}",
  );
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...validAnomalyWidget, points: [{ pointId: POINT_A }, { pointId: POINT_B }] }] },
    ["widgets", 0, "points"],
    ["at most 1"],
    "an anomaly with two points must be refused",
  );
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...validAnomalyWidget, sources: [{ catalogKey: "alarms.active.count", params: {} }] }] },
    ["widgets", 0, "sources"],
    ["at most 0"],
    "an anomaly with a catalog source must be refused",
  );
}

/** The config is strict and empty (R16): a unit is an unrecognized key — the point is not drawn. */
export function refusesAAnomalyConfigKey(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...validAnomalyWidget, config: { unit: "kW" } }] },
    ["widgets", 0, "config"],
    ["unit"],
    "an anomaly config declares nothing — a unit is an unrecognized key",
  );
  assert(anomalyWidgetConfigSchema.safeParse({}).success, "the shared anomaly config is {}");
  assert(ANOMALY_WIDGET_HOURS === 168, "the widget draws the last 7 days (ruling 4(c))");
}
