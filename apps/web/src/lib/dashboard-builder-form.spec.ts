import { DASHBOARD_GRID, MAX_DASHBOARD_WIDGETS } from "@bms/shared";
import type { DashboardDto, DashboardWidgetDto, DashboardWidgetPointDto } from "@bms/shared";

import { WIDGET_CATALOG } from "./widget-catalog";
import {
  blankDashboardWidgetRow,
  buildPutWidgetsPayload,
  builderHasChanged,
  dashboardBuilderErrors,
  dashboardBuilderProblemSubject,
  dashboardRowsFromDto,
  unselectedDashboardBuilderProblems,
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
    widgetType: "value_tile",
    config: { unit: "kW", decimals: 1 },
    ...overrides,
  } as DashboardWidgetDto;
}

function dashboardDto(widgets: DashboardWidgetDto[]): DashboardDto {
  return {
    id: "dash-1",
    organizationId: "33333333-3333-4333-8333-333333333333",
    slug: "feed-pumps",
    name: "Feed pumps",
    description: null,
    locationId: null,
    assetGroupId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    widgets,
  };
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
export function runDashboardBuilderErrorsTests(): void {
  const valid = dashboardRowsFromDto(dashboardDto([widgetDto()]));
  assert(dashboardBuilderErrors(valid).length === 0, "a valid single-widget set reports no problems");

  const tooManyWidgets: DashboardWidgetRow[] = Array.from({ length: MAX_DASHBOARD_WIDGETS + 1 }, () =>
    blankDashboardWidgetRow("value_tile"),
  );
  assert(
    dashboardBuilderErrors(tooManyWidgets).some((p) => p.field === "widgets"),
    "more than MAX_DASHBOARD_WIDGETS rows reports a widgets-level problem",
  );

  // `F3.35` Stage C changed WHY this is a problem, not whether it is one. Before Stage C the
  // tile was below `WIDGET_POINT_CARDINALITY.value_tile.min`, which was 1. Now that minimum is
  // 0, because ADR 0048 decision 2 lets a tile bind a named metric instead — and this row binds
  // neither, which is the state the *exactly one kind* rule refuses.
  const noBindings = [blankDashboardWidgetRow("value_tile")];
  assert(
    dashboardBuilderErrors(noBindings).some((p) => p.field === "points"),
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
    dashboardBuilderErrors(bothKinds).some((p) => p.field === "points"),
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
    dashboardBuilderErrors(metricOnly).every((p) => p.field !== "points"),
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
    dashboardBuilderErrors(gaugeWithSource).some((p) => p.field === "points"),
    "a radial_gauge binding a named metric reports a problem; only the tile takes one",
  );

  const tooWide: DashboardWidgetRow[] = [{ ...blankDashboardWidgetRow("value_tile"), gridX: 10, gridW: 5 }];
  assert(
    dashboardBuilderErrors(tooWide).some((p) => p.field === "gridW"),
    `a widget overhanging the ${DASHBOARD_GRID.columns}-column canvas reports a gridW problem`,
  );

  const badConfig: DashboardWidgetRow[] = [
    { ...blankDashboardWidgetRow("radial_gauge"), points: [{ pointId: "p", role: "primary", sortOrder: 0, label: "x" }] },
  ];
  badConfig[0]!.config.min = "10";
  badConfig[0]!.config.max = "5";
  assert(
    dashboardBuilderErrors(badConfig).some((p) => p.field === "max"),
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
  const payload = buildPutWidgetsPayload(rows);
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
  const newPayload = buildPutWidgetsPayload([newRow]);
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
