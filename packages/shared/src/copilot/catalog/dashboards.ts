import { CHART_KIND_LABELS } from "../../contracts/chart-kinds";
import { appendChartWidgetBodySchema } from "../../contracts/dashboard-widget-append";
import {
  createDashboardBodySchema,
  putDashboardWidgetsBodySchema,
  updateDashboardBodySchema,
} from "../../contracts/dashboard-writes";
import { fieldList, plural, quoted, text, uuidParam } from "./summary-text";
import type { CatalogEntry } from "./types";

/** `F3.85` PR 8 — the dashboard writes (`DashboardBuilderController`). PR 9 builds their wizards. */
export const DASHBOARD_ENTRIES: readonly CatalogEntry[] = [
  {
    id: "dashboard.create",
    title: "Create a dashboard",
    method: "POST",
    path: "/dashboards",
    params: {},
    body: createDashboardBodySchema,
    bodyName: "createDashboardBodySchema",
    clientOnly: [],
    risk: "create",
    target: { kind: "organization", manage: "dashboard" },
    refs: [
      { field: "locationId", kind: "location" },
      { field: "assetGroupId", kind: "assetGroup" },
      { field: "assetId", kind: "asset" },
    ],
    formulas: [],
    steps: [
      { id: "basics", title: "Basics", fields: ["name", "slug", "description"] },
      { id: "scope", title: "Scope", fields: ["organizationId", "locationId", "assetGroupId", "assetId"] },
    ],
    summary: ({ body, organizationName }) =>
      `Create the dashboard ${quoted(text(body, "name"))} (${text(body, "slug")}) in ${organizationName}.`,
  },
  {
    id: "dashboard.update",
    title: "Edit a dashboard",
    method: "PATCH",
    path: "/dashboards/:id",
    params: { id: uuidParam },
    body: updateDashboardBodySchema,
    bodyName: "updateDashboardBodySchema",
    clientOnly: [],
    risk: "edit",
    target: { kind: "dashboard", param: "id" },
    refs: [
      { field: "locationId", kind: "location" },
      { field: "assetGroupId", kind: "assetGroup" },
      { field: "assetId", kind: "asset" },
    ],
    formulas: [],
    steps: [
      { id: "basics", title: "Basics", fields: ["name", "slug", "description"] },
      { id: "scope", title: "Scope", fields: ["locationId", "assetGroupId", "assetId"] },
    ],
    summary: ({ body, targetName }) => `Change ${fieldList(body)} of the dashboard ${quoted(targetName)}.`,
  },
  {
    id: "dashboard.widgets.replace",
    title: "Save a dashboard's widgets",
    method: "PUT",
    path: "/dashboards/:id/widgets",
    params: { id: uuidParam },
    body: putDashboardWidgetsBodySchema,
    bodyName: "putDashboardWidgetsBodySchema",
    precondition: "updatedAt",
    clientOnly: [],
    risk: "edit",
    target: { kind: "dashboard", param: "id" },
    refs: [],
    formulas: [],
    steps: [{ id: "layout", title: "Layout", fields: ["tabs", "widgets"] }],
    // Decision 4.9: a list PUT replaces the whole list, so the card says how many current widgets it removes.
    summary: ({ body, targetName, currentWidgetIds = [] }) => {
      const widgets = Array.isArray(body.widgets) ? (body.widgets as unknown[]) : [];
      const kept = new Set(
        widgets
          .map((widget) => (widget !== null && typeof widget === "object" ? (widget as { id?: unknown }).id : undefined))
          .filter((id): id is string => typeof id === "string"),
      );
      const removed = currentWidgetIds.filter((id) => !kept.has(id)).length;
      return (
        `Replace the widgets of the dashboard ${quoted(targetName)} with ${plural(widgets.length, "widget")}; ` +
        `${plural(removed, "current widget")} ${removed === 1 ? "is" : "are"} removed.`
      );
    },
  },
  /**
   * `F4.324` (ADR 0099 Amendment 16) — one chart at the foot of a tab, through the append route's
   * **chart arm only**: the body is that arm, `.strict()` without `widgetType`, so a trend-strip
   * body is refused at propose (decision 2: a strip is placed with the setup wizard). The safer way
   * to add one chart than `dashboard.widgets.replace`, which restates every widget. Refined body:
   * the shared kind rule runs at propose too, so a two-point heatmap never reaches the card.
   * No refs: a ref names a top-level field, and each point's organization is the route's 403 at
   * Confirm (decision 4). No precondition: it appends and overwrites nothing.
   */
  {
    id: "dashboard.widgets.appendChart",
    title: "Add a chart to a dashboard",
    method: "POST",
    path: "/dashboards/:id/widgets/append",
    params: { id: uuidParam },
    body: appendChartWidgetBodySchema,
    bodyName: "appendChartWidgetBodySchema",
    clientOnly: [],
    risk: "create",
    target: { kind: "dashboard", param: "id" },
    refs: [],
    formulas: [],
    // A canvas entry (`CANVAS_ENTRY_IDS`): its human form is the Pin dialog, not a stepper, so it has
    // no steps — the model proposes the whole body (the `workOrder.reorder` precedent, ruling DC2).
    steps: [],
    summary: ({ body, targetName }) => {
      const config = body.config !== null && typeof body.config === "object" ? (body.config as Record<string, unknown>) : {};
      const series =
        typeof config.series === "string" && Object.hasOwn(CHART_KIND_LABELS, config.series) ? config.series : "line";
      const label = CHART_KIND_LABELS[series as keyof typeof CHART_KIND_LABELS];
      const points = Array.isArray(body.points) ? body.points.length : 0;
      const tab = text(body, "tabKey");
      return (
        `Add a ${label} chart of ${plural(points, "point")} ` +
        `${tab === "" ? "to" : `at the foot of the tab ${quoted(tab)} on`} the dashboard ${quoted(targetName)}.`
      );
    },
  },
];
