import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { alarms, alarmSeverities, assetGroups, assets, dashboards, dashboardTabs } from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  MAX_SITE_ALARM_ROWS,
  type AlarmSeverityCount,
  type JwtPayload,
  type SiteWidgetsResponse,
  type SiteWidgetTab,
} from "@bms/shared";

import { activeAlarmFilter } from "../alarms/active-alarm-filter";
import { alarmListItemColumns, toAlarmListItem } from "../alarms/alarm-list-item";
import {
  AssetRoleSummaryService,
  readableGroupScope,
  type RoleSummaryGroupScope,
} from "../assets/asset-role-summary.service";
import { AccessControlService } from "../auth/access-control.service";
import { FLEET_DRIZZLE, TENANT_DRIZZLE } from "../database/database.tokens";
import { withTenant, type BmsTx } from "../database/tenant-context";
import { LIVE_ASSETS_CTE_SQL } from "../telemetry/telemetry-freshness";
import { resolveAssetScope, type DashboardAssetScope } from "./dashboard-scope-assets";

/** The dashboard row the read needs: its organization and its three scope axes. */
export interface SiteWidgetsDashboard {
  readonly id: string;
  readonly organizationId: string;
  readonly locationId: string | null;
  readonly assetGroupId: string | null;
  readonly assetId: string | null;
}

/** One asset group the role summary may count, with the site it sits at. */
export interface CandidateGroup {
  readonly id: string;
  readonly locationId: string;
}

/** The status statement's row: one group tab, its counts over the readable members. */
export interface TabStatusRow extends Record<string, unknown> {
  tab_key: string;
  label: string;
  asset_group_id: string;
  member_total: number;
  assets: number;
  active_alarms: number;
  offline_assets: number;
  worst_severity: string | null;
  worst_tone: string | null;
}

/**
 * `F3.73` (plan D9, Task 3.4; ruling Q6a) — `GET /api/v1/dashboards/:id/site-widgets?tab=<key>`:
 * everything the five site widgets on one dashboard tab draw, in one read.
 *
 * **Access.** `MimicNodesService.forUser`'s seam, copied: the caller's readable organizations
 * decide whether the dashboard exists for them at all (a 404, never a 403 — a 403 would confirm
 * the id), then `readableAssetIds` narrows which assets count. An unknown `tab` is a 404 too.
 *
 * **Two handles (AGENTS.md §4.3, ADR 0043 Amendment 3).** Only `forUser`'s by-id dashboard
 * lookup runs on the fleet handle, for a named reason: the organization is not known until that
 * row is read, so there is no tenant to name yet — and the lookup carries the caller's readable
 * organizations as its own predicate. Everything after it, `read()`, runs under
 * `withTenant(tenantDb, dashboard.organizationId)` (`MetricCatalogService.catalogValues`' shape),
 * so the tenant policy backs every statement. The explicit `organization_id` predicates stay:
 * they make the read correct on any pool. Nothing ties `dashboard_tabs.organization_id` to its
 * dashboard's, so a tab stamped with another organization is neither found by `?tab=` nor listed
 * in `tabs` (`site-widgets.service.integration.spec.ts` writes that row and proves both).
 *
 * **Scope (plan D9).** A tab that binds a group reads that group's members; the Overview tab, or
 * a dashboard with no tabs, reads the dashboard's own scope. Either is resolved to asset ids by
 * `resolveAssetScope` (`dashboard-scope-assets.ts`, the catalog's own definition), intersected
 * with what the caller may read, and then with the organization's ACTIVE assets
 * (`activeAssetIds`): `resolveAssetScope`'s group and location arms keep a retired asset, and the
 * tab statuses count active members only, so without it one response counted two memberships.
 *
 * **Alarms.** `AlarmsService` is not reachable from this module — it is not exported, and
 * providing it here would build a second `AlarmsGateway`. The rail therefore reuses the alarm
 * read's own builders: `alarmListItemColumns` / `toAlarmListItem` for the rows (newest first, the
 * `GET /alarms?state=active` order) and `activeAlarmFilter` for "active", with the summary in
 * `activeCountsBySeverity`'s shape — every active severity a row, zero allowed. No new query field
 * opens on `/alarms`.
 *
 * **Roles.** `AssetRoleSummaryService.summarize` with an EXPLICIT group scope: the tab's group,
 * or on the Overview the groups of the dashboard's scope — narrowed to the groups the caller may
 * read (`readableGroupScope`, security L1). An empty group list answers `{ items: [] }`.
 *
 * **Tabs (ruling Q6a).** One statement over every GROUP tab of the dashboard, whatever tab was
 * asked for, so the Overview's module cards and critical-systems list read their status here: the
 * worst `bms.alarm_severities.rank` among the active alarms of the tab group's readable active
 * members, their active-alarm count, how many of them have no sample in the shared live window
 * (`LIVE_ASSETS_CTE_SQL`, `telemetry-freshness.ts` — never a restated interval), and how many
 * there are. A tab with no group (the Overview) is not listed: it has no status to show. A tab
 * whose group has members, none of them readable, answers `status: null` ("Outside scope"),
 * never a zero that would read as healthy.
 */
