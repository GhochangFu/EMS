import {
  DASHBOARD_GRID,
  GAUGE_RANGE_MESSAGE,
  MAX_DASHBOARD_WIDGETS,
  MAX_GAUGE_THRESHOLDS,
  MAX_WIDGET_POINTS,
  METRIC_CATALOG,
  WIDGET_POINT_CARDINALITY,
  WIDGET_SOURCE_CARDINALITY,
  WIDGET_SOURCE_SHAPES,
  bindingShapeMessage,
  columnNotDeclaredMessage,
  duplicateColumnMessage,
  widgetTypeSchema,
} from "@bms/shared";
import type { MetricCatalogKey } from "@bms/shared";

import {
  createDashboardBodySchema,
  listDashboardsQuerySchema,
  pointBindingWriteSchema,
  putDashboardWidgetsBodySchema,
  SCOPE_REFUSAL_MESSAGE,
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
/** `F3.2` / ADR 0067 decision 1 — the third scope axis. */
const ASSET_ID = "77777777-7777-4777-8777-777777777777";
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

/**
 * A `table` bound to a dataset (`F3.35` Stage B). `sources` is required at `{min: 1, max: 1}`
 * and `points` at `{min: 0, max: 0}`, so this is the only shape a table can legally take.
 */
const validTableWidget = {
  widgetType: "table" as const,
  title: "Active alarms",
  gridX: 0,
  gridY: 0,
  gridW: 6,
  gridH: 5,
  config: {},
  points: [],
  sources: [{ catalogKey: "alarms.active" as const, params: {} }],
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
  // 3b. `F3.2` Task 3 — `assetId` is the THIRD scope axis (ADR 0067 decision 1,
  //     `dashboards_scope_check`'s count form in migration 0073). The refusal
  //     message is asserted as literal text rather than against the imported
  //     constant: a constant compared to itself is a tautology, and this
  //     sentence is the one a caller reads, so a silent reword must redden.
  // -------------------------------------------------------------------------
  const SCOPE_SENTENCE =
    "at most one of locationId, assetGroupId or assetId may be set — all null is organization-wide";
  assert(
    SCOPE_REFUSAL_MESSAGE === SCOPE_SENTENCE,
    `the exported SCOPE_REFUSAL_MESSAGE must be exactly the sentence DashboardsService.update ` +
      `also throws, got "${SCOPE_REFUSAL_MESSAGE}"`,
  );
  expectAccepts(
    createDashboardBodySchema,
    { ...validCreateBody, assetId: ASSET_ID },
    "an asset-scoped create (assetId alone) must parse",
  );
  expectRejectsAt(
    createDashboardBodySchema,
    { ...validCreateBody, assetId: ASSET_ID, locationId: LOCATION_ID },
    ["assetGroupId"],
    [SCOPE_SENTENCE],
    "assetId AND locationId set on create",
  );
  expectRejectsAt(
    createDashboardBodySchema,
    { ...validCreateBody, assetId: ASSET_ID, assetGroupId: GROUP_ID },
    ["assetGroupId"],
    [SCOPE_SENTENCE],
    "assetId AND assetGroupId set on create",
  );
  // `assetTemplateId` is the INSTANTIATION STAMP, written only by
  // `AssetDashboardsInstantiateService` — never by a request body. `.strict()`
  // is what refuses it, and `unrecognized_keys` is the code that proves the
  // refusal came from strictness rather than from the scope refinement.
  {
    const stamped = createDashboardBodySchema.safeParse({
      ...validCreateBody,
      assetId: ASSET_ID,
      assetTemplateId: "88888888-8888-4888-8888-888888888888",
    }) as { success: boolean; error?: { issues: { code?: string; keys?: string[] }[] } };
    assert(stamped.success === false, "assetTemplateId on a create body must be refused");
    const unrecognized = (stamped.error?.issues ?? []).find(
      (issue) => issue.code === "unrecognized_keys",
    );
    assert(
      unrecognized !== undefined && (unrecognized.keys ?? []).includes("assetTemplateId"),
      `assetTemplateId must be refused as an unrecognized key, got ${JSON.stringify(stamped.error?.issues)}`,
    );
  }
  expectAccepts(
    updateDashboardBodySchema,
    { assetId: null },
    "clearing the asset scope on update (assetId: null) must parse",
  );
  expectRejectsAt(
    updateDashboardBodySchema,
    { assetId: ASSET_ID, locationId: LOCATION_ID },
    ["assetGroupId"],
    [SCOPE_SENTENCE],
    "assetId AND locationId set on update",
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
  // 5b. `F3.35` Stage B — the table widget's bindings and its column projection.
  //     Numbered `5b` rather than appended as `12`: the numbers in this file are navigation, and
  //     these assertions belong beside the binding rules at 5, not after the grid rules at 11.
  // -------------------------------------------------------------------------
  expectAccepts(widgetWriteSchema, validTableWidget, "a table bound to a dataset must parse");

  // A METRIC on a table is the mirror of the dataset-on-a-tile hole Stage C closed. The
  // cardinality is satisfied — one source, exactly as required — and only `WIDGET_SOURCE_SHAPES`
  // refuses it. Without that record a table would bind `alarms.active.count`, resolve to the
  // number 7, and arrive at a renderer that draws rows.
  expectRejectsAt(
    widgetWriteSchema,
    { ...validTableWidget, sources: [{ catalogKey: "alarms.active.count", params: {} }] },
    ["sources", 0, "catalogKey"],
    [bindingShapeMessage("table", "alarms.active.count", "metric")],
    "a metric bound to a table must be refused by shape, not merely by count",
  );

  // A table with NO source. `WIDGET_SOURCE_CARDINALITY.table.min` is 1 — unlike the tile's 0,
  // because a tile may bind a point instead and a table has no second way to get rows.
  expectRejects(
    widgetWriteSchema,
    { ...validTableWidget, sources: [] },
    "a table with no catalog binding must be refused — it has no other way to get rows",
  );

  // A POINT on a table. `WIDGET_POINT_CARDINALITY.table.max` is 0: a point is a series over
  // time, which has no rows and no columns to project.
  expectRejects(
    widgetWriteSchema,
    { ...validTableWidget, points: [{ pointId: POINT_A }] },
    "a table cannot bind a point",
  );

  // The column projection. An undeclared name is refused AT THE COLUMN, because an author who
  // chose six columns must be told which one is wrong.
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    {
      widgets: [
        { ...validTableWidget, config: { columns: ["assetCode", "notAColumn"] } },
      ],
    },
    ["widgets", 0, "config", "columns", 1],
    [columnNotDeclaredMessage("notAColumn", "alarms.active")],
    "a column the bound dataset does not declare must be refused, naming the column",
  );

  // Declared columns pass, in any order the author chose — the order IS the projection.
  expectAccepts(
    putDashboardWidgetsBodySchema,
    {
      widgets: [
        { ...validTableWidget, config: { columns: ["severity", "assetCode"] } },
      ],
    },
    "a reordered subset of the declared columns must parse — the author's order is the choice",
  );

  // Empty and absent are one state, and both are legal: a table is created before its columns
  // are picked, and refusing this would make the widget unsaveable at the moment it is made.
  expectAccepts(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...validTableWidget, config: { columns: [] } }] },
    "an empty column list means every declared column and must parse",
  );

  // **A table carrying columns AND no source — the branch the whole suite missed.**
  //
  // Every other column assertion above parses `validTableWidget`, which always has a source; the
  // two "no source" and "metric source" assertions parse `widgetWriteSchema`, the ARM, where the
  // array-level `superRefine` never runs. So `eachTableColumnIsDeclared`'s
  // `binding === undefined` guard was reached by no test at all.
  //
  // It is not defensive. Zod's array `.min()` calls `status.dirty()` rather than aborting, and
  // `ZodEffects` skips a refinement only on `aborted` — so this payload DOES reach that line.
  // Delete the guard and `binding.catalogKey` throws out of `safeParse`: a 500 where the
  // cardinality rule should answer 400.
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...validTableWidget, sources: [], config: { columns: ["assetCode"] } }] },
    ["widgets", 0, "sources"],
    [],
    "a table with columns but no source must be refused for its CARDINALITY, not crash",
  );

  // The same column twice. `noDuplicateBindings` guards `points` and `noDuplicateSources` guards
  // `sources`; this array had no such rule, so a hand-built PUT produced a doubled column and a
  // duplicate React key (security review, Low).
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...validTableWidget, config: { columns: ["severity", "severity"] } }] },
    ["widgets", 0, "config", "columns", 1],
    [duplicateColumnMessage("severity")],
    "the same column chosen twice must be refused, naming the second occurrence",
  );

  // The rule must not fire on a widget that is not a table — `config.columns` exists on no
  // other arm, and a rule that walked every widget looking for a `columns` key would be a rule
  // waiting for an unrelated arm to gain one.
  expectAccepts(
    putDashboardWidgetsBodySchema,
    { widgets: [validGaugeWidget, validTableWidget] },
    "a dashboard mixing a gauge and a table must parse",
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

/**
 * `F3.1d` Unit 2 — `widgetIdentityWriteFields`'s bounds and
 * `eachWidgetFitsTheGrid`'s array-level cross-check must both read
 * `DASHBOARD_GRID` rather than a private `11`/`12`/`24`.
 * `tests/f3.1d-grid-bounds-single-source.test.ts` is the scan that keeps a
 * fifth TypeScript copy from appearing; these pins prove THIS file is one of
 * the wired sites rather than a fourth.
 */
export function runDashboardsSchemaGridBoundsTests(): void {
  assert(DASHBOARD_GRID.columns === 12, "the canvas is 12 columns");

  // Isolates widgetIdentityWriteFields's own per-field gridX .max() from the
  // array-level superRefine: gridW is 1, so gridX + gridW never crosses the
  // 12-column canvas either way. Flips at "set DASHBOARD_GRID.columns = 16",
  // the same mutation the shared package's pin flips at.
  expectRejects(
    widgetWriteSchema,
    { ...validGaugeWidget, gridX: 12, gridW: 1 },
    "gridX at DASHBOARD_GRID.columns itself (12) exceeds the per-field bound (max is columns - 1) today",
  );
  expectAccepts(
    widgetWriteSchema,
    { ...validGaugeWidget, gridX: 11, gridW: 1 },
    "gridX at DASHBOARD_GRID.columns - 1 (11) is accepted",
  );

  // Isolates eachWidgetFitsTheGrid, the array-level superRefine, from the
  // per-field bounds above: gridX (11) and gridW (2) are each individually
  // legal, but their sum (13) exceeds today's 12-column canvas. This is the
  // assertion the mutation table names: "a 16-wide widget passes the array
  // refinement" — at columns=16 this sum-13 widget is well inside the
  // widened canvas and parses.
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...validGaugeWidget, gridX: 11, gridW: 2 }] },
    ["widgets", 0, "gridW"],
    ["12-column canvas"],
    "gridX 11 + gridW 2 (13) exceeds today's 12-column canvas though both individual bounds are legal",
  );
  expectAccepts(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...validGaugeWidget, gridX: 11, gridW: 1 }] },
    "gridX 11 + gridW 1 (12) exactly fills the canvas and is accepted",
  );
}

