import type { DashboardDto, DashboardWidgetDto } from "@bms/shared";

import {
  blankDashboardWidgetRow,
  buildPutWidgetsPayload,
  builderHasChanged,
  dashboardBuilderErrors,
  dashboardRowsFromDto,
  offerableWidgetTypes,
} from "./dashboard-builder-form";
import { WIDGET_CATALOG } from "./widget-catalog";
import { TEMPLATE_WIDGET_TYPES } from "./widget-config-form";

/**
 * `E1.4c` (ADR 0135 Amendment 3 C1) — the `forecast` widget in the live builder's row model.
 * Assertions live here; `dashboard-builder-forecast.test.ts` is the Vitest entry point (ADR 0014).
 */
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const POINT = {
  id: "44444444-4444-4444-8444-444444444444",
  pointId: "55555555-5555-4555-8555-555555555555",
  role: "primary" as const,
  sortOrder: 0,
  assetId: "66666666-6666-4666-8666-666666666666",
  assetCode: "CH-01",
  assetRtuName: null,
  assetLocationName: null,
  pointKey: "chw_kw",
  unit: "kW",
};

const FORECAST_DTO = {
  id: "11111111-1111-4111-8111-111111111111",
  dashboardId: "22222222-2222-4222-8222-222222222222",
  organizationId: "33333333-3333-4333-8333-333333333333",
  title: "Chiller load",
  gridX: 0,
  gridY: 0,
  gridW: 6,
  gridH: 4,
  points: [POINT],
  sources: [],
  tabId: null,
  widgetType: "forecast",
  config: {},
} as DashboardWidgetDto;

const dashboardDto = (widgets: DashboardWidgetDto[]): DashboardDto => ({
  id: "dash-1",
  organizationId: "33333333-3333-4333-8333-333333333333",
  slug: "chillers",
  name: "Chillers",
  description: null,
  locationId: null,
  assetGroupId: null,
  assetId: null,
  assetTemplateId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  templateId: null,
  tabs: [],
  widgets,
});

/** DTO → row → payload: the point survives, the config is `{}`, and an unedited set is no change. */
export function aForecastRoundTripsWithItsPointAndAnEmptyConfig(): void {
  const dto = dashboardDto([FORECAST_DTO]);
  const rows = dashboardRowsFromDto(dto);
  const payload = buildPutWidgetsPayload(rows, []);
  const widget = payload.widgets[0]!;
  assert(widget.widgetType === "forecast", `the row re-saves as a forecast — got ${widget.widgetType}`);
  assert(JSON.stringify(widget.config) === "{}", `a forecast writes config {} — got ${JSON.stringify(widget.config)}`);
  assert(
    widget.points.length === 1 && widget.points[0]?.pointId === POINT.pointId && widget.sources.length === 0,
    `a forecast re-saves its one point and no source — got ${JSON.stringify(widget)}`,
  );
  assert(!builderHasChanged(rows, dto), "an unedited forecast is no change");
}

/** A new forecast is 6 x 4 and binds nothing yet; the builder asks for its one point. */
export function aNewForecastIsHalfWidthAndAsksForItsPoint(): void {
  const row = blankDashboardWidgetRow("forecast");
  assert(row.gridW === 6 && row.gridH === 4, `a new forecast is 6x4 — got ${row.gridW}x${row.gridH}`);
  assert(WIDGET_CATALOG.forecast.label === "Forecast", "the palette names it Forecast");
  assert(
    WIDGET_CATALOG.forecast.points.min === 1 && WIDGET_CATALOG.forecast.points.max === 1,
    "the catalog's cardinality is the shared one, {1, 1}",
  );
  const problems = dashboardBuilderErrors([row], "location", []);
  assert(
    problems.some((problem) => problem.field === "points"),
    `a forecast with no point is a builder problem — got ${JSON.stringify(problems)}`,
  );
}

/** Offered on every scope kind; never offered to a template (plan R12). */
export function aForecastIsOfferedOnEveryScopeAndNoTemplate(): void {
  for (const kind of ["organization", "location", "asset", "assetGroup"] as const) {
    assert(offerableWidgetTypes(kind).includes("forecast"), `a ${kind} dashboard offers forecast`);
  }
  assert(
    !(TEMPLATE_WIDGET_TYPES as readonly string[]).includes("forecast"),
    "no template surface offers the forecast widget",
  );
}