@Injectable()
export class SiteWidgetsService {
  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(TENANT_DRIZZLE) private readonly tenantDb: BmsDb,
    private readonly accessControl: AccessControlService,
    private readonly roleSummary: AssetRoleSummaryService,
  ) {}

  async forUser(jwt: JwtPayload, dashboardId: string, tabKey: string | undefined): Promise<SiteWidgetsResponse> {
    const orgIds = await this.accessControl.readableOrganizationIds(jwt);
    // The one fleet read: the organization is unknown until this row answers (class docblock).
    const [row] = await this.fleetDb
      .select({
        id: dashboards.id,
        organizationId: dashboards.organizationId,
        locationId: dashboards.locationId,
        assetGroupId: dashboards.assetGroupId,
        assetId: dashboards.assetId,
      })
      .from(dashboards)
      .where(
        orgIds === null
          ? eq(dashboards.id, dashboardId)
          : and(eq(dashboards.id, dashboardId), inArray(dashboards.organizationId, orgIds)),
      )
      .limit(1);
    if (!row) {
      throw new NotFoundException("Dashboard not found");
    }
    const readable = await this.accessControl.readableAssetIds(jwt);
    // An unrestricted reader is `null` here too, and `currentUser` is not called for it — the
    // `GET /assets/role-summary` controller's rule.
    const groups = readable === null ? null : readableGroupScope((await this.accessControl.currentUser(jwt)).scope);
    return this.read(row, tabKey ?? null, readable, groups, Date.now());
  }

  /**
   * The access-free half. `readableAssetIds = null` reads every asset of the organization;
   * `readableGroups` is the caller's {@link RoleSummaryGroupScope} (`null`: unrestricted).
   */
  async read(
    dashboard: SiteWidgetsDashboard,
    tabKey: string | null,
    readableAssetIds: readonly string[] | null,
    readableGroups: RoleSummaryGroupScope,
    nowMs: number,
  ): Promise<SiteWidgetsResponse> {
    const organizationId = dashboard.organizationId;
    const { assetIds, groupIds, active, summary, tabs } = await withTenant(this.tenantDb, organizationId, async (tx) => {
      let scope: DashboardAssetScope = {
        locationId: dashboard.locationId,
        assetGroupId: dashboard.assetGroupId,
        assetId: dashboard.assetId,
      };
      let tabGroupId: string | null = null;
      if (tabKey !== null) {
        const [tab] = await tx
          .select({ assetGroupId: dashboardTabs.assetGroupId })
          .from(dashboardTabs)
          .where(
            and(
              eq(dashboardTabs.dashboardId, dashboard.id),
              eq(dashboardTabs.organizationId, organizationId),
              eq(dashboardTabs.tabKey, tabKey),
            ),
          )
          .limit(1);
        if (!tab) {
          throw new NotFoundException("Dashboard tab not found");
        }
        tabGroupId = tab.assetGroupId;
        if (tabGroupId !== null) {
          // `locationId` must be null, or the location arm fires first and the group is ignored
          // (`DashboardAssetScope`'s docblock).
          scope = { locationId: null, assetGroupId: tabGroupId, assetId: null };
        }
      }
      const scopedIds = await activeAssetIds(
        tx,
        organizationId,
        await resolveAssetScope(tx, organizationId, scope, readableAssetIds),
      );
      const candidates =
        tabGroupId !== null
          ? await groupsWhere(tx, organizationId, eq(assetGroups.id, tabGroupId))
          : await overviewGroups(tx, dashboard);
      return {
        assetIds: scopedIds,
        groupIds: readableGroupIds(candidates, readableGroups),
        active: await activeAlarms(tx, organizationId, scopedIds),
        summary: await severityCounts(tx, organizationId, scopedIds),
        tabs: await tabStatuses(tx, organizationId, dashboard.id, readableAssetIds),
      };
    });

    const roles = await this.roleSummary.summarize([...assetIds], { groupIds });
    return {
      dashboardId: dashboard.id,
      tabKey,
      resolvedAt: new Date(nowMs).toISOString(),
      scope: { assetCount: assetIds.length },
      alarms: { active, summary },
      roles: roles.items,
      tabs,
    };
  }
}