/**
 * `F3.35` Stage C Unit 5 — a widget binds only a catalog entry it can DRAW.
 *
 * **This suite exists because the cardinality check reads as if it already covered this, and
 * does not.** `WIDGET_SOURCE_CARDINALITY.value_tile` is `{min: 0, max: 1}`, and `alarms.active`
 * — six declared columns of rows — is exactly one binding. It passed every bound on this path,
 * stored, resolved as a dataset, and reached a renderer that draws a single number. Nothing
 * threw and nothing logged: the tile drew blank in front of an operator.
 *
 * Both directions are asserted. A rule that only refuses would also pass if it refused
 * everything, and a `value_tile` that cannot bind `alarms.active.count` is the feature removed.
 */
export function runDashboardsSchemaSourceShapeTests(): void {
  const tileWith = (catalogKey: MetricCatalogKey) => ({
    widgetType: "value_tile" as const,
    title: null,
    gridX: 0,
    gridY: 0,
    gridW: 3,
    gridH: 2,
    config: {},
    points: [],
    sources: [{ catalogKey }],
  });

  // The fixture is only meaningful while these two facts hold. Asserted rather than assumed:
  // if Stage B gives the tile `"dataset"`, this whole suite must be rewritten, not silently
  // pass because the mismatch it tests stopped being a mismatch.
  assert(
    METRIC_CATALOG["alarms.active"].shape === "dataset" &&
      METRIC_CATALOG["alarms.active.count"].shape === "metric",
    "the fixture needs one dataset key and one metric key that differ",
  );
  assert(
    WIDGET_SOURCE_CARDINALITY.value_tile.max === 1,
    "a tile must accept ONE binding, or the refusal below could be the count rather than the shape",
  );

  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [tileWith("alarms.active")] },
    ["widgets", 0, "sources", 0, "catalogKey"],
    ["returns rows"],
    "a dataset entry on a value_tile is one binding and passes the COUNT — only the shape rule refuses it",
  );

  expectAccepts(
    putDashboardWidgetsBodySchema,
    { widgets: [tileWith("alarms.active.count")] },
    "the metric half of the same catalog entry is what a tile draws, and must still parse",
  );

  // -------------------------------------------------------------------------
  // `exactlyOneBindingKind` — added after a correctness review MUTATION-PROVED
  // that nothing enforced it. Replacing both of its conditions with
  // `if (false && …)` left the entire api suite green: the only existing
  // fixture submits `points: []` with one source, which SATISFIES the rule and
  // therefore cannot detect its removal. A committed docblock in
  // `packages/shared/src/contracts/dashboard-builder.spec.ts` asserted the rule
  // was "asserted in that file's spec" — the same false-claim failure both of
  // ADR 0048's errata record, one layer up.
  //
  // Both directions, because the rule has two halves and a gate for one is not
  // a gate for the other.
  // -------------------------------------------------------------------------
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    { widgets: [{ ...tileWith("alarms.active.count"), sources: [] }] },
    ["widgets", 0, "points"],
    ["bound point or a named metric"],
    "a value_tile binding NEITHER a point nor a metric parses and stores, then renders " +
      '"No data bound." forever — WIDGET_POINT_CARDINALITY.value_tile.min dropped to 0 on this ' +
      "branch, so this rule is the only thing refusing it",
  );

  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    {
      widgets: [
        { ...tileWith("alarms.active.count"), points: [{ pointId: POINT_A }] },
      ],
    },
    ["widgets", 0, "points"],
    ["not both"],
    "a value_tile binding BOTH kinds has two answers for one number, and widgetDataFor takes " +
      "the catalog branch first — so the bound point is silently discarded",
  );

  // `noDuplicateSources` was untested too. `dashboard_widget_sources_widget_key_key` would
  // catch it as a bare 23505; this is what turns that into a 400 naming the field.
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    {
      widgets: [
        {
          ...tileWith("alarms.active.count"),
          sources: [{ catalogKey: "alarms.active.count" }, { catalogKey: "alarms.active.count" }],
        },
      ],
    },
    ["widgets", 0, "sources", 1, "catalogKey"],
    ["may not be bound twice"],
    "the same catalog entry bound twice on one widget must be a 400, not a 23505",
  );

  // Every type whose cardinality admits a source must declare a shape it can draw, or the
  // picker offers a list the write path refuses in full — a form whose every option 400s.
  for (const widgetType of widgetTypeSchema.options) {
    const admitsSources = WIDGET_SOURCE_CARDINALITY[widgetType].max > 0;
    assert(
      admitsSources === (WIDGET_SOURCE_SHAPES[widgetType].length > 0),
      `${widgetType}: a type that admits a catalog binding must name a shape it can draw, and ` +
        "a type that admits none must name none",
    );
  }
}

