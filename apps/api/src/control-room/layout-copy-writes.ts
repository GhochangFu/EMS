import { dashboardWidgetPoints, dashboardWidgets, dashboardWidgetSources } from "@bms/db";
import type { planTemplateWidget } from "@bms/shared";

import type { BmsTx } from "../database/tenant-context";

/**
 * `F4.317` task 4.2 — the widget write of a layout copy, lifted out of `SiteLayoutService` so the
 * organization-layout copy action (`OrganizationLayoutService`) writes its widgets the same way.
 * Byte-for-byte the site action's private `writeWidgets` body.
 *
 * The widgets of one tab (or, for an organization layout, of the flat list: `tabId` null), with
 * their points and sources — the `instantiate` loop, per tab. Runs on the copy's `withTenant`
 * transaction, so every row is written under the organization's GUC.
 */
export async function writeLayoutWidgets(
  tx: BmsTx,
  organizationId: string,
  dashboardId: string,
  tabId: string | null,
  plans: readonly ReturnType<typeof planTemplateWidget>[],
): Promise<void> {
  for (const plan of plans) {
    const [widgetRow] = await tx
      .insert(dashboardWidgets)
      .values({
        organizationId,
        dashboardId,
        tabId,
        widgetType: plan.widget.widgetType,
        title: plan.widget.title,
        gridX: plan.widget.gridX,
        gridY: plan.widget.gridY,
        gridW: plan.widget.gridW,
        gridH: plan.widget.gridH,
        config: plan.widget.config,
      })
      .returning({ id: dashboardWidgets.id });
    const widgetId = widgetRow?.id as string;
    if (plan.points.length > 0) {
      await tx.insert(dashboardWidgetPoints).values(
        plan.points.map((point, index) => ({
          organizationId,
          widgetId,
          pointId: point.pointId,
          role: plan.pointRole,
          sortOrder: index,
        })),
      );
    }
    if (plan.widget.sources.length > 0) {
      await tx.insert(dashboardWidgetSources).values(
        plan.widget.sources.map((source, index) => ({
          organizationId,
          widgetId,
          catalogKey: source.catalogKey,
          params: source.params,
          sortOrder: source.sortOrder ?? index,
        })),
      );
    }
  }
}
