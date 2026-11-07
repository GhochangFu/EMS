import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, eq, isNull, or, sql } from "drizzle-orm";

import { assetPoints, dashboards, dashboardWidgetPoints, dashboardWidgets } from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  MAX_DASHBOARD_WIDGETS,
  TAB_KEY_REQUIRED_MESSAGE,
  TAB_KEY_UNKNOWN_MESSAGE,
  widgetCapMessage,
} from "@bms/shared";
import type {
  AppendChartWidgetBody,
  AppendChartWidgetResponse,
  AppendTrendStripWidgetsBody,
  AppendTrendStripWidgetsResponse,
  JwtPayload,
} from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant, type BmsTx } from "../database/tenant-context";
import { TrendPointsService } from "../trend-points/trend-points.service";
import { assertBoundPointsInOrganization, resolveBoundPoints } from "./dashboard-point-scope";
import { appendTrendStrips, NO_TABS_MESSAGE } from "./dashboard-widget-append-strips";
import { readDashboardTabs } from "./dashboard-tabs-write";
import { DashboardsService } from "./dashboards.service";
import { mapDashboardWidget } from "./dashboards.pure";

/**
 * The size a pinned chart takes when the body names none: the builder palette's `chart`
 * `defaultSize` (`apps/web/src/lib/widget-catalog.ts`), which the web Pin dialog also sends.
 */
const DEFAULT_CHART_SIZE = { w: 6, h: 4 } as const;

/** The one 403 sentence: it names no asset, so a refusal does not confirm what exists. */
const ASSET_SCOPE_MESSAGE = "Asset is outside your access scope";

/**
 * `F4.303` U14 / ADR 0108 Amendment 6 item 5 — `POST /dashboards/:id/widgets/append`: one
 * trailing-window `chart` widget at the foot of one tab, and nothing else on the dashboard
 * changes. A sibling of `DashboardsService` because that file is near the AGENTS.md §4.5 cap; it
 * reuses that service's `fetchRowForWrite`, never a copy of it.
 *
 * Order (the amendment's; the controller has already parsed the id, gated the write role and
 * parsed the body): the row and `canManageDashboard` (404) → `canReadAsset` per distinct asset
 * (403) → one tenant transaction: (1) the `updated_at` stamp, which row-locks the dashboard so an
 * append and a save — or two appends — run one after the other, and which turns a builder session
 * opened before the pin into the F4.247 412 on its next `If-Match` save; (2) the tab; (3) each
 * pair resolved to its active registration in the dashboard's organization, then
 * `assertBoundPointsInOrganization` over the resolved ids; (4) the tab's count against
 * `MAX_DASHBOARD_WIDGETS` (409) and its lowest edge; (5) the insert; (6) the audit row, ids and
 * counts only.
 *
 * `F4.306` U7 (ADR 0108 Amendment 7) — `appendStrips` is the route's `trend_strip` arm, built in
 * `dashboard-widget-append-strips.ts`; `append` above is the chart arm, unchanged.
 */
@Injectable()
export class DashboardWidgetAppendService {
  constructor(
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly dashboards: DashboardsService,
    private readonly accessControl: AccessControlService,
    private readonly audit: MasterDataAuditService,
    private readonly trendPoints: TrendPointsService,
  ) {}

  /** The `trend_strip` arm: one widget per strip, each replacing its tab's strip or at its foot. */
  appendStrips(jwt: JwtPayload, id: string, body: AppendTrendStripWidgetsBody): Promise<AppendTrendStripWidgetsResponse> {
    return appendTrendStrips(
      {
        tenantDb: this.tenantDb,
        dashboards: this.dashboards,
        accessControl: this.accessControl,
        writeAudit: (input, tx) => this.audit.write(input, tx),
        trendPoints: this.trendPoints,
      },
      jwt,
      id,
      body,
    );
  }

