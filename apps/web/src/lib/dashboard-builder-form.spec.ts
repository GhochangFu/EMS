import { DASHBOARD_GRID, MAX_DASHBOARD_WIDGETS } from "@bms/shared";
import type { DashboardDto, DashboardWidgetDto, DashboardWidgetPointDto } from "@bms/shared";

import { WIDGET_CATALOG } from "./widget-catalog";
import {
  blankDashboardWidgetRow,
  buildPutWidgetsPayload,
  widgetRowAfterRemovingSource,
  builderHasChanged,
  dashboardBuilderErrors,
  dashboardBuilderProblemSubject,
  dashboardRowsFromDto,
  offerableWidgetTypes,
  tabWritesFromDto,
  unselectedDashboardBuilderProblems,
  MIMIC_NEEDS_ASSET_GROUP_MESSAGE,
  SCOPE_PROBLEM_FIELD,
  type DashboardWidgetRow,
} from "./dashboard-builder-form";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function point(overrides: Partial<DashboardWidgetPointDto> = {}): DashboardWidgetPointDto {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    pointId: "55555555-5555-4555-8555-555555555555",
    role: "primary",
    sortOrder: 0,
    assetId: "66666666-6666-4666-8666-666666666666",
    assetCode: "BRK-01",
    pointKey: "power_kw",
    unit: "kW",
    ...overrides,
  };
}

function widgetDto(overrides: Partial<DashboardWidgetDto> = {}): DashboardWidgetDto {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    dashboardId: "22222222-2222-4222-8222-222222222222",
    organizationId: "33333333-3333-4333-8333-333333333333",
    title: "Feed pump power",
    gridX: 0,
    gridY: 0,
    gridW: 4,
    gridH: 4,
    points: [point()],
    // `F3.35` Stage C. Required by the DTO, and the `as DashboardWidgetDto` below is what let
    // it be omitted silently — the same cast-hides-an-omission shape `mapDashboardWidget` in
    // `apps/api` records. The failure was a TypeError inside `dashboardRowsFromDto`, not a
    // type error, which is why it surfaced only when the suite ran.
    sources: [],
    tabId: null,
    widgetType: "value_tile",
    config: { unit: "kW", decimals: 1 },
    ...overrides,
  } as DashboardWidgetDto;
}

function dashboardDto(widgets: DashboardWidgetDto[], tabs: DashboardDto["tabs"] = []): DashboardDto {
  return {
    id: "dash-1",
    organizationId: "33333333-3333-4333-8333-333333333333",
    slug: "feed-pumps",
    name: "Feed pumps",
    description: null,
    locationId: null,
    assetGroupId: null,
    assetId: null,
    assetTemplateId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    templateId: null,
    tabs,
    widgets,
  };
}

const TAB_A = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  dashboardId: "22222222-2222-4222-8222-222222222222",
  organizationId: "33333333-3333-4333-8333-333333333333",
  key: "overview",
  label: "Overview",
  sortOrder: 0,
  assetGroupId: null,
};
const TAB_B = {
  ...TAB_A,
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  key: "ups",
  label: "UPS",
  sortOrder: 1,
  assetGroupId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};

/** `F3.73` D11 — a dashboard with two tabs round-trips each widget's `tabKey`, and the tab set
 * the builder re-saves keeps every stored tab id. */
export function runTabKeyRoundTripTests(): void {
  const dto = dashboardDto(
    [
      widgetDto({ id: "w-a", tabId: TAB_A.id }),
      widgetDto({ id: "w-b", tabId: TAB_B.id }),
      widgetDto({ id: "w-none", tabId: null }),
    ],
    [TAB_A, TAB_B],
  );
  const rows = dashboardRowsFromDto(dto);
  assert(rows[0]!.tabKey === "overview", `a widget in tab A reads back its key — got ${rows[0]!.tabKey}`);
  assert(rows[1]!.tabKey === "ups", `a widget in tab B reads back its key — got ${rows[1]!.tabKey}`);
  assert(rows[2]!.tabKey === undefined, "a widget in no tab has no tabKey");

  const payload = buildPutWidgetsPayload(rows, tabWritesFromDto(dto.tabs));
  assert(payload.widgets[0]!.tabKey === "overview", "the write body carries tabKey for tab A");
  assert(payload.widgets[1]!.tabKey === "ups", "the write body carries tabKey for tab B");
  assert(!("tabKey" in payload.widgets[2]!), "a widget in no tab omits tabKey rather than sending undefined");
  assert(
    JSON.stringify(payload.tabs) ===
      JSON.stringify([
        { id: TAB_A.id, key: "overview", label: "Overview", sortOrder: 0, assetGroupId: null },
        { id: TAB_B.id, key: "ups", label: "UPS", sortOrder: 1, assetGroupId: TAB_B.assetGroupId },
      ]),
    `the write body re-sends the stored tabs with their ids — got ${JSON.stringify(payload.tabs)}`,
  );
  assert(!builderHasChanged(rows, dto), "unedited tabbed rows report no change");
}

