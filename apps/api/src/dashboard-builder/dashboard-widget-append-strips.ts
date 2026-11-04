import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { dashboards, dashboardWidgets } from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  DASHBOARD_GRID,
  MAX_DASHBOARD_WIDGETS,
  placeTrendStrip,
  TAB_KEY_REQUIRED_MESSAGE,
  TAB_KEY_UNKNOWN_MESSAGE,
  TREND_STRIP_TAB_UNKNOWN_MESSAGE,
  TREND_STRIP_WIDGET_ROWS,
  widgetCapMessage,
} from "@bms/shared";
import type {
  AppendTrendStripWidgetsBody,
  AppendTrendStripWidgetsResponse,
  JwtPayload,
  WidgetWriteBody,
} from "@bms/shared";

import type { MasterDataAuditService } from "../admin/master-data-audit.service";
import type { AccessControlService } from "../auth/access-control.service";
import { withTenant } from "../database/tenant-context";
import type { TrendPointsService } from "../trend-points/trend-points.service";
import { readDashboardTabs } from "./dashboard-tabs-write";
import { resolveBoundPoints } from "./dashboard-point-scope";
import type { DashboardsService } from "./dashboards.service";
import { mapDashboardWidget } from "./dashboards.pure";
import { assertTrendStripSelections, hasTrendStripSelection } from "./trend-strip-selection.check";

/** The 400 for a `tabKey` on a dashboard that has none (both arms of the append route). */
export const NO_TABS_MESSAGE = "This dashboard has no tabs";

/** The 400 for a second strip on one tab: it names the strip index only. */
export const trendStripTabRepeatMessage = (strip: number): string => `strips[${strip}] repeats an earlier tab`;

export type AppendStripsDeps = {
  readonly tenantDb: BmsDb;
  readonly dashboards: DashboardsService;
  readonly accessControl: AccessControlService;
  readonly audit: MasterDataAuditService;
  readonly trendPoints: TrendPointsService;
};

/**
 * `F4.306` U7 / ADR 0108 Amendment 7 — the `trend_strip` arm of `POST /dashboards/:id/widgets/append`:
 * at most one strip per tab, each replacing the tab's strip or added at its foot
 * (`placeTrendStrip`, the rule the wizard's builder draft reads too). A sibling of
 * `DashboardWidgetAppendService` so the chart arm's file stays as it was.
 *
 * Order: the row and `canManageDashboard` (404) → `assertTrendStripSelections` over the
 * organization's effective lists, read only when a strip has a selection (400) → one tenant
 * transaction: (1) the `updated_at` stamp, which row-locks the dashboard as the chart arm does;
 * (2) per strip the tab rules, a repeated tab (400) and `config.tabKey` naming a tab; (3) per strip
 * the tab's widgets, `placeTrendStrip`, then a replace (`config` only) or an insert, where an
 * insert on a full tab is the 409 and the throw rolls back every strip; (4) one audit row, ids and
 * counts only. The answer lists one widget per strip, in body order.
 */
