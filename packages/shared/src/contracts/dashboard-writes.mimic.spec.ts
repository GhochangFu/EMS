import { MIMIC_LAYOUT_ID_CASE_MESSAGE } from "./mimic-config";

import { expectAccepts, expectRejectsAt, POINT_A } from "./dashboard-writes.spec";

import { putDashboardWidgetsBodySchema } from "./dashboard-writes";

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

// ---------------------------------------------------------------- F3.32c — the layout arm

const LAYOUT_ID = "44444444-4444-4444-8444-444444444444";

const layoutMimicWidget = { ...validMimicWidget, config: { source: "layout" as const, layoutId: LAYOUT_ID } };

/** `F3.32c` / ADR 0081 decision 5 — the layout arm parses: a uuid, nothing else. */
export function acceptsTheLayoutArm(): void {
  expectAccepts(
    putDashboardWidgetsBodySchema,
    { widgets: [layoutMimicWidget] },
    "a mimic naming a layout by uuid must parse",
  );
}

/** A layout arm with no `layoutId` names nothing to draw. */
export function refusesALayoutArmWithoutALayoutId(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...validMimicWidget, config: { source: "layout" } }] },
    ["widgets", 0, "config", "layoutId"],
    ["Required"],
    "a layout arm without layoutId must be refused",
  );
}

/** A `layoutId` that is not a uuid is refused before any SQL sees it. */
export function refusesALayoutArmWhoseIdIsNotAUuid(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...validMimicWidget, config: { source: "layout", layoutId: "water_train" } }] },
    ["widgets", 0, "config", "layoutId"],
    ["uuid"],
    "a layout arm whose layoutId is not a uuid must be refused",
  );
}

/**
 * The write surface rebuilds the arm from `mimicLayoutConfigSchema.shape`, so it carries the shared
 * lowercase rule: an uppercase `layoutId` is refused at that path with the case sentence.
 */
export function refusesALayoutArmWhoseIdIsUppercase(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...validMimicWidget, config: { source: "layout", layoutId: LAYOUT_ID.replace(/4/g, "A") } }] },
    ["widgets", 0, "config", "layoutId"],
    [MIMIC_LAYOUT_ID_CASE_MESSAGE],
    "a layout arm whose layoutId is uppercase must be refused",
  );
}

/**
 * The layout arm is strict too. The preset arm's `unit` case above cannot tell this: an arm left
 * non-strict would strip `preset` here and store a config the read never asked for.
 */
export function refusesALayoutArmCarryingAPreset(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...layoutMimicWidget, config: { ...layoutMimicWidget.config, preset: "water_train" } }] },
    ["widgets", 0, "config"],
    ["preset"],
    "a layout arm carrying a preset key must be refused as an unrecognized key",
  );
}

/** A `source` neither arm declares is refused on the discriminator. */
export function refusesAnUnknownSource(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...validMimicWidget, config: { source: "network", layoutId: LAYOUT_ID } }] },
    ["widgets", 0, "config", "source"],
    ["discriminator"],
    "a mimic config whose source is neither preset nor layout must be refused",
  );
}