/** `blankDashboardWidgetRow` — a new row, sized from the catalog rather than a literal. */
export function runBlankDashboardWidgetRowTests(): void {
  for (const widgetType of Object.keys(WIDGET_CATALOG) as (keyof typeof WIDGET_CATALOG)[]) {
    const row = blankDashboardWidgetRow(widgetType);
    assert(row.id === undefined, `a new row has no id — got ${JSON.stringify(row.id)}`);
    assert(row.points.length === 0, "a new row starts with no bindings");
    assert(
      row.gridW === WIDGET_CATALOG[widgetType].defaultSize.w &&
        row.gridH === WIDGET_CATALOG[widgetType].defaultSize.h,
      `${widgetType}'s default size must come from WIDGET_CATALOG, not a restated literal`,
    );
  }
}

/** `dashboardRowsFromDto` — reading a stored dashboard back into editable rows. */
export function runDashboardRowsFromDtoTests(): void {
  const gauge = widgetDto({
    id: "gauge-1",
    widgetType: "radial_gauge",
    title: null,
    config: { min: 6, max: 12, unit: "%", thresholds: [{ value: 90, tone: "critical" }] },
    points: [point({ pointKey: "level_pct", unit: "%" })],
  });
  const chart = widgetDto({
    id: "chart-1",
    widgetType: "chart",
    config: { series: "area", windowMinutes: 60, stacked: true, yAxisLabel: "kW" },
    points: [point({ pointKey: "a", sortOrder: 1 }), point({ pointKey: "b", sortOrder: 0, unit: null })],
  });

  const rows = dashboardRowsFromDto(dashboardDto([gauge, chart]));
  assert(rows.length === 2, "one row per stored widget");

  const gaugeRow = rows[0]!;
  assert(gaugeRow.id === "gauge-1", "the server-issued id is preserved");
  assert(gaugeRow.title === "", "a null title reads back as an empty string");
  assert(gaugeRow.config.min === "6" && gaugeRow.config.max === "12", "gauge min/max round-trip as text");
  assert(
    gaugeRow.config.thresholds.length === 1 && gaugeRow.config.thresholds[0]?.value === "90",
    "gauge thresholds round-trip",
  );
  assert(gaugeRow.points[0]?.label === "level_pct (%)", "a point with a unit gets a qualified label");

  const chartRow = rows[1]!;
  assert(chartRow.config.series === "area", "chart series round-trips");
  assert(chartRow.config.windowMinutes === "60", "chart windowMinutes round-trips as text");
  assert(chartRow.points[1]?.label === "b", "a point with no unit gets a bare pointKey label");
  assert(
    chartRow.points[0]?.sortOrder === 1 && chartRow.points[1]?.sortOrder === 0,
    "each point's own stored sortOrder is preserved, not reassigned by array position",
  );
}

/** `dashboardBuilderErrors` — cardinality and grid-fit, read from the shared catalog/constant. */
/**
 * `F3.35` Stage B — a table's column projection survives an edit-and-resave.
 *
 * **This is the assertion `configRowFromDto`'s own comment names, and it was written because
 * the two halves are ASYMMETRIC and the asymmetry looks harmless.** `buildTableConfig` writes
 * `columns` only when the list is non-empty; `configRowFromDto` reads `columns ?? []`. Both are
 * deliberate — absent and empty are one state — but that is exactly the shape where a field
 * gets written and never read back, and the failure is silent: an author picks four columns,
 * later renames the widget, saves, and the card widens to every column with nothing reporting
 * why.
 *
 * The fixture uses a NON-declared order (`severity` before `assetCode`) so a `.sort()` anywhere
 * in the round trip fails here rather than looking correct.
 */
