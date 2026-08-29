import {
  GAUGE_RANGE_MESSAGE,
  MAX_DASHBOARD_WIDGETS,
  MAX_GAUGE_THRESHOLDS,
  MAX_WIDGET_POINTS,
  WIDGET_POINT_CARDINALITY,
  widgetTypeSchema,
} from "@bms/shared";

import {
  createDashboardBodySchema,
  pointBindingWriteSchema,
  putDashboardWidgetsBodySchema,
  updateDashboardBodySchema,
  widgetWriteSchema,
} from "./dashboards.schema";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type SafeParseable = { safeParse: (v: unknown) => { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] } } };

function expectRejects(schema: SafeParseable, value: unknown, message: string): void {
  const result = schema.safeParse(value);
  assert(result.success === false, `${message} — expected a refusal, got success`);
}

function expectAccepts(schema: SafeParseable, value: unknown, message: string): void {
  const result = schema.safeParse(value);
  assert(
    result.success === true,
    `${message} — expected success, got a refusal: ${JSON.stringify(result.error?.issues)}`,
  );
}

/** Asserts the schema refuses `value` with an issue whose `path` matches exactly, and whose
 * message contains every string in `messageIncludes`. */
function expectRejectsAt(
  schema: SafeParseable,
  value: unknown,
  path: (string | number)[],
  messageIncludes: string[],
  what: string,
): void {
  const result = schema.safeParse(value);
  assert(result.success === false, `${what} — expected a refusal, got success`);
  const issues = result.error?.issues ?? [];
  const hit = issues.find((issue) => JSON.stringify(issue.path) === JSON.stringify(path));
  assert(
    hit !== undefined,
    `${what} — expected an issue at path ${JSON.stringify(path)}, got ${JSON.stringify(issues)}`,
  );
  for (const fragment of messageIncludes) {
    assert(
      (hit?.message ?? "").includes(fragment),
      `${what} — expected the issue at ${JSON.stringify(path)} to mention "${fragment}", got "${hit?.message}"`,
    );
  }
}

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "22222222-2222-4222-8222-222222222222";
const GROUP_ID = "33333333-3333-4333-8333-333333333333";
const POINT_A = "44444444-4444-4444-8444-444444444444";
const POINT_B = "55555555-5555-4555-8555-555555555555";
const POINT_C = "66666666-6666-4666-8666-666666666666";

const validCreateBody = {
  organizationId: ORG_ID,
  slug: "overview",
  name: "Overview",
};

const validGaugeWidget = {
  widgetType: "radial_gauge" as const,
  title: null,
  gridX: 0,
  gridY: 0,
  gridW: 4,
  gridH: 4,
  config: { min: 0, max: 100 },
  points: [{ pointId: POINT_A }],
};

const validChartWidget = {
  widgetType: "chart" as const,
  title: "Load",
  gridX: 4,
  gridY: 0,
  gridW: 8,
  gridH: 4,
  config: { series: "line" as const },
  points: [{ pointId: POINT_A, role: "series" as const, sortOrder: 0 }],
};

/**
 * `F3.1b` Task 3 — the dashboard request bodies. Assertions live here; the sibling `.test.ts`
 * is the Vitest entry point (ADR 0014).
 */