/**
 * The groups the role summary may count, narrowed to the caller's readable groups (security L1,
 * `readableGroupScope`): every candidate for an unrestricted reader, the granted ones for an
 * asset-group grant, the ones sited at a readable location for a location or organization grant.
 */
export function readableGroupIds(
  candidates: readonly CandidateGroup[],
  readable: RoleSummaryGroupScope,
): string[] {
  if (readable === null) {
    return candidates.map((group) => group.id);
  }
  if ("groupIds" in readable) {
    const granted = new Set(readable.groupIds);
    return candidates.filter((group) => granted.has(group.id)).map((group) => group.id);
  }
  const locations = new Set(readable.locationIds);
  return candidates.filter((group) => locations.has(group.locationId)).map((group) => group.id);
}

async function groupsWhere(
  tx: BmsTx,
  organizationId: string,
  where: ReturnType<typeof eq>,
): Promise<CandidateGroup[]> {
  return tx
    .select({ id: assetGroups.id, locationId: assetGroups.locationId })
    .from(assetGroups)
    .where(and(where, eq(assetGroups.organizationId, organizationId)))
    .orderBy(asc(assetGroups.code));
}

/**
 * The Overview's (or a tab-less dashboard's) groups, by the dashboard's own scope axis: its
 * group, the groups at its site, or — an asset-scoped or organization-wide dashboard — the
 * organization's groups. The summary's asset filter narrows every one of these further.
 */
async function overviewGroups(tx: BmsTx, dashboard: SiteWidgetsDashboard): Promise<CandidateGroup[]> {
  if (dashboard.assetGroupId !== null) {
    return groupsWhere(tx, dashboard.organizationId, eq(assetGroups.id, dashboard.assetGroupId));
  }
  if (dashboard.locationId !== null) {
    return groupsWhere(tx, dashboard.organizationId, eq(assetGroups.locationId, dashboard.locationId));
  }
  return groupsWhere(tx, dashboard.organizationId, eq(assetGroups.organizationId, dashboard.organizationId));
}

/**
 * The scope's ACTIVE assets, in the scope's order — the one membership rule the rail, the
 * summary, `scope.assetCount`, the roles and `tabStatuses` (`a.active = true`) all count by.
 * An empty scope reads nothing.
 */