export function runTableColumnRoundTripTests(): void {
  const chosen = ["severity", "assetCode"];
  const table = widgetDto({
    id: "table-1",
    widgetType: "table",
    config: { columns: chosen },
    points: [],
    sources: [{ id: "s-1", catalogKey: "alarms.active", params: {}, sortOrder: 0 }],
  });

  const [row] = dashboardRowsFromDto(dashboardDto([table]));
  assert(row !== undefined, "the stored table must read back as a row");
  assert(
    JSON.stringify(row?.config.tableColumns) === JSON.stringify(chosen),
    `the chosen columns must read back in the author's order, got ${JSON.stringify(row?.config.tableColumns)}`,
  );

  // And back out again. This is the half that catches the silent loss: the payload built from
  // the row the builder just loaded must carry the same projection the server stored.
  const payload = buildPutWidgetsPayload([row!], []);
  const written = payload.widgets[0];
  assert(
    written?.widgetType === "table",
    `the rebuilt payload must still be a table, got ${String(written?.widgetType)}`,
  );
  assert(
    written?.widgetType === "table" &&
      JSON.stringify(written.config.columns) === JSON.stringify(chosen),
    `an edit-and-resave must preserve the column projection, got ${JSON.stringify(
      written?.widgetType === "table" ? written.config.columns : undefined,
    )}`,
  );

  // The empty case collapses to ABSENT rather than `[]`, so one authored state has one stored
  // encoding. Two encodings of "every column" would make the first `columns.length === 0` check
  // written on the read side a bug for the other one.
  const noColumns = widgetDto({
    id: "table-2",
    widgetType: "table",
    config: {},
    points: [],
    sources: [{ id: "s-2", catalogKey: "alarms.active", params: {}, sortOrder: 0 }],
  });
  const [bare] = dashboardRowsFromDto(dashboardDto([noColumns]));
  assert(bare?.config.tableColumns.length === 0, "an absent column list reads back as empty");
  const bareWritten = buildPutWidgetsPayload([bare!], []).widgets[0];
  assert(
    bareWritten?.widgetType === "table" && bareWritten.config.columns === undefined,
    "an empty projection must be written as ABSENT, not as an empty array",
  );
}

/**
 * `F3.35` Stage B — removing a catalog source clears the column projection with it.
 *
 * The trap this guards is a 400 an author cannot act on: rebind a table from `alarms.active` to
 * `workorders.open` with the old columns still stored, and `eachTableColumnIsDeclared` refuses
 * the save naming a column the picker no longer offers.
 */
export function runRemovingASourceClearsColumnsTests(): void {
  const table = widgetDto({
    id: "table-3",
    widgetType: "table",
    config: { columns: ["severity", "assetCode"] },
    points: [],
    sources: [{ id: "s-3", catalogKey: "alarms.active", params: {}, sortOrder: 0 }],
  });
  const [row] = dashboardRowsFromDto(dashboardDto([table]));
  assert(row?.config.tableColumns.length === 2, "the fixture must start with a projection");

  const patch = widgetRowAfterRemovingSource(row!, 0);
  assert(patch.sources?.length === 0, "the source must be removed");
  assert(
    patch.config?.tableColumns.length === 0,
    `the column projection must be cleared with its dataset, got ${JSON.stringify(patch.config?.tableColumns)}`,
  );

  // Removing a source must not disturb the rest of the config — clearing the columns is the
  // only side effect, so an author does not lose a unit or a decimals setting by rebinding.
  const withUnit = dashboardRowsFromDto(
    dashboardDto([
      widgetDto({
        id: "table-4",
        widgetType: "table",
        config: { unit: "kW", columns: ["severity"] },
        points: [],
        sources: [{ id: "s-4", catalogKey: "alarms.active", params: {}, sortOrder: 0 }],
      }),
    ]),
  )[0];
  const kept = widgetRowAfterRemovingSource(withUnit!, 0);
  assert(kept.config?.unit === "kW", "removing a source must not clear unrelated config fields");
}

