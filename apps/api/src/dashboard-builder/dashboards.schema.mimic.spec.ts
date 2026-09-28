import { expectAccepts, expectRejectsAt, POINT_A } from "./dashboards.schema.spec";

import { putDashboardWidgetsBodySchema } from "./dashboards.schema";

/**
 * A `mimic` (`F3.32`, ADR 0079). It binds nothing: its nodes resolve at read time from the
 * dashboard's asset group, so `points` and `sources` are both empty and both capped at zero.
 */
const validMimicWidget = {
  widgetType: "mimic" as const,
  title: "Water train",
  gridX: 0,
  gridY: 0,
  gridW: 12,
  gridH: 6,
  config: { source: "preset" as const, preset: "water_train" as const },
  points: [],
  sources: [],
};

/**
 * `F3.32` / ADR 0079 — the one type that binds nothing. `exactlyOneBindingKind` would read
 * its empty arrays as "neither kind bound" and answer `bindingRequiredMessage`; the early
 * return on `widgetTypeBindsNothing` is what lets it save.
 */
export function runDashboardsSchemaMimicSourceShapeTests(): void {
  expectAccepts(
    putDashboardWidgetsBodySchema,
    { widgets: [validMimicWidget] },
    "a mimic with no points and no sources must parse — it binds nothing by design",
  );
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...validMimicWidget, points: [{ pointId: POINT_A }] }] },
    ["widgets", 0, "points"],
    ["at most 0"],
    "a mimic carrying a point must be refused — its point cardinality is {min: 0, max: 0}",
  );
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...validMimicWidget, config: { ...validMimicWidget.config, unit: "kW" } }] },
    ["widgets", 0, "config"],
    ["unit"],
    "a mimic config is strict and declares no unit (D8) — a unit is an unrecognized key",
  );
}
