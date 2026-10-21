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
];