export function runDashboardBuilderErrorsTests(): void {
  const valid = dashboardRowsFromDto(dashboardDto([widgetDto()]));
  assert(dashboardBuilderErrors(valid, "organization", []).length === 0, "a valid single-widget set reports no problems");

  const tooManyWidgets: DashboardWidgetRow[] = Array.from({ length: MAX_DASHBOARD_WIDGETS + 1 }, () =>
    blankDashboardWidgetRow("value_tile"),
  );
  assert(
    dashboardBuilderErrors(tooManyWidgets, "organization", []).some((p) => p.field === "widgets"),
    "more than MAX_DASHBOARD_WIDGETS rows reports a widgets-level problem",
  );

  // `F3.35` Stage C changed WHY this is a problem, not whether it is one. Before Stage C the
  // tile was below `WIDGET_POINT_CARDINALITY.value_tile.min`, which was 1. Now that minimum is
  // 0, because ADR 0048 decision 2 lets a tile bind a named metric instead — and this row binds
  // neither, which is the state the *exactly one kind* rule refuses.
  const noBindings = [blankDashboardWidgetRow("value_tile")];
  assert(
    dashboardBuilderErrors(noBindings, "organization", []).some((p) => p.field === "points"),
    "a value_tile binding neither a point nor a metric reports a points problem",
  );

  // The other half of the same rule, and the one the old minimum could never have caught: two
  // answers for one number. Picking either silently would put a value on screen the author did
  // not choose.
  const bothKinds: DashboardWidgetRow[] = [
    {
      ...blankDashboardWidgetRow("value_tile"),
      points: [{ pointId: "p", role: "primary", sortOrder: 0, label: "kw" }],
      sources: [{ catalogKey: "alarms.active.count", params: {} }],
    },
  ];
  assert(
    dashboardBuilderErrors(bothKinds, "organization", []).some((p) => p.field === "points"),
    "a value_tile binding both a point and a metric reports a points problem",
  );

  // A metric-bound tile with no point is now legal, which is the whole point of the relaxation.
  // Asserted positively so a future tightening of the minimum fails here rather than silently
  // making the source picker unusable.
  const metricOnly: DashboardWidgetRow[] = [
    {
      ...blankDashboardWidgetRow("value_tile"),
      sources: [{ catalogKey: "alarms.active.count", params: {} }],
    },
  ];
  assert(
    dashboardBuilderErrors(metricOnly, "organization", []).every((p) => p.field !== "points"),
    "a value_tile bound to a named metric alone is legal and reports no points problem",
  );

  // A type whose source cardinality is `{0,0}` must refuse a source outright, or the builder
  // would offer a binding the write path rejects with a 400 the author cannot act on.
  const gaugeWithSource: DashboardWidgetRow[] = [
    {
      ...blankDashboardWidgetRow("radial_gauge"),
      points: [{ pointId: "p", role: "primary", sortOrder: 0, label: "kw" }],
      sources: [{ catalogKey: "alarms.active.count", params: {} }],
    },
  ];
  assert(
    dashboardBuilderErrors(gaugeWithSource, "organization", []).some((p) => p.field === "points"),
    "a radial_gauge binding a named metric reports a problem; only the tile takes one",
  );

  const tooWide: DashboardWidgetRow[] = [{ ...blankDashboardWidgetRow("value_tile"), gridX: 10, gridW: 5 }];
  assert(
    dashboardBuilderErrors(tooWide, "organization", []).some((p) => p.field === "gridW"),
    `a widget overhanging the ${DASHBOARD_GRID.columns}-column canvas reports a gridW problem`,
  );

  const badConfig: DashboardWidgetRow[] = [
    { ...blankDashboardWidgetRow("radial_gauge"), points: [{ pointId: "p", role: "primary", sortOrder: 0, label: "x" }] },
  ];
  badConfig[0]!.config.min = "10";
  badConfig[0]!.config.max = "5";
  assert(
    dashboardBuilderErrors(badConfig, "organization", []).some((p) => p.field === "max"),
    "an inverted gauge range is caught through widgetConfigErrors, not restated here",
  );
}

/**
 * Review finding — `WidgetInspector` renders only the SELECTED widget's problems, so a
 * set-level problem and any OTHER widget's problem must surface in a page-level summary
 * instead, or `Save` disables with a reason that renders nowhere.
 */
export function runUnselectedDashboardBuilderProblemsTests(): void {
  const problems = [
    { widget: null, field: "widgets", message: "too many widgets" },
    { widget: 0, field: "points", message: "widget 0 problem" },
    { widget: 1, field: "points", message: "widget 1 problem" },
  ];

  assert(
    unselectedDashboardBuilderProblems(problems, null).length === 3,
    "with nothing selected, WidgetInspector renders nothing, so every problem needs the summary",
  );

  const withWidget1Selected = unselectedDashboardBuilderProblems(problems, 1);
  assert(
    withWidget1Selected.length === 2 &&
      withWidget1Selected.every((p) => p.widget !== 1),
    "with widget 1 selected, only ITS OWN problem is hidden (shown by WidgetInspector instead) " +
      `— got widgets [${withWidget1Selected.map((p) => p.widget).join(", ")}]`,
  );
}

/** `dashboardBuilderProblemSubject` — names what a problem is about, for the summary above. */
export function runDashboardBuilderProblemSubjectTests(): void {
  const rows = [blankDashboardWidgetRow("value_tile"), { ...blankDashboardWidgetRow("chart"), title: "Feed trend" }];

  assert(
    dashboardBuilderProblemSubject(rows, { widget: null, field: "widgets", message: "m" }) === "Dashboard",
    "a set-level problem (widget: null) is named 'Dashboard'",
  );
  assert(
    dashboardBuilderProblemSubject(rows, { widget: 1, field: "points", message: "m" }) === "Widget 2 (Feed trend)",
    "a titled widget is named by its own title, one-indexed for a reader",
  );
  assert(
    dashboardBuilderProblemSubject(rows, { widget: 0, field: "points", message: "m" }) === "Widget 1 (Value tile)",
    "an untitled widget falls back to its catalog label",
  );
}

/** `buildPutWidgetsPayload` — the write body, keyed on the four config builders already tested
 * in `widget-config-form.spec.ts`. */
export function runBuildPutWidgetsPayloadTests(): void {
  const rows = dashboardRowsFromDto(dashboardDto([widgetDto({ id: "existing-1" })]));
  const payload = buildPutWidgetsPayload(rows, []);
  assert(payload.widgets.length === 1, "one payload widget per row");
  assert(payload.widgets[0]!.id === "existing-1", "an existing row keeps its id");
  assert(
    !("label" in payload.widgets[0]!.points[0]!),
    "the display-only label is dropped from the write payload",
  );
  assert(
    payload.widgets[0]!.points[0]!.pointId === "55555555-5555-4555-8555-555555555555",
    "the point binding's pointId survives into the payload",
  );

  const newRow = blankDashboardWidgetRow("value_tile");
  const newPayload = buildPutWidgetsPayload([newRow], []);
  assert(!("id" in newPayload.widgets[0]!), "a new row (no server id) omits id entirely, rather than sending undefined");
}