async function activeAssetIds(
  tx: BmsTx,
  organizationId: string,
  assetIds: readonly string[],
): Promise<readonly string[]> {
  if (assetIds.length === 0) {
    return assetIds;
  }
  const rows = await tx
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(inArray(assets.id, [...assetIds]), eq(assets.organizationId, organizationId), eq(assets.active, true)),
    );
  const active = new Set(rows.map((row) => row.id));
  return assetIds.filter((id) => active.has(id));
}

/** The rail's rows: the newest active alarms in scope, `MAX_SITE_ALARM_ROWS` at most. */
async function activeAlarms(tx: BmsTx, organizationId: string, assetIds: readonly string[]) {
  if (assetIds.length === 0) {
    return [];
  }
  const rows = await tx
    .select(alarmListItemColumns)
    .from(alarms)
    .innerJoin(assets, eq(alarms.assetId, assets.id))
    .where(
      and(
        inArray(alarms.assetId, [...assetIds]),
        eq(alarms.organizationId, organizationId),
        eq(assets.organizationId, organizationId),
        activeAlarmFilter,
      ),
    )
    .orderBy(desc(alarms.raisedAt), desc(alarms.id))
    .limit(MAX_SITE_ALARM_ROWS);
  return rows.map((row) => toAlarmListItem(row));
}

/**
 * Active alarm counts per active severity, ascending `rank` — `activeCountsBySeverity`'s shape:
 * the scope and active predicates sit in the `ON` clause so a severity with no alarm keeps its row
 * and `count(alarms.id)` answers 0. An empty scope never reads `bms.alarms`.
 */
async function severityCounts(
  tx: BmsTx,
  organizationId: string,
  assetIds: readonly string[],
): Promise<AlarmSeverityCount[]> {
  const columns = {
    code: alarmSeverities.code,
    label: alarmSeverities.label,
    tone: alarmSeverities.tone,
    rank: alarmSeverities.rank,
  };
  const rows =
    assetIds.length === 0
      ? (
          await tx
            .select(columns)
            .from(alarmSeverities)
            .where(eq(alarmSeverities.active, true))
            .orderBy(asc(alarmSeverities.rank))
        ).map((severity) => ({ ...severity, count: 0 }))
      : await tx
          .select({ ...columns, count: sql<number>`count(${alarms.id})::int` })
          .from(alarmSeverities)
          .leftJoin(
            alarms,
            and(
              eq(alarms.severity, alarmSeverities.code),
              activeAlarmFilter,
              inArray(alarms.assetId, [...assetIds]),
              eq(alarms.organizationId, organizationId),
            ),
          )
          .where(eq(alarmSeverities.active, true))
          .groupBy(alarmSeverities.code, alarmSeverities.label, alarmSeverities.tone, alarmSeverities.rank)
          .orderBy(asc(alarmSeverities.rank));
  // `tone` is closed by `alarm_severities_tone_check` in SQL, so the column's `string` is
  // narrowed to the contract's palette here.
  return rows.map((row) => ({
    ...row,
    rank: Number(row.rank),
    count: Number(row.count),
    tone: row.tone as AlarmSeverityCount["tone"],
  }));
}

/**
 * Ruling Q6a — every group tab's status, in one statement, in the tabs' `sort_order`.
 *
 * `members` holds each group tab's ACTIVE member assets of this organization, each flagged
 * `readable`; `per_asset` keeps only the readable ones, with the asset's worst active-alarm rank
 * and count (`cleared_at IS NULL`, ADR 0057 decision 1) and whether it is missing from the shared
 * `live` window. `member_total` counts every member so the caller can tell "none readable"
 * (status `null`) from "no member" (a zero status). The readable array is one bound parameter,
 * never expanded into a list.
 */