/**
 * `F3.31` Task 3 — `GET /dashboards?assetId=` (ADR 0068 decision 4).
 *
 * **The accept case reads the PARSED value, not `success`.** `listDashboardsQuerySchema` is a
 * plain `z.object`, which strips unknown keys: before the field existed,
 * `safeParse({ assetId })` already succeeded with `assetId` stripped, so a success-only
 * assertion is green with or without the field. Only `parsed.assetId === ASSET_ID` reddens
 * when the field is missing.
 */
export function runListDashboardsQueryTests(): void {
  const parsed = listDashboardsQuerySchema.parse({ assetId: ASSET_ID });
  assert(
    parsed.assetId === ASSET_ID,
    `assetId must survive the parse — got ${String(parsed.assetId)} (the field is missing)`,
  );
  expectAccepts(listDashboardsQuerySchema, {}, "assetId is optional — an empty query still parses");
  expectRejectsAt(
    listDashboardsQuerySchema,
    { assetId: "x" },
    ["assetId"],
    ["uuid"],
    "a non-uuid assetId must be refused at the field",
  );
}

// ---------------------------------------------------------------------------
// `E4.2` / ADR 0072 decision 2 — the first entries with fields on their write
// schema. One exported function per claim, so a mutation reddens the `it` that
// owns it (a thrown assert stops the function, so a second claim would hide).
// ---------------------------------------------------------------------------