/** `builderHasChanged` — dirty-tracking against the dashboard's own stored widgets. */
export function runBuilderHasChangedTests(): void {
  const dto = dashboardDto([widgetDto()]);
  const rows = dashboardRowsFromDto(dto);
  assert(!builderHasChanged(rows, dto), "rows read straight off the dto report no change");

  const retitled = rows.map((row, i) => (i === 0 ? { ...row, title: "New title" } : row));
  assert(builderHasChanged(retitled, dto), "editing a title is a change");

  // A point-order edit is only meaningful with 2+ points — build a chart row with two.
  const chartDto = dashboardDto([
    widgetDto({
      widgetType: "chart",
      config: { series: "line" },
      points: [point({ pointKey: "a", sortOrder: 0 }), point({ pointKey: "b", sortOrder: 1 })],
    }),
  ]);
  const chartRows = dashboardRowsFromDto(chartDto);
  const reorderedChart = [{ ...chartRows[0]!, points: [...chartRows[0]!.points].reverse() }];
  assert(
    builderHasChanged(reorderedChart, chartDto),
    "reordering a widget's points is a real change, not normalized away before comparing",
  );
}

// ---------------------------------------------------------------------------------------------
// `F3.32` — the plant mimic (ADR 0079). One claim per function, so a mutation reddens the
// assertion that owns it rather than the first one in a shared block.
// ---------------------------------------------------------------------------------------------

function mimicDto(): DashboardWidgetDto {
  return widgetDto({
    id: "mimic-1",
    title: "Water train",
    gridW: 12,
    gridH: 6,
    points: [],
    sources: [],
    widgetType: "mimic",
    config: { source: "preset", preset: "water_train" },
  });
}

/** An asset-group dashboard offers every type, the mimic included. */
export function runOfferableOnAGroupTests(): void {
  const offered = offerableWidgetTypes("assetGroup");
  assert(offered.includes("mimic"), `a group dashboard offers the mimic — got ${JSON.stringify(offered)}`);
}

/** Every other scope kind drops the mimic — it resolves its nodes from the group's roles, and
 * the API refuses it anywhere else (ADR 0079 decision 6). */
export function runNotOfferableWithoutAGroupTests(): void {
  for (const kind of ["organization", "location", "asset"] as const) {
    const offered = offerableWidgetTypes(kind);
    assert(!offered.includes("mimic"), `a ${kind} dashboard does not offer the mimic — got ${JSON.stringify(offered)}`);
  }
}

/** The positive twin of the absence check: the other types survive the filter on every kind. */
export function runOtherTypesStayOfferedTests(): void {
  for (const kind of ["organization", "location", "asset", "assetGroup"] as const) {
    const offered = offerableWidgetTypes(kind);
    for (const type of ["radial_gauge", "tank_level", "value_tile", "chart", "table"] as const) {
      assert(offered.includes(type), `a ${kind} dashboard still offers ${type} — got ${JSON.stringify(offered)}`);
    }
  }
}

/** A new mimic row is the catalog's 12×10 with the one preset chosen. */
export function runBlankMimicRowTests(): void {
  const row = blankDashboardWidgetRow("mimic");
  assert(
    row.gridW === 12 && row.gridH === 10 && row.config.mimicPreset === "water_train",
    `a new mimic is 12×10 water_train — got ${row.gridW}×${row.gridH} ${JSON.stringify(row.config.mimicPreset)}`,
  );
}

/** A mimic binds nothing, so the "needs a point or a metric" rule does not apply to it. */
export function runMimicHasNoBindingProblemTests(): void {
  const problems = dashboardBuilderErrors([blankDashboardWidgetRow("mimic")], "assetGroup", []);
  assert(problems.length === 0, `a new mimic row has no problem — got ${JSON.stringify(problems)}`);
}

/** The positive twin: a value tile that binds nothing still gets the binding problem. */
export function runUnboundTileStillHasBindingProblemTests(): void {
  const problems = dashboardBuilderErrors([blankDashboardWidgetRow("value_tile")], "organization", []);
  assert(
    problems.some((problem) => problem.field === "points"),
    `an unbound value tile still reports a points problem — got ${JSON.stringify(problems)}`,
  );
}

/** A mimic's payload config never carries `unit`, even when the flat row holds one (plan D8,
 * the API's `.strict()` answers 400 for it). */
