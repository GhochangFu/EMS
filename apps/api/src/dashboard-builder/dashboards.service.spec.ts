import { dashboardSummaryDtoSchema, dashboardWidgetDtoSchema } from "@bms/shared";

import {
  diffWidgets,
  mapDashboardSummary,
  mapDashboardWidget,
  type StoredWidgetForDiff,
} from "./dashboards.service";
import type { WidgetWriteBody } from "./dashboards.schema";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const DASHBOARD_ID = "22222222-2222-4222-8222-222222222222";
const WIDGET_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WIDGET_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WIDGET_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const POINT_A = "44444444-4444-4444-8444-444444444444";
const ASSET_A = "55555555-5555-4555-8555-555555555555";

const dashboardRow = {
  id: DASHBOARD_ID,
  organizationId: ORG_ID,
  slug: "overview",
  name: "Overview",
  description: null,
  locationId: null,
  assetGroupId: null,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-02T00:00:00.000Z"),
};

const widgetRow = {
  id: WIDGET_A,
  organizationId: ORG_ID,
  dashboardId: DASHBOARD_ID,
  widgetType: "chart",
  title: "Load",
  gridX: 0,
  gridY: 0,
  gridW: 6,
  gridH: 4,
  config: { series: "line" },
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
};

const resolvedPoint = {
  id: "66666666-6666-4666-8666-666666666666",
  widgetId: WIDGET_A,
  pointId: POINT_A,
  role: "primary",
  sortOrder: 0,
  assetId: ASSET_A,
  pointKey: "kw",
  unit: "kW",
};

/**
 * `F3.1b` Task 4 — pure-logic unit tests for `DashboardsService` (§4.6: no database).
 * Assertions live here; `dashboards.service.test.ts` is the Vitest entry point (ADR 0014).
 */
export function runDashboardsServiceUnitTests(): void {
  // -------------------------------------------------------------------------
  // The row -> DTO mappers' output parses against the shared contract — the
  // one thing catching API drift from the contract without a database.
  // -------------------------------------------------------------------------
  const summary = mapDashboardSummary(dashboardRow, 3);
  const summaryParsed = dashboardSummaryDtoSchema.safeParse(summary);
  assert(
    summaryParsed.success === true,
    `mapDashboardSummary's output must parse against dashboardSummaryDtoSchema: ${JSON.stringify(
      summaryParsed.success ? null : summaryParsed.error.issues,
    )}`,
  );
  assert(summary.widgetCount === 3, "mapDashboardSummary must carry the passed widget count");

  const widget = mapDashboardWidget(widgetRow, [resolvedPoint]);
  const widgetParsed = dashboardWidgetDtoSchema.safeParse(widget);
  assert(
    widgetParsed.success === true,
    `mapDashboardWidget's output must parse against dashboardWidgetDtoSchema: ${JSON.stringify(
      widgetParsed.success ? null : widgetParsed.error.issues,
    )}`,
  );
  if (widgetParsed.success && widgetParsed.data.widgetType === "chart") {
    assert(
      widgetParsed.data.config.series === "line",
      "the parsed widget DTO must narrow on widgetType through to its config",
    );
  }
  assert(
    widget.points[0]?.assetId === ASSET_A && widget.points[0]?.pointKey === "kw",
    "mapDashboardWidget must carry the resolved assetId/pointKey through onto each point",
  );

  // -------------------------------------------------------------------------
  // The widget sync diff (D2): three stored widgets, a body with one
  // unchanged id, one changed id and one with no id.
  // -------------------------------------------------------------------------
  const stored: StoredWidgetForDiff[] = [
    {
      id: WIDGET_A,
      widgetType: "chart",
      title: "Load",
      gridX: 0,
      gridY: 0,
      gridW: 6,
      gridH: 4,
      config: { series: "line" },
      points: [{ pointId: POINT_A, role: "primary", sortOrder: 0 }],
    },
    {
      id: WIDGET_B,
      widgetType: "value_tile",
      title: "Total kW",
      gridX: 6,
      gridY: 0,
      gridW: 3,
      gridH: 2,
      config: {},
      points: [{ pointId: POINT_A, role: "primary", sortOrder: 0 }],
    },
    {
      id: WIDGET_C,
      widgetType: "value_tile",
      title: "Retiring",
      gridX: 9,
      gridY: 0,
      gridW: 3,
      gridH: 2,
      config: {},
      points: [],
    },
  ];

  const unchangedSubmission: WidgetWriteBody = {
    id: WIDGET_A,
    widgetType: "chart",
    title: "Load",
    gridX: 0,
    gridY: 0,
    gridW: 6,
    gridH: 4,
    config: { series: "line" },
    points: [{ pointId: POINT_A, role: "primary", sortOrder: 0 }],
  } as WidgetWriteBody;

  const changedSubmission: WidgetWriteBody = {
    id: WIDGET_B,
    widgetType: "value_tile",
    title: "Total kW (renamed)",
    gridX: 6,
    gridY: 0,
    gridW: 3,
    gridH: 2,
    config: {},
    points: [{ pointId: POINT_A, role: "primary", sortOrder: 0 }],
  } as WidgetWriteBody;

  const newSubmission: WidgetWriteBody = {
    widgetType: "value_tile",
    title: "New tile",
    gridX: 0,
    gridY: 4,
    gridW: 3,
    gridH: 2,
    config: {},
    points: [{ pointId: POINT_A, role: "primary", sortOrder: 0 }],
  } as WidgetWriteBody;

  const diff = diffWidgets(stored, [unchangedSubmission, changedSubmission, newSubmission]);

  assert(
    diff.updates.length === 1 && diff.updates[0]?.id === WIDGET_B,
    `expected exactly one update (widget B), got ${JSON.stringify(diff.updates.map((w) => w.id))}`,
  );
  assert(
    diff.inserts.length === 1,
    `expected exactly one insert (the id-less widget), got ${diff.inserts.length}`,
  );
  assert(
    diff.deleteIds.length === 1 && diff.deleteIds[0] === WIDGET_C,
    `expected exactly one delete (widget C, absent from the submitted set), got ${JSON.stringify(diff.deleteIds)}`,
  );
  assert(
    diff.unchangedIds.length === 1 && diff.unchangedIds[0] === WIDGET_A,
    `the untouched widget (A) must keep its id and generate no update — got ${JSON.stringify(diff.unchangedIds)}`,
  );
}