const sustainabilityTile = (params: Record<string, unknown>) => ({
  widgets: [
    {
      widgetType: "value_tile" as const,
      title: null,
      gridX: 0,
      gridY: 0,
      gridW: 3,
      gridH: 2,
      config: {},
      points: [],
      sources: [{ catalogKey: "sustainability.total" as const, params }],
    },
  ],
});

const byLocationTable = (params: Record<string, unknown>) => ({
  widgets: [
    {
      ...validTableWidget,
      sources: [{ catalogKey: "sustainability.by_location" as const, params }],
    },
  ],
});

const SOURCE_PARAMS = ["widgets", 0, "sources", 0, "params"] as const;

/** The well-formed binding parses. */
export function sustainabilityTotalAcceptsPointKeyAndAggregate(): void {
  expectAccepts(
    putDashboardWidgetsBodySchema,
    sustainabilityTile({ pointKey: "kl_today", aggregate: "sum" }),
    "a value_tile binding sustainability.total { kl_today, sum }",
  );
}

/** A missing `aggregate` is one issue at `params.aggregate`, prefixed with the entry's key. */
export function sustainabilityTotalRefusesMissingAggregate(): void {
  const result = putDashboardWidgetsBodySchema.safeParse(
    sustainabilityTile({ pointKey: "kl_today" }),
  );
  assert(result.success === false, "a binding with no aggregate must be refused");
  const issues = result.error?.issues ?? [];
  assert(issues.length === 1, `expected exactly one issue, got ${JSON.stringify(issues)}`);
  const [issue] = issues;
  assert(
    JSON.stringify(issue?.path) === JSON.stringify([...SOURCE_PARAMS, "aggregate"]),
    `the issue must sit at params.aggregate, got ${JSON.stringify(issue?.path)}`,
  );
  assert(
    (issue?.message ?? "").startsWith("sustainability.total:"),
    `the message must name the entry first, got "${issue?.message}"`,
  );
}