export function runMimicPayloadHasNoUnitTests(): void {
  const row = blankDashboardWidgetRow("mimic");
  const withUnit = { ...row, config: { ...row.config, unit: "kW", decimals: "2" } };
  const payload = buildPutWidgetsPayload([withUnit], []);
  const widget = payload.widgets[0]!;
  assert(
    widget.widgetType === "mimic" &&
      JSON.stringify(Object.keys(widget.config).sort()) === JSON.stringify(["preset", "source"]),
    `a mimic payload's config is exactly preset and source — got ${JSON.stringify(widget)}`,
  );
}

/** Edit-and-resave keeps the stored preset. Without `case "mimic"` in `configRowFromDto` the row
 * holds no preset and the preset is lost. */
export function runMimicRowKeepsPresetTests(): void {
  const rows = dashboardRowsFromDto(dashboardDto([mimicDto()]));
  assert(
    rows[0]!.config.mimicPreset === "water_train",
    `a stored mimic reads back its preset — got ${JSON.stringify(rows[0]!.config.mimicPreset)}`,
  );
}

/** The round trip, end to end: DTO → rows → payload writes back the stored config. */
export function runMimicRoundTripTests(): void {
  const payload = buildPutWidgetsPayload(dashboardRowsFromDto(dashboardDto([mimicDto()])), []);
  const widget = payload.widgets[0]!;
  assert(
    JSON.stringify(widget.config) === JSON.stringify({ source: "preset", preset: "water_train" }) &&
      widget.id === "mimic-1",
    `a stored mimic re-saves its own config and id — got ${JSON.stringify(widget)}`,
  );
}

/** A stored mimic, read and not edited, is not a change. */
export function runMimicUneditedIsNoChangeTests(): void {
  const dto = dashboardDto([mimicDto()]);
  assert(!builderHasChanged(dashboardRowsFromDto(dto), dto), "an unedited mimic reports no change");
}

// -------------------------------------------------------------------------------------------
// `F3.32c` (ADR 0081, plan §4 U5) — the layout source arm.
// -------------------------------------------------------------------------------------------

function layoutMimicDto(): DashboardWidgetDto {
  return widgetDto({
    id: "mimic-2",
    title: "Line 2",
    gridW: 12,
    gridH: 6,
    points: [],
    sources: [],
    widgetType: "mimic",
    config: { source: "layout", layoutId: "layout-1" },
  });
}

/** `configRowFromDto` narrows the union on `source`: a stored layout mimic reads back its
 * `mimicSource` and `mimicLayoutId`, and carries no `mimicPreset`. Mutation: delete the
 * `layoutId` read-back in `configRowFromDto`'s layout arm ⇒ red. */
export function runMimicRowKeepsLayoutTests(): void {
  const rows = dashboardRowsFromDto(dashboardDto([layoutMimicDto()]));
  assert(
    rows[0]!.config.mimicSource === "layout" && rows[0]!.config.mimicLayoutId === "layout-1",
    `a stored layout mimic reads back its source and layoutId — got ${JSON.stringify(rows[0]!.config)}`,
  );
}

/** The round trip, end to end: a stored layout mimic re-saves the same layout config. */
export function runMimicLayoutRoundTripTests(): void {
  const payload = buildPutWidgetsPayload(dashboardRowsFromDto(dashboardDto([layoutMimicDto()])), []);
  const widget = payload.widgets[0]!;
  assert(
    JSON.stringify(widget.config) === JSON.stringify({ source: "layout", layoutId: "layout-1" }) &&
      widget.id === "mimic-2",
    `a stored layout mimic re-saves its own config and id — got ${JSON.stringify(widget)}`,
  );
}

/** A stored layout mimic, read and not edited, is not a change. */
export function runMimicLayoutUneditedIsNoChangeTests(): void {
  const dto = dashboardDto([layoutMimicDto()]);
  assert(!builderHasChanged(dashboardRowsFromDto(dto), dto), "an unedited layout mimic reports no change");
}

/** `F3.32` review finding — a mimic left on the canvas after the scope moves off the group
 * reports the scope problem on every non-group kind. Mutation: drop the kind check (never fire)
 * ⇒ red. */
export function runMimicOffAGroupHasTheScopeProblemTests(): void {
  const rows = [blankDashboardWidgetRow("mimic"), blankDashboardWidgetRow("mimic")];
  for (const kind of ["organization", "location", "asset"] as const) {
    const scoped = dashboardBuilderErrors(rows, kind, []).filter((problem) => problem.field === SCOPE_PROBLEM_FIELD);
    assert(
      JSON.stringify(scoped.map((problem) => [problem.widget, problem.message])) ===
        JSON.stringify([
          [0, MIMIC_NEEDS_ASSET_GROUP_MESSAGE],
          [1, MIMIC_NEEDS_ASSET_GROUP_MESSAGE],
        ]),
      `a ${kind} dashboard reports the scope problem for each mimic — got ${JSON.stringify(scoped)}`,
    );
  }
}