export async function appendTrendStrips(
  deps: AppendStripsDeps,
  jwt: JwtPayload,
  id: string,
  body: AppendTrendStripWidgetsBody,
): Promise<AppendTrendStripWidgetsResponse> {
  const existing = await deps.dashboards.fetchRowForWrite(id);
  const scope = { locationId: existing.locationId, assetGroupId: existing.assetGroupId, assetId: existing.assetId };
  if (!(await deps.accessControl.canManageDashboard(jwt, existing.organizationId, scope))) {
    throw new NotFoundException("Dashboard not found");
  }
  const organizationId = existing.organizationId;

  // The check reads `widgetType` and `config` only, so each strip is handed over as the write widget
  // it becomes (the geometry is the insert's; `gridY` is decided in the transaction and unread here),
  // and its refusals name the strip's index as the widget index.
  const asWidgets = body.strips.map(
    (strip): WidgetWriteBody => ({
      widgetType: "trend_strip",
      gridX: 0,
      gridY: 0,
      gridW: DASHBOARD_GRID.columns,
      gridH: TREND_STRIP_WIDGET_ROWS,
      config: strip.config,
      points: [],
      sources: [],
    }),
  );
  if (asWidgets.some(hasTrendStripSelection)) {
    assertTrendStripSelections(await deps.trendPoints.effective(organizationId, {}), existing, asWidgets);
  }

  return withTenant(deps.tenantDb, organizationId, async (tx) => {
    // (1) The stamp, first, with `clock_timestamp()` — the chart arm's reasons.
    const [stamped] = await tx
      .update(dashboards)
      .set({ updatedAt: sql`clock_timestamp()` })
      .where(eq(dashboards.id, id))
      .returning({ updatedAt: dashboards.updatedAt });
    if (!stamped) throw new NotFoundException("Dashboard not found");

    // (2) Every strip's tab, before any write.
    const tabs = await readDashboardTabs(tx, id, organizationId);
    const tabKeys = new Set(tabs.map((tab) => tab.tabKey));
    const seen = new Set<string>();
    const tabIds = body.strips.map((strip, index) => {
      let tabId: string | null = null;
      if (tabs.length > 0) {
        if (strip.tabKey === undefined) throw new BadRequestException(TAB_KEY_REQUIRED_MESSAGE);
        const tab = tabs.find((row) => row.tabKey === strip.tabKey);
        if (!tab) throw new BadRequestException(TAB_KEY_UNKNOWN_MESSAGE);
        tabId = tab.id;
      } else if (strip.tabKey !== undefined) {
        throw new BadRequestException(NO_TABS_MESSAGE);
      }
      const canvas = strip.tabKey ?? "";
      if (seen.has(canvas)) throw new BadRequestException(trendStripTabRepeatMessage(index));
      seen.add(canvas);
      if (strip.config.tabKey !== undefined && !tabKeys.has(strip.config.tabKey)) {
        throw new BadRequestException(TREND_STRIP_TAB_UNKNOWN_MESSAGE);
      }
      return tabId;
    });

    // (3) Per strip: place it, then replace or insert. A throw here rolls back every strip.
    const rows: (typeof dashboardWidgets.$inferSelect)[] = [];
    let inserted = 0;
    let updated = 0;
    for (const [index, strip] of body.strips.entries()) {
      const tabId = tabIds[index] ?? null;
      const onTab = await tx
        .select({
          id: dashboardWidgets.id,
          widgetType: dashboardWidgets.widgetType,
          gridX: dashboardWidgets.gridX,
          gridY: dashboardWidgets.gridY,
          gridH: dashboardWidgets.gridH,
        })
        .from(dashboardWidgets)
        .where(
          and(
            eq(dashboardWidgets.dashboardId, id),
            tabId === null ? isNull(dashboardWidgets.tabId) : eq(dashboardWidgets.tabId, tabId),
          ),
        )
        .orderBy(asc(dashboardWidgets.id));
      const placement = placeTrendStrip(onTab);
      if (placement.kind === "replace") {
        const [row] = await tx
          .update(dashboardWidgets)
          .set({ config: strip.config })
          .where(eq(dashboardWidgets.id, onTab[placement.index]?.id ?? ""))
          .returning();
        if (!row) throw new NotFoundException("Dashboard not found");
        rows.push(row);
        updated += 1;
        continue;
      }
      if (onTab.length >= MAX_DASHBOARD_WIDGETS) {
        throw new ConflictException(widgetCapMessage(strip.tabKey ?? ""));
      }
      const [row] = await tx
        .insert(dashboardWidgets)
        .values({
          organizationId,
          dashboardId: id,
          tabId,
          widgetType: "trend_strip",
          title: null,
          gridX: 0,
          gridY: placement.gridY,
          gridW: DASHBOARD_GRID.columns,
          gridH: TREND_STRIP_WIDGET_ROWS,
          config: strip.config,
        })
        .returning();
      rows.push(row);
      inserted += 1;
    }

    // (4) The audit row — ids and counts only.
    await deps.audit.write(
      {
        actor: jwt,
        action: "master.dashboard.widgets.append",
        entityType: "dashboard",
        entityId: id,
        organizationId,
        payload: { dashboardId: id, tabKeys: body.strips.map((strip) => strip.tabKey ?? null), inserted, updated },
      },
      tx,
    );

    const bound = await resolveBoundPoints(
      tx,
      organizationId,
      rows.map((row) => row.id),
    );
    return { widgets: rows.map((row) => mapDashboardWidget(row, bound)), updatedAt: stamped.updatedAt.toISOString() };
  });
}
