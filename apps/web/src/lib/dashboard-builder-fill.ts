import type { DashboardWidgetSpec } from "@bms/shared";
import { putDashboardWidgetsBodySchema } from "@bms/shared/contracts";

import { configRowFromDto, type DashboardWidgetRow, type TabWritePayload } from "./dashboard-builder-form";

/**
 * `F4.245` (owner ruling 3) — a copilot `fill_step` of `dashboard.widgets.replace`
 * mapped back onto the builder's canvas rows and tabs. Before this the edit and
 * create pages dropped such a fill: the rows are the builder's own state, and
 * the shell's merged values had nowhere to go.
 *
 * The fill is parsed **whole** with the route's own body schema, so a widget
 * whose `tabKey` names no tab is refused here as the route would refuse it
 * (`tabRulesHold` is a body-level rule; a per-widget parse would miss it). The
 * rows are read the way `dashboardRowsFromDto` reads a stored dashboard: ids
 * and `tabKey` kept by conditional spread, the config through
 * `configRowFromDto`. A point's label comes from the canvas the page already
 * holds, else it is the point's id.
 */
export type BuilderFill =
  | { readonly ok: true; readonly rows: DashboardWidgetRow[]; readonly tabs: TabWritePayload[] }
  | { readonly ok: false; readonly problem: string };

/** The create page lays out a dashboard without tabs (a new dashboard has none), so a fill naming tabs is refused there. */
export const CREATE_PAGE_TABS_PROBLEM =
  "This page lays out a dashboard without tabs; open the dashboard's edit page to fill tabs.";

/** The labels the canvas already shows, by point id. */
export function pointLabelsOf(rows: readonly DashboardWidgetRow[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const row of rows) for (const point of row.points) labels.set(point.pointId, point.label);
  return labels;
}

export function builderStateFromWidgetsFill(
  values: Readonly<Record<string, unknown>>,
  pointLabels: ReadonlyMap<string, string>,
): BuilderFill {
  const parsed = putDashboardWidgetsBodySchema.safeParse(values);
  if (!parsed.success) {
    const problem = parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
    return { ok: false, problem: `The copilot's layout cannot be used: ${problem}` };
  }
  const rows = parsed.data.widgets.map(
    (widget): DashboardWidgetRow => ({
      ...(widget.id !== undefined ? { id: widget.id } : {}),
      ...(widget.tabKey !== undefined ? { tabKey: widget.tabKey } : {}),
      widgetType: widget.widgetType,
      title: widget.title ?? "",
      gridX: widget.gridX,
      gridY: widget.gridY,
      gridW: widget.gridW,
      gridH: widget.gridH,
      points: widget.points.map((point) => ({
        pointId: point.pointId,
        role: point.role,
        sortOrder: point.sortOrder,
        label: pointLabels.get(point.pointId) ?? point.pointId,
      })),
      sources: widget.sources.map((source) => ({ catalogKey: source.catalogKey, params: source.params })),
      // The route's parse output is the spec the DTO carries; one arm's config infers as a loose record.
      config: configRowFromDto(widget as DashboardWidgetSpec),
    }),
  );
  const tabs = (parsed.data.tabs ?? []).map(
    (tab): TabWritePayload => ({
      ...(tab.id !== undefined ? { id: tab.id } : {}),
      key: tab.key,
      label: tab.label,
      sortOrder: tab.sortOrder,
      assetGroupId: tab.assetGroupId ?? null,
    }),
  );
  return { ok: true, rows, tabs };
}