/** The positive twin: on a group scope the mimic has no scope problem. Mutation: fire the
 * problem on every kind ⇒ red. */
export function runMimicOnAGroupHasNoScopeProblemTests(): void {
  const problems = dashboardBuilderErrors([blankDashboardWidgetRow("mimic")], "assetGroup", []);
  assert(
    problems.every((problem) => problem.field !== SCOPE_PROBLEM_FIELD),
    `a group dashboard's mimic has no scope problem — got ${JSON.stringify(problems)}`,
  );
}

/** A widget that is not a mimic never reports the scope problem off a group. */
export function runNonMimicHasNoScopeProblemTests(): void {
  const problems = dashboardBuilderErrors([blankDashboardWidgetRow("value_tile")], "organization", []);
  assert(
    problems.every((problem) => problem.field !== SCOPE_PROBLEM_FIELD),
    `a value tile has no scope problem — got ${JSON.stringify(problems)}`,
  );
}

/** `F3.73` plan D2 — the tabs the per-tab client rules read (the API's `tabRulesHold` and
 * `mimicGroupFor` mirrors). "overview" binds no group; "electrical" binds one. */
const TABS_FOR_RULES = [
  { key: "overview", assetGroupId: null },
  { key: "electrical", assetGroupId: "33333333-3333-4333-8333-333333333333" },
] as const;

const onTab = (tabKey: string, widgetType: Parameters<typeof blankDashboardWidgetRow>[0] = "value_tile") => ({
  ...blankDashboardWidgetRow(widgetType),
  tabKey,
});

/** `MAX_DASHBOARD_WIDGETS` on one tab plus one on another is legal: the cap is per tab.
 * Mutation: count every row against one total => red. */
export function runWidgetCapIsPerTabTests(): void {
  const rows = [
    ...Array.from({ length: MAX_DASHBOARD_WIDGETS }, () => onTab("overview")),
    onTab("electrical"),
  ];
  const problems = dashboardBuilderErrors(rows, "location", TABS_FOR_RULES);
  assert(
    problems.every((problem) => problem.field !== "widgets"),
    `${MAX_DASHBOARD_WIDGETS} + 1 widgets across two tabs is under the per-tab cap — got ${JSON.stringify(problems.filter((p) => p.field === "widgets"))}`,
  );
}

/** One over the cap on ONE tab is refused, and the problem names the tab. Mutation: never
 * report the cap => red. */
export function runWidgetCapRefusesOneTabOverTests(): void {
  const rows = Array.from({ length: MAX_DASHBOARD_WIDGETS + 1 }, () => onTab("overview"));
  const capped = dashboardBuilderErrors(rows, "location", TABS_FOR_RULES).filter((p) => p.field === "widgets");
  assert(
    capped.length === 1 && capped[0]!.message.includes("overview") && capped[0]!.message.includes(`${MAX_DASHBOARD_WIDGETS}`),
    `${MAX_DASHBOARD_WIDGETS + 1} widgets on one tab reports one widgets problem naming the tab — got ${JSON.stringify(capped)}`,
  );
}

/** A mimic on a tab that binds a group resolves against that group, so a location dashboard
 * carries it with no scope problem. Mutation: drop the tab branch => red. */
export function runMimicOnAGroupTabHasNoScopeProblemTests(): void {
  const problems = dashboardBuilderErrors([onTab("electrical", "mimic")], "location", TABS_FOR_RULES);
  assert(
    problems.every((problem) => problem.field !== SCOPE_PROBLEM_FIELD),
    `a mimic on a group-bound tab has no scope problem — got ${JSON.stringify(problems)}`,
  );
}

/** A mimic on the Overview tab (no group) off a group scope still has the scope problem.
 * Mutation: allow a mimic on any tab => red. */
export function runMimicOnAnOverviewTabHasTheScopeProblemTests(): void {
  const scoped = dashboardBuilderErrors([onTab("overview", "mimic")], "location", TABS_FOR_RULES).filter(
    (problem) => problem.field === SCOPE_PROBLEM_FIELD,
  );
  assert(
    JSON.stringify(scoped.map((problem) => [problem.widget, problem.message])) ===
      JSON.stringify([[0, MIMIC_NEEDS_ASSET_GROUP_MESSAGE]]),
    `a mimic on the Overview tab of a location dashboard reports the scope problem — got ${JSON.stringify(scoped)}`,
  );
}

/** The summary keeps a scope problem on the SELECTED widget — `WidgetInspector` renders no scope
 * field, so without this the problem shows nowhere. Mutation: drop the scope exemption ⇒ red. */