export function runDashboardsSchemaTests(): void {
  // -------------------------------------------------------------------------
  // 1. Unknown key refused — E7.1f on the request axis.
  // -------------------------------------------------------------------------
  expectRejects(
    createDashboardBodySchema,
    { ...validCreateBody, extra: "nope" },
    "an unknown key on the create body must be refused",
  );
  expectRejects(
    updateDashboardBodySchema,
    { name: "x", extra: "nope" },
    "an unknown key on the update body must be refused",
  );
  expectRejects(
    putDashboardWidgetsBodySchema,
    { widgets: [], extra: "nope" },
    "an unknown key on the widgets body must be refused",
  );
  expectRejects(
    widgetWriteSchema,
    { ...validGaugeWidget, extra: "nope" },
    "an unknown key on one widget arm must be refused",
  );
  expectRejects(
    pointBindingWriteSchema,
    { pointId: POINT_A, extra: "nope" },
    "an unknown key on one point binding must be refused",
  );

  // -------------------------------------------------------------------------
  // 2. discriminatedUnion of strict arms parses a valid gauge and a valid
  //    chart — the intersection trap this file's docblock records.
  // -------------------------------------------------------------------------
  expectAccepts(widgetWriteSchema, validGaugeWidget, "a well-formed gauge widget must parse");
  expectAccepts(widgetWriteSchema, validChartWidget, "a well-formed chart widget must parse");

  // -------------------------------------------------------------------------
  // 3. Both scope columns set is refused with path ["assetGroupId"] — by the
  //    SCHEMA, never by dashboards_scope_check (no database is touched here).
  // -------------------------------------------------------------------------
  expectRejectsAt(
    createDashboardBodySchema,
    { ...validCreateBody, locationId: LOCATION_ID, assetGroupId: GROUP_ID },
    ["assetGroupId"],
    ["one of locationId"],
    "both scope columns set on create",
  );
  expectAccepts(
    createDashboardBodySchema,
    { ...validCreateBody, locationId: LOCATION_ID },
    "a location-scoped create must parse",
  );
  expectAccepts(
    createDashboardBodySchema,
    validCreateBody,
    "an organization-wide create (both scope columns absent) must parse",
  );
  expectRejectsAt(
    updateDashboardBodySchema,
    { locationId: LOCATION_ID, assetGroupId: GROUP_ID },
    ["assetGroupId"],
    ["one of locationId"],
    "both scope columns set on update",
  );

  // -------------------------------------------------------------------------
  // 4. Cardinality, read from WIDGET_POINT_CARDINALITY — never a literal.
  // -------------------------------------------------------------------------
  const gaugeMax = WIDGET_POINT_CARDINALITY.radial_gauge.max;
  expectRejectsAt(
    widgetWriteSchema,
    { ...validGaugeWidget, points: [{ pointId: POINT_A }, { pointId: POINT_B }] },
    ["points"],
    [`at most ${gaugeMax}`, "radial_gauge"],
    "a radial_gauge with two bindings must be refused, naming the type and the limit",
  );
  expectAccepts(
    widgetWriteSchema,
    { ...validGaugeWidget, points: [{ pointId: POINT_A }] },
    "a radial_gauge with exactly one binding must parse",
  );

  const chartMax = WIDGET_POINT_CARDINALITY.chart.max;
  assert(chartMax === MAX_WIDGET_POINTS, "chart's cardinality max must equal MAX_WIDGET_POINTS");
  const atCap = Array.from({ length: chartMax }, (_unused, i) => ({
    pointId: `77777777-7777-4777-8777-77777777${String(i).padStart(4, "0")}`,
  }));
  expectAccepts(
    widgetWriteSchema,
    { ...validChartWidget, points: atCap },
    `a chart with exactly MAX_WIDGET_POINTS (${chartMax}) bindings must parse`,
  );
  const overCap = [
    ...atCap,
    { pointId: "88888888-8888-4888-8888-888888888888" },
  ];
  expectRejectsAt(
    widgetWriteSchema,
    { ...validChartWidget, points: overCap },
    ["points"],
    [`at most ${chartMax}`, "chart"],
    "a chart with MAX_WIDGET_POINTS + 1 bindings must be refused",
  );

  // -------------------------------------------------------------------------
  // 5. Gauge range: min above max is refused, reusing the exported predicate's
  //    message and path — never a restated literal.
  // -------------------------------------------------------------------------
  expectRejectsAt(
    widgetWriteSchema,
    { ...validGaugeWidget, config: { min: 10, max: 5 } },
    ["config", "max"],
    [GAUGE_RANGE_MESSAGE],
    "an inverted gauge range must be refused",
  );

  // -------------------------------------------------------------------------
  // 6. Every shared widget type has a write arm.
  // -------------------------------------------------------------------------
  assert(
    widgetWriteSchema.options.length === widgetTypeSchema.options.length,
    `every shared widget type needs a write arm — shared has ${widgetTypeSchema.options.length}, ` +
      `this file has ${widgetWriteSchema.options.length}`,
  );

  // -------------------------------------------------------------------------
  // 7. Two bindings with the same (pointId, role) refused by the SCHEMA, not
  //    by dashboard_widget_points_widget_point_role_key's 23505.
  // -------------------------------------------------------------------------
  expectRejects(
    widgetWriteSchema,
    {
      ...validChartWidget,
      points: [
        { pointId: POINT_A, role: "series", sortOrder: 0 },
        { pointId: POINT_A, role: "series", sortOrder: 1 },
      ],
    },
    "two bindings with the same (pointId, role) must be refused",
  );
  expectAccepts(
    widgetWriteSchema,
    {
      ...validChartWidget,
      points: [
        { pointId: POINT_A, role: "series", sortOrder: 0 },
        { pointId: POINT_A, role: "primary", sortOrder: 1 },
      ],
    },
    "the same point bound twice under DIFFERENT roles must parse",
  );

  // -------------------------------------------------------------------------
  // Grid overflow — the cross-widget superRefine on the widgets ARRAY, since
  // an individual arm cannot carry it and stay a ZodObject.
  // -------------------------------------------------------------------------
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...validGaugeWidget, gridX: 10, gridW: 4 }] },
    ["widgets", 0, "gridW"],
    ["12-column canvas"],
    "a widget overflowing the 12-column canvas must be refused",
  );
  expectAccepts(
    putDashboardWidgetsBodySchema,
    { widgets: [validGaugeWidget, validChartWidget] },
    "a well-formed widget set must parse",
  );

  // -------------------------------------------------------------------------
  // Finding 6 (review) — the two write bounds that had no refusal test:
  // MAX_DASHBOARD_WIDGETS widgets per PUT, and MAX_GAUGE_THRESHOLDS threshold
  // bands per gauge. Both build the array at the bound and one past it, so a
  // deleted or widened `.max()` on either schema is what these catch —
  // the gauge thresholds `.strict()` item is already gated by the ledger
  // walk; the two `.max()` counts themselves were not.
  // -------------------------------------------------------------------------
  const widgetsAtCap = Array.from({ length: MAX_DASHBOARD_WIDGETS }, () => validGaugeWidget);
  const widgetsOverCap = [...widgetsAtCap, validGaugeWidget];
  expectAccepts(
    putDashboardWidgetsBodySchema,
    { widgets: widgetsAtCap },
    `exactly MAX_DASHBOARD_WIDGETS (${MAX_DASHBOARD_WIDGETS}) widgets must parse`,
  );
  expectRejects(
    putDashboardWidgetsBodySchema,
    { widgets: widgetsOverCap },
    `MAX_DASHBOARD_WIDGETS + 1 (${MAX_DASHBOARD_WIDGETS + 1}) widgets must be refused`,
  );

  const thresholdsAtCap = Array.from({ length: MAX_GAUGE_THRESHOLDS }, (_unused, i) => ({
    value: i,
    tone: "info" as const,
  }));
  const thresholdsOverCap = [...thresholdsAtCap, { value: MAX_GAUGE_THRESHOLDS, tone: "info" as const }];
  expectAccepts(
    widgetWriteSchema,
    { ...validGaugeWidget, config: { min: 0, max: 100, thresholds: thresholdsAtCap } },
    `exactly MAX_GAUGE_THRESHOLDS (${MAX_GAUGE_THRESHOLDS}) threshold bands must parse`,
  );
  expectRejects(
    widgetWriteSchema,
    { ...validGaugeWidget, config: { min: 0, max: 100, thresholds: thresholdsOverCap } },
    `MAX_GAUGE_THRESHOLDS + 1 (${MAX_GAUGE_THRESHOLDS + 1}) threshold bands must be refused`,
  );

  // -------------------------------------------------------------------------
  // id is optional on write, and preserved when supplied (D2's id-preserving
  // sync — DashboardsService.spec.ts proves the diff; this proves the parse).
  // -------------------------------------------------------------------------
  const withId = { ...validGaugeWidget, id: POINT_C };
  const parsed = widgetWriteSchema.safeParse(withId);
  assert(parsed.success === true, "a widget with an id must still parse");
  if (parsed.success) {
    assert(parsed.data.id === POINT_C, "a supplied id must survive parsing unchanged");
  }
}