  async append(jwt: JwtPayload, id: string, body: AppendChartWidgetBody): Promise<AppendChartWidgetResponse> {
    const existing = await this.dashboards.fetchRowForWrite(id);
    const scope = { locationId: existing.locationId, assetGroupId: existing.assetGroupId, assetId: existing.assetId };
    if (!(await this.accessControl.canManageDashboard(jwt, existing.organizationId, scope))) {
      throw new NotFoundException("Dashboard not found");
    }
    for (const assetId of new Set(body.points.map((point) => point.assetId))) {
      if (!(await this.accessControl.canReadAsset(jwt, assetId))) {
        throw new ForbiddenException(ASSET_SCOPE_MESSAGE);
      }
    }
    const organizationId = existing.organizationId;

    return withTenant(this.tenantDb, organizationId, async (tx) => {
      // (1) The stamp, first: it takes the row lock every later read in this transaction sits behind.
      // `clock_timestamp()`, not `now()`: an append that waited on the lock must stamp a later
      // instant than the write it waited for, not its own transaction's start.
      const [stamped] = await tx
        .update(dashboards)
        .set({ updatedAt: sql`clock_timestamp()` })
        .where(eq(dashboards.id, id))
        .returning({ updatedAt: dashboards.updatedAt });
      if (!stamped) throw new NotFoundException("Dashboard not found");

      // (2) The tab.
      const tabs = await readDashboardTabs(tx, id, organizationId);
      let tabId: string | null = null;
      if (tabs.length > 0) {
        if (body.tabKey === undefined) throw new BadRequestException(TAB_KEY_REQUIRED_MESSAGE);
        const tab = tabs.find((row) => row.tabKey === body.tabKey);
        if (!tab) throw new BadRequestException(TAB_KEY_UNKNOWN_MESSAGE);
        tabId = tab.id;
      } else if (body.tabKey !== undefined) {
        throw new BadRequestException(NO_TABS_MESSAGE);
      }

      // (3) The pairs, to active registrations of this organization.
      const pointIds = await resolvePairs(tx, organizationId, body.points);
      await assertBoundPointsInOrganization(tx, organizationId, pointIds);

      // (4) The tab's count and its lowest edge.
      const onCanvas = and(
        eq(dashboardWidgets.dashboardId, id),
        tabId === null ? isNull(dashboardWidgets.tabId) : eq(dashboardWidgets.tabId, tabId),
      );
      const [canvas] = await tx
        .select({
          count: sql<number>`count(*)::int`,
          bottom: sql<number>`coalesce(max(${dashboardWidgets.gridY} + ${dashboardWidgets.gridH}), 0)::int`,
        })
        .from(dashboardWidgets)
        .where(onCanvas);
      if ((canvas?.count ?? 0) >= MAX_DASHBOARD_WIDGETS) {
        throw new ConflictException(widgetCapMessage(body.tabKey ?? ""));
      }

      // (5) The widget at the foot of the tab, then its series bindings in body order.
      const [row] = await tx
        .insert(dashboardWidgets)
        .values({
          organizationId,
          dashboardId: id,
          tabId,
          widgetType: "chart",
          title: body.title ?? null,
          gridX: 0,
          gridY: canvas?.bottom ?? 0,
          gridW: body.gridW ?? DEFAULT_CHART_SIZE.w,
          gridH: body.gridH ?? DEFAULT_CHART_SIZE.h,
          // `F4.324` (ADR 0108 Amendment 9 item 1): the body's kind, `line` when absent — what
          // every pin stored before the field. The kind rule ran on the body's parse.
          config: {
            series: body.config.series ?? "line",
            windowMinutes: body.config.windowMinutes,
            aggregate: body.config.aggregate,
          },
        })
        .returning();
      await tx.insert(dashboardWidgetPoints).values(
        pointIds.map((pointId, sortOrder) => ({ organizationId, widgetId: row.id, pointId, role: "series", sortOrder })),
      );

      // (6) The audit row — ids and counts only.
      await this.audit.write(
        {
          actor: jwt,
          action: "master.dashboard.widgets.append",
          entityType: "dashboard",
          entityId: id,
          organizationId,
          payload: { dashboardId: id, widgetId: row.id, tabKey: body.tabKey ?? null, pointCount: pointIds.length },
        },
        tx,
      );

      const bound = await resolveBoundPoints(tx, organizationId, [row.id]);
      return { widget: mapDashboardWidget(row, bound), updatedAt: stamped.updatedAt.toISOString() };
    });
  }
}

/**
 * One select for every pair, bounded by the dashboard's organization and `active`. A pair with
 * no row, or a pair that repeats an earlier one, is a 400 naming its index only — never the asset
 * id or the code (§9.6).
 */
async function resolvePairs(
  tx: BmsTx,
  organizationId: string,
  pairs: AppendChartWidgetBody["points"],
): Promise<string[]> {
  const seen = new Set<string>();
  pairs.forEach((pair, index) => {
    const key = `${pair.assetId}\u0000${pair.pointKey}`;
    if (seen.has(key)) throw new BadRequestException(`point ${index} repeats an earlier point`);
    seen.add(key);
  });
  const rows = await tx
    .select({ id: assetPoints.id, assetId: assetPoints.assetId, pointKey: assetPoints.pointKey })
    .from(assetPoints)
    .where(
      and(
        eq(assetPoints.organizationId, organizationId),
        eq(assetPoints.active, true),
        or(...pairs.map((pair) => and(eq(assetPoints.assetId, pair.assetId), eq(assetPoints.pointKey, pair.pointKey)))),
      ),
    );
  return pairs.map((pair, index) => {
    const found = rows.find((row) => row.assetId === pair.assetId && row.pointKey === pair.pointKey);
    if (!found) {
      throw new BadRequestException(`point ${index} has no active registration in this dashboard's organization`);
    }
    return found.id;
  });
}