export function runSummaryKeepsTheSelectedWidgetsScopeProblemTests(): void {
  const problems = [
    { widget: 0, field: SCOPE_PROBLEM_FIELD, message: MIMIC_NEEDS_ASSET_GROUP_MESSAGE },
    { widget: 0, field: "points", message: "needs a point" },
  ];
  const summary = unselectedDashboardBuilderProblems(problems, 0);
  assert(
    JSON.stringify(summary) === JSON.stringify([problems[0]]),
    `the summary keeps only the selected widget's scope problem — got ${JSON.stringify(summary)}`,
  );
}

export function runWidgetOffEveryTabIsFlaggedTests(): void {
  const rows = [onTab("overview"), blankDashboardWidgetRow("value_tile")];
  const flagged = dashboardBuilderErrors(rows, "location", TABS_FOR_RULES).filter((problem) => problem.field === "tabKey");
  assert(
    JSON.stringify(flagged.map((problem) => problem.widget)) === JSON.stringify([1]),
    `only the row with no tab is flagged on a tabbed dashboard — got ${JSON.stringify(flagged)}`,
  );
  const untabbed = dashboardBuilderErrors([blankDashboardWidgetRow("value_tile")], "location", []).filter(
    (problem) => problem.field === "tabKey",
  );
  assert(untabbed.length === 0, `a dashboard without tabs flags no row — got ${JSON.stringify(untabbed)}`);
}

// -------------------------------------------------------------------------------------------
// `F3.73` (plan Task 3.5) — the five site widgets in the builder's row model.
// -------------------------------------------------------------------------------------------

const SITE_WIDGET_TYPES_UNDER_TEST = [
  "active_alarms_rail",
  "state_legend",
  "asset_class_strip",
  "module_summary_card",
  "critical_systems_list",
] as const;

/** The five bind nothing yet read the dashboard's own scope, so every scope kind offers them — unlike
 * the mimic, which `runNotOfferableWithoutAGroupTests` holds to a group. Mutation: derive the filter
 * from `widgetTypeBindsNothing` again => red for `organization`, `location` and `asset`. */
export function runSiteWidgetsOfferedOnEveryScopeTests(): void {
  for (const kind of ["organization", "location", "asset", "assetGroup"] as const) {
    const offered = offerableWidgetTypes(kind);
    for (const type of SITE_WIDGET_TYPES_UNDER_TEST) {
      assert(offered.includes(type), `a ${kind} dashboard offers ${type} — got ${JSON.stringify(offered)}`);
    }
  }
}

/** A site widget on a location dashboard carries no scope problem and no binding problem (the API's
 * `mimicGroupFor` rule names the mimic alone). Mutation: apply the mimic rule to every type that
 * binds nothing => red. */
export function runSiteWidgetsHaveNoScopeOrBindingProblemTests(): void {
  for (const type of SITE_WIDGET_TYPES_UNDER_TEST) {
    const row = blankDashboardWidgetRow(type);
    if (type === "module_summary_card") {
      row.config.targetTabKey = "ups";
    }
    const problems = dashboardBuilderErrors([row], "location", []);
    assert(problems.length === 0, `a ${type} on a location dashboard is clean — got ${JSON.stringify(problems)}`);
  }
}

/** A new rail starts on the contract's defaults, so an untouched one saves as the schema defaults it. */
export function runBlankRailRowTests(): void {
  const row = blankDashboardWidgetRow("active_alarms_rail");
  assert(row.config.railRows === "8" && row.config.railShowSummary === true, `got ${JSON.stringify(row.config)}`);
}

function siteDto(widgetType: string, config: unknown, id: string): DashboardWidgetDto {
  return widgetDto({ id, title: null, points: [], widgetType, config } as unknown as Partial<DashboardWidgetDto>);
}

/** Every stored site widget re-saves its own config, and an unedited set is not a change — the
 * edit-and-resave trap `configRowFromDto`'s comments name. Mutation: drop the rail's read-back arm
 * (rows/showSummary) or the card's `targetTabKey` read-back => red. */
export function runSiteWidgetsRoundTripTests(): void {
  const stored: [string, unknown][] = [
    ["active_alarms_rail", { rows: 5, showSummary: false }],
    ["state_legend", {}],
    ["asset_class_strip", {}],
    ["module_summary_card", { targetTabKey: "hvac" }],
    ["critical_systems_list", {}],
  ];
  const dto = dashboardDto(stored.map(([type, config], index) => siteDto(type, config, `site-${index}`)));
  const payload = buildPutWidgetsPayload(dashboardRowsFromDto(dto), []);
  stored.forEach(([type, config], index) => {
    const widget = payload.widgets[index]!;
    assert(
      widget.widgetType === type && JSON.stringify(widget.config) === JSON.stringify(config),
      `a stored ${type} re-saves its own config — got ${JSON.stringify(widget)}`,
    );
    assert(widget.points.length === 0 && widget.sources.length === 0, `${type} binds nothing`);
  });
  assert(!builderHasChanged(dashboardRowsFromDto(dto), dto), "an unedited set of site widgets is no change");
}
