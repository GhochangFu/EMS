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
 * `E1.9f` (ADR 0135 Amendment 8 decision 13) — the `ml_findings` widget in the live builder's row
 * model. Assertions live here; `dashboard-builder-ml-findings.test.ts` is the Vitest entry point
 * (ADR 0014).
 */
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const ML_FINDINGS_DTO = {
  id: "11111111-1111-4111-8111-111111111111",
  dashboardId: "22222222-2222-4222-8222-222222222222",
  organizationId: "33333333-3333-4333-8333-333333333333",
  title: "Findings",
  gridX: 0,
  gridY: 0,
  gridW: 6,
  gridH: 4,
  points: [],
  sources: [],
  tabId: null,
  widgetType: "ml_findings",
  config: { show: "anomalies", paragraph: false },
} as DashboardWidgetDto;

const dashboardDto = (widgets: DashboardWidgetDto[]): DashboardDto => ({
  id: "dash-1",
  organizationId: "33333333-3333-4333-8333-333333333333",
  slug: "plant",
  name: "Plant",
  description: null,
  locationId: "44444444-4444-4444-8444-444444444444",
  assetGroupId: null,
  assetId: null,
  assetTemplateId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  templateId: null,
  tabs: [],
  widgets,
});

/** A new row is 6 x 4 and saves `{ show: "both", paragraph: true }`, no point, no source. */
export function aNewMlFindingsRowSavesBothKeysAndNoBinding(): void {
  const row = blankDashboardWidgetRow("ml_findings");
  assert(row.gridW === 6 && row.gridH === 4, `a new ml_findings widget is 6x4 — got ${row.gridW}x${row.gridH}`);
  assert(WIDGET_CATALOG.ml_findings.label === "ML findings", "the palette names it ML findings");
  assert(
    WIDGET_CATALOG.ml_findings.points.max === 0 && WIDGET_CATALOG.ml_findings.sources.max === 0,
    "the catalog's cardinality is the shared one, {0, 0}",
  );
  const widget = buildPutWidgetsPayload([row], []).widgets[0]!;
  assert(widget.widgetType === "ml_findings", `the row saves as ml_findings — got ${widget.widgetType}`);
  assert(
    JSON.stringify(widget.config) === JSON.stringify({ show: "both", paragraph: true }),
    `the builder always writes both keys — got ${JSON.stringify(widget.config)}`,
  );
  assert(
    widget.points.length === 0 && widget.sources.length === 0,
    `no point and no source — got ${JSON.stringify(widget)}`,
  );
  const problems = dashboardBuilderErrors([row], "location", []);
  assert(problems.length === 0, `a new ml_findings widget has nothing to fix — got ${JSON.stringify(problems)}`);
}

/** A stored `{ show: "anomalies", paragraph: false }` round-trips, and an unedited set is no change. */
export function aStoredMlFindingsConfigRoundTrips(): void {
  const dto = dashboardDto([ML_FINDINGS_DTO]);
  const rows = dashboardRowsFromDto(dto);
  const widget = buildPutWidgetsPayload(rows, []).widgets[0]!;
  assert(
    JSON.stringify(widget.config) === JSON.stringify({ show: "anomalies", paragraph: false }),
    `the stored config survives a re-save — got ${JSON.stringify(widget.config)}`,
  );
  assert(!builderHasChanged(rows, dto), "an unedited ml_findings widget is no change");
}

/** A stored `{}` (both keys optional, R-u) reads as the defaults and re-saves them. */
export function anEmptyStoredConfigReadsAsTheDefaults(): void {
  const rows = dashboardRowsFromDto(dashboardDto([{ ...ML_FINDINGS_DTO, config: {} } as DashboardWidgetDto]));
  const widget = buildPutWidgetsPayload(rows, []).widgets[0]!;
  assert(
    JSON.stringify(widget.config) === JSON.stringify({ show: "both", paragraph: true }),
    `{} reads as show both, paragraph on — got ${JSON.stringify(widget.config)}`,
  );
}

/** Offered on every scope kind; never offered to a template. */
export function anMlFindingsIsOfferedOnEveryScopeAndNoTemplate(): void {
  for (const kind of ["organization", "location", "asset", "assetGroup"] as const) {
    assert(offerableWidgetTypes(kind).includes("ml_findings"), `a ${kind} dashboard offers ml_findings`);
  }
  assert(
    !(TEMPLATE_WIDGET_TYPES as readonly string[]).includes("ml_findings"),
    "no template surface offers the ml_findings widget",
  );
}