async function tabStatuses(
  tx: BmsTx,
  organizationId: string,
  dashboardId: string,
  readableAssetIds: readonly string[] | null,
): Promise<SiteWidgetTab[]> {
  const readable =
    readableAssetIds === null ? sql`TRUE` : sql`a.id = ANY(${sql.param([...readableAssetIds])}::uuid[])`;
  const result = await tx.execute<TabStatusRow>(sql`
    WITH ${sql.raw(LIVE_ASSETS_CTE_SQL)},
    group_tabs AS (
      SELECT dt.tab_key, dt.label, dt.asset_group_id, dt.sort_order
      FROM bms.dashboard_tabs dt
      WHERE dt.dashboard_id = ${dashboardId}
        AND dt.organization_id = ${organizationId}
        AND dt.asset_group_id IS NOT NULL
    ),
    members AS (
      SELECT gt.tab_key, a.id AS asset_id, (${readable}) AS readable
      FROM group_tabs gt
      INNER JOIN bms.asset_groups ag
        ON ag.id = gt.asset_group_id AND ag.organization_id = ${organizationId}
      INNER JOIN bms.asset_group_members agm ON agm.asset_group_id = ag.id
      INNER JOIN bms.assets a
        ON a.id = agm.asset_id AND a.organization_id = ${organizationId} AND a.active = true
    ),
    per_asset AS (
      SELECT
        m.tab_key,
        m.asset_id,
        (l.asset_id IS NULL) AS offline,
        (
          SELECT max(s.rank)
          FROM bms.alarms al
          INNER JOIN bms.alarm_severities s ON s.code = al.severity
          WHERE al.asset_id = m.asset_id AND al.organization_id = ${organizationId} AND al.cleared_at IS NULL
        ) AS worst_rank,
        (
          SELECT count(*)::int
          FROM bms.alarms al
          WHERE al.asset_id = m.asset_id AND al.organization_id = ${organizationId} AND al.cleared_at IS NULL
        ) AS active_alarms
      FROM members m
      LEFT JOIN live l ON l.asset_id = m.asset_id
      WHERE m.readable
    ),
    per_tab AS (
      SELECT
        gt.tab_key,
        (SELECT count(*)::int FROM members m WHERE m.tab_key = gt.tab_key) AS member_total,
        count(pa.asset_id)::int AS assets,
        COALESCE(sum(pa.active_alarms), 0)::int AS active_alarms,
        (count(*) FILTER (WHERE pa.offline))::int AS offline_assets,
        max(pa.worst_rank) AS worst_rank
      FROM group_tabs gt
      LEFT JOIN per_asset pa ON pa.tab_key = gt.tab_key
      GROUP BY gt.tab_key
    )
    SELECT gt.tab_key, gt.label, gt.asset_group_id,
           pt.member_total, pt.assets, pt.active_alarms, pt.offline_assets,
           s.code AS worst_severity, s.tone AS worst_tone
    FROM group_tabs gt
    INNER JOIN per_tab pt ON pt.tab_key = gt.tab_key
    LEFT JOIN bms.alarm_severities s ON s.rank = pt.worst_rank
    ORDER BY gt.sort_order, gt.tab_key
  `);
  return result.rows.map(tabOf);
}

/** One status row as the contract's tab: `status: null` when the group has members, none readable. */
export function tabOf(row: TabStatusRow): SiteWidgetTab {
  const assetCount = Number(row.assets);
  return {
    tabKey: row.tab_key,
    label: row.label,
    assetGroupId: row.asset_group_id,
    status:
      Number(row.member_total) > 0 && assetCount === 0
        ? null
        : {
            worstSeverity: row.worst_severity,
            // `tone` is closed by `alarm_severities_tone_check`; no active alarm reads `ok`.
            tone: (row.worst_tone ?? "ok") as NonNullable<SiteWidgetTab["status"]>["tone"],
            activeAlarms: Number(row.active_alarms),
            offlineAssets: Number(row.offline_assets),
            assets: assetCount,
          },
  };
}