/** An undeclared field is refused — the entry is strict. */
export function sustainabilityTotalRefusesAnExtraField(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    sustainabilityTile({ pointKey: "kl_today", aggregate: "sum", period: "month" }),
    [...SOURCE_PARAMS],
    ["period"],
    "a `period` field is not declared (the period is the stored tag's own, ADR 0072) and " +
      "strict refuses it",
  );
}

/** A 65-character point key is over the column's bound. */
export function sustainabilityTotalRefusesALongPointKey(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    sustainabilityTile({ pointKey: "k".repeat(65), aggregate: "sum" }),
    [...SOURCE_PARAMS, "pointKey"],
    ["64"],
    "pointKey is bounded at 64, the point-key catalog's `code` width",
  );
}

/** A point key outside the catalog-code charset is refused before any lookup. */
export function sustainabilityTotalRefusesACharsetViolation(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    sustainabilityTile({ pointKey: "kl today", aggregate: "sum" }),
    [...SOURCE_PARAMS, "pointKey"],
    ["letters, digits"],
    "a space is outside CATALOG_CODE_PATTERN (F2.23), so the charset refuses it here",
  );
}

/** The empty `params` the builder's picker would send is refused on `by_location` too. */
export function byLocationRefusesEmptyParams(): void {
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    byLocationTable({}),
    [...SOURCE_PARAMS, "pointKey"],
    ["sustainability.by_location:"],
    "params: {} on by_location is the picker's payload, and it must 400 here rather than store",
  );
}

/** A `table` binds `by_location`. */
export function byLocationAcceptsATable(): void {
  expectAccepts(
    putDashboardWidgetsBodySchema,
    byLocationTable({ pointKey: "kl_today", aggregate: "sum" }),
    "a table binding sustainability.by_location { kl_today, sum }",
  );
}

/** A `value_tile` cannot bind `by_location` — it draws one number and the entry returns rows. */
export function byLocationRefusedOnAValueTile(): void {
  const widget = sustainabilityTile({}).widgets[0];
  assert(widget !== undefined, "fixture");
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    {
      widgets: [
        {
          ...widget,
          sources: [
            {
              catalogKey: "sustainability.by_location" as const,
              params: { pointKey: "kl_today", aggregate: "sum" },
            },
          ],
        },
      ],
    },
    ["widgets", 0, "sources", 0, "catalogKey"],
    [bindingShapeMessage("value_tile", "sustainability.by_location", "dataset")],
    "the shape rule, not the params rule, refuses a dataset on a tile — well-formed params do " +
      "not rescue it",
  );
}

/** An older entry still refuses any field — the new fields did not leak sideways. */
export function olderEntryStillRefusesPointKey(): void {
  const widget = sustainabilityTile({}).widgets[0];
  assert(widget !== undefined, "fixture");
  expectRejectsAt(
    putDashboardWidgetsBodySchema,
    {
      widgets: [
        {
          ...widget,
          sources: [{ catalogKey: "alarms.active.count" as const, params: { pointKey: "x" } }],
        },
      ],
    },
    [...SOURCE_PARAMS],
    ["alarms.active.count:", "pointKey"],
    "alarms.active.count declares no fields, so a pointKey on it is an unrecognized key",
  );
}
