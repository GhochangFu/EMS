import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import type { Pool } from "pg";

import { dashboards } from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  MIMIC_FANOUT_MAX,
  MIMIC_HEADLINE_POINTS,
  mimicConfigSchema,
  type DashboardMimicNodesResponseDto,
  type GeneratedSitePointDto,
  type JwtPayload,
  type MimicLayoutGeometryDto,
  type MimicNodeDto,
  type MimicNodeMemberDto,
  type PointKeyStateMapDto,
} from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
import { orgSymbolsOf, type OrgSymbolRow } from "../mimic-layouts/mimic-org-symbols";
// A namespace import, so the window constant's name appears in this file once: at the one
// place it is interpolated (`tests/f3.32-mimic-widget.test.ts` counts it in the raw text).
import * as generatedSiteView from "../control-room/generated-site-view.service";
import { FLEET_DRIZZLE, FLEET_POOL } from "../database/database.tokens";

import {
  assetOf,
  layoutNodeOf,
  listedPairs,
  presetRoledNodes,
  roledUnits,
  stateMapsOf,
  toIsoString,
  topAlarmOf,
  worstTopAlarm,
  type LayoutNodeRow,
  type LayoutOrgSymbolRow,
  type LayoutPipeRow,
  type MemberRow,
  type ParsedWidget,
  type PointRow,
  type ResolvableNode,
  type StateMapRow,
  type WidgetRow,
} from "./mimic-nodes.pure";

/**
 * `F3.32` / ADR 0079 — `GET /api/v1/dashboards/:id/mimic-nodes` (plan D1, U2): every `mimic`
 * widget on one dashboard, each preset node resolved AT READ TIME to the member of the
 * widget's asset group — its tab's group, else the dashboard's (`F3.73` plan D3) — that carries
 * the node's `bms.asset_roles` code.
 *
 * **Access.** `forUser` is `MetricCatalogService.catalogValues`' seam, copied: the caller's
 * readable organizations decide whether the dashboard exists for them at all (a 404, never a
 * 403 — a 403 would confirm the id), then `readableAssetIds` narrows which members count. The
 * by-id lookup runs on the fleet Drizzle handle because the organization is not known until the
 * row is read; `bms_fleet` holds `BYPASSRLS`, so the `inArray` is the containment.
 *
 * **Readable first, then counted (plan D6).** A member outside the caller's readable asset set
 * does not exist for this read: it is neither shown nor counted in `memberCount`, so a `+N`
 * badge cannot confirm an asset the caller may not see. A role whose every member is
 * unreadable reads "Not assigned", exactly as a role no member carries.
 *
 * **The read.** Three statements for a dashboard of preset widgets, five when a widget names a
 * layout (`F3.32c` plan D9), one more when a shown asset has a state point (`F3.74`), all on `FLEET_POOL` (ADR 0043 Amendment 3: the `WHERE` is the
 * isolation control, so every statement names the organization explicitly):
 *
 * 1. The dashboard, left-joined to its mimic widgets, each left-joined to its tab (`F3.73`
 *    plan D3): a widget resolves against its tab's group, else the dashboard's
 *    (`COALESCE`), so two domain tabs on one site dashboard each resolve their own group. The
 *    tab join carries its own `organization_id` predicate — nothing ties a tab's organization
 *    to its dashboard's, so a tab stamped with another organization reads as "no group" rather
 *    than lending its binding. `F3.74` (plan D7, ADR 0088 decision 11): a widget may NAME a tab
 *    in `config.tabKey`, so an Overview mimic draws the SLD of a group-bound tab; the named tab
 *    is a second join on the SAME dashboard with its own organization predicate, and the group
 *    is `COALESCE(own tab, named tab, dashboard)`. A name with no tab here — another
 *    dashboard's, or one stamped with another organization — adds nothing, never throws.
 *    A widget whose stored config no longer parses is skipped with
 *    one warning (field paths only), never thrown. No parsable mimic widget → `widgets: []`; no
 *    widget with a group (an Overview-tab mimic on a site dashboard, or a group-less dashboard)
 *    → every node unassigned, for that widget only. Both end here when no widget has a group.
 *    1b. Only when a widget takes the layout arm (ADR 0081 decision 6): those layouts of THIS
 *    organization, each left-joined to its nodes. A layout id with no row here — deleted, or
 *    another organization's — skips its widget with one warning (ids only), never thrown.
 *    `F4.307` (plan C2): each node also carries its point list, a correlated `array_agg` by
 *    `ord` in the same statement, so the count does not move.
 *    1c. Only when (1b) found a layout: their pipes, each end named by its node's key.
 * 2. Per distinct group the widgets resolve against, and per role the presets and the layouts'
 *    roled units name, the first readable member by asset code, how many readable
 *    members carry the role, and the shown asset's open-alarm count (`cleared_at IS NULL`,
 *    ADR 0057 decision 1). `F3.32b` (ADR 0079 Amendment 2 item 3) folds the shown asset's most
 *    severe open alarm into the same statement as a lateral: `bms.alarm_severities.rank DESC`
 *    (a higher rank is more severe, ADR 0032), then `raised_at DESC`, then `id` so a tie is
 *    stable. The same join answers the severity's `tone` and `label`, so the widget draws a
 *    level from its vocabulary row, never from a list of codes (ADR 0032 decision 9). Its
 *    `message` is the stored text the Alarm Centre already shows; it is never logged.
 *    `F3.74` (plan D4, ADR 0088 decision 4): a node that FANS OUT (a preset node's `fanOut`, a
 *    layout unit's `fan_out`) stands for every readable member of its role up to
 *    `MIMIC_FANOUT_MAX`, by code, so the statement numbers the members with `row_number()` in
 *    place of `DISTINCT ON` and keeps the first for every role, and the rest for a fan-out role.
 *    The readable filter runs BEFORE the windows, so `member_count` stays the readable count.
 * 3. Each shown asset's top `MIMIC_HEADLINE_POINTS` active points, ordered by F3.68's rule
 *    (`headline_rank ASC NULLS LAST, point_key ASC`), the limit applied PER ASSET inside a
 *    lateral, each point's newest sample found by F3.68's bounded literal-window lateral —
 *    never a bound `now() - $n`, which plans every hypertable chunk. `F3.74` (plan D4) adds,
 *    in the SAME statement and through the same one window lateral, each shown asset's STATE
 *    points: every active `asset_points` key that has a `bms.point_key_states` row — no key
 *    name is written here. Their samples count toward the asset's freshness. `F4.307` (plan
 *    C3, C4): a third arm reads the keys the roled units list, per (asset, key) pair of the
 *    units' shown members; a key the asset does not hold active reads no sample (`held`).
 * 4. `F3.74` — only when (3) found a state point: the `bms.point_key_states` rows of the keys
 *    seen, answered as `stateMaps`. The web derives a switch state from them (plan D12).
 *
 * **Rows are mapped by hand** — no `.parse` of stored data beyond the widget config.
 *
 * **The layout preview** (`F4.308`, ADR 0081 Amendment 2 decision 1): `readLayoutPreview` skips
 * statement (1) and hands (1b) to (4) one synthetic layout widget bound to the asked group, so the
 * dashboard read and the preview share every resolving statement (`resolveWidgets`).
 */
/** Which read `resolveWidgets` serves, by id only — named in its skip warning (§4.3 / §9.6). */
type ResolveContext = { readonly dashboardId: string } | { readonly previewLayoutId: string };

@Injectable()
export class MimicNodesService {
  private readonly logger = new Logger(MimicNodesService.name);

  constructor(
    @Inject(FLEET_DRIZZLE) private readonly fleetDb: BmsDb,
    @Inject(FLEET_POOL) private readonly pool: Pool,
    private readonly accessControl: AccessControlService,
  ) {}

  async forUser(jwt: JwtPayload, dashboardId: string): Promise<DashboardMimicNodesResponseDto> {
    const orgIds = await this.accessControl.readableOrganizationIds(jwt);
    const [row] = await this.fleetDb
      .select({ id: dashboards.id, organizationId: dashboards.organizationId })
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
    return this.read(
      row.organizationId,
      dashboardId,
      await this.accessControl.readableAssetIds(jwt),
      Date.now(),
    );
  }

  /**
   * The pool-only half. `readableAssetIds = null` reads every member; `[]` answers every node
   * unassigned without statements (2) and (3).
   */
  async read(
    organizationId: string,
    dashboardId: string,
    readableAssetIds: readonly string[] | null,
    nowMs: number,
  ): Promise<DashboardMimicNodesResponseDto> {
    const resolvedAt = new Date(nowMs).toISOString();

    const widgetRows = await this.pool.query<WidgetRow>(
      `
      SELECT COALESCE(dt.asset_group_id, nt.asset_group_id, d.asset_group_id) AS asset_group_id,
             w.id AS widget_id, w.config
      FROM bms.dashboards d
      LEFT JOIN bms.dashboard_widgets w
        ON w.dashboard_id = d.id
       AND w.organization_id = d.organization_id
       AND w.widget_type = 'mimic'
      LEFT JOIN bms.dashboard_tabs dt
        ON dt.id = w.tab_id
       AND dt.dashboard_id = d.id
       AND dt.organization_id = $2
      LEFT JOIN bms.dashboard_tabs nt
        ON nt.dashboard_id = d.id
       AND nt.tab_key = w.config->>'tabKey'
       AND nt.organization_id = $2
      WHERE d.id = $1 AND d.organization_id = $2
      ORDER BY w.grid_y, w.grid_x, w.id
      `,
      [dashboardId, organizationId],
    );

    const parsedWidgets: ParsedWidget[] = [];
    for (const row of widgetRows.rows) {
      if (row.widget_id === null) continue;
      const parsed = mimicConfigSchema.safeParse(row.config);
      if (!parsed.success) {
        // ONE string: nestjs-pino reads a trailing string argument as the context. Field paths
        // only, never the stored values (§4.3 / §9.6).
        this.logger.warn(
          "mimic widget config failed mimicConfigSchema; widget skipped: " +
            `dashboard ${dashboardId}, widget ${row.widget_id}, paths ` +
            parsed.error.issues.map((issue) => issue.path.join(".")).join(","),
        );
        continue;
      }
      parsedWidgets.push({ widgetId: row.widget_id, groupId: row.asset_group_id, ...parsed.data });
    }

    const { widgets, stateMaps } = await this.resolveWidgets(organizationId, parsedWidgets, readableAssetIds, nowMs, {
      dashboardId,
    });
    return { dashboardId, resolvedAt, widgets, stateMaps };
  }

  /**
   * `F4.308` / ADR 0081 Amendment 2 (plan C4, C5) — one STORED layout resolved against one asset
   * group, with no dashboard: statement (1) is replaced by one synthetic layout widget, and
   * statements (1b) to (4) run unchanged. The shared answer needs a UUID in `dashboardId` and
   * `widgetId`; both carry the layout id (owner ruling Q1 a). A layout this organization does not
   * hold answers `widgets: []` (the caller's 404). Nothing is written.
   */
  async readLayoutPreview(
    organizationId: string,
    layoutId: string,
    assetGroupId: string,
    readableAssetIds: readonly string[] | null,
    nowMs: number,
  ): Promise<DashboardMimicNodesResponseDto> {
    const resolvedAt = new Date(nowMs).toISOString();
    const { widgets, stateMaps } = await this.resolveWidgets(
      organizationId,
      [{ source: "layout", widgetId: layoutId, layoutId, groupId: assetGroupId }],
      readableAssetIds,
      nowMs,
      { previewLayoutId: layoutId },
    );
    return { dashboardId: layoutId, resolvedAt, widgets, stateMaps };
  }

  /**
   * Statements (1b) to (4) for the parsed widgets, in their order: the shared half of `read()`
   * and `readLayoutPreview()`. `context` (ids only) names the read in the skip warning.
   */
  private async resolveWidgets(
    organizationId: string,
    parsedWidgets: readonly ParsedWidget[],
    readableAssetIds: readonly string[] | null,
    nowMs: number,
    context: ResolveContext,
  ): Promise<Pick<DashboardMimicNodesResponseDto, "widgets" | "stateMaps">> {
    const layoutIds = [
      ...new Set(parsedWidgets.flatMap((widget) => (widget.source === "layout" ? [widget.layoutId] : []))),
    ];
    const layouts =
      layoutIds.length > 0
        ? await this.readLayouts(organizationId, layoutIds)
        : new Map<string, MimicLayoutGeometryDto>();

    const widgets: ParsedWidget[] = [];
    for (const widget of parsedWidgets) {
      if (widget.source === "layout" && !layouts.has(widget.layoutId)) {
        // Ids only (§4.3 / §9.6). Deleted, or another organization's: this read cannot tell,
        // and must not — `FLEET_POOL` bypasses RLS, so the `WHERE` in (1b) is what hid it.
        this.logger.warn(
          "mimic widget names a layout this organization does not hold; widget skipped: " +
            ("dashboardId" in context ? `dashboard ${context.dashboardId}` : `layout preview ${context.previewLayoutId}`) +
            `, widget ${widget.widgetId}, layout ${widget.layoutId}`,
        );
        continue;
      }
      widgets.push(widget);
    }
    if (widgets.length === 0) {
      return { widgets: [], stateMaps: [] };
    }

    // The nodes each widget resolves: a preset's roled nodes (a `roleCode: null` bus is drawn,
    // never resolved — `F3.74` OQ8, the `roledUnits` rule applied to presets) or a layout's
    // roled units, each with whether it fans out.
    const nodesOf = (widget: ParsedWidget): ResolvableNode[] =>
      widget.source === "preset"
        ? presetRoledNodes(widget.preset)
        : roledUnits(layouts.get(widget.layoutId));

    // Every group a widget resolves against, once: ONE members statement reads them all.
    const groupIds = [...new Set(widgets.flatMap((widget) => (widget.groupId === null ? [] : [widget.groupId])))];
    const roleCodes = [...new Set(widgets.flatMap((widget) => nodesOf(widget).map((node) => node.roleCode)))];
    // A role fans out when ANY widget's node of that role does; a widget whose node does not
    // still shows only the first (`resolveNode`), so the extra rows cost reads, never answers.
    const fanOutRoleCodes = [
      ...new Set(widgets.flatMap((widget) => nodesOf(widget).flatMap((node) => (node.fanOut ? [node.roleCode] : [])))),
    ];
    /** Members per group, then per role, by code (`rn` order). */
    const members = new Map<string, Map<string, MemberRow[]>>();
    const pointsByAsset = new Map<string, GeneratedSitePointDto[]>();
    const statePointsByAsset = new Map<string, GeneratedSitePointDto[]>();
    /** `F4.307` (plan C4): per shown asset, the keys a unit lists for it, by key. */
    const listedByAsset = new Map<string, Map<string, GeneratedSitePointDto>>();
    let stateMaps: PointKeyStateMapDto[] = [];

    if (groupIds.length > 0 && (readableAssetIds === null || readableAssetIds.length > 0)) {
      const memberRows = await this.pool.query<MemberRow>(
        `
        SELECT
          m.asset_group_id,
          m.role,
          m.rn,
          m.asset_id,
          m.asset_code,
          m.asset_name,
          m.rtu_display_name,
          m.location_name,
          m.domain,
          m.member_count,
          (
            SELECT count(*)::int
            FROM bms.alarms al
            WHERE al.asset_id = m.asset_id
              AND al.organization_id = $2
              AND al.cleared_at IS NULL
          ) AS active_alarms,
          ta.severity AS top_alarm_severity,
          ta.tone AS top_alarm_tone,
          ta.label AS top_alarm_label,
          ta.message AS top_alarm_message,
          ta.raised_at AS top_alarm_raised_at,
          ta.rank AS top_alarm_rank
        FROM (
          SELECT
            agm.asset_group_id,
            agm.role,
            (row_number() OVER (PARTITION BY agm.asset_group_id, agm.role ORDER BY a.code ASC))::int AS rn,
            a.id AS asset_id,
            a.code AS asset_code,
            a.name AS asset_name,
            r.display_name AS rtu_display_name,
            l.name AS location_name,
            a.domain,
            (count(*) OVER (PARTITION BY agm.asset_group_id, agm.role))::int AS member_count
          FROM bms.asset_group_members agm
          INNER JOIN bms.asset_groups ag
            ON ag.id = agm.asset_group_id AND ag.organization_id = $2
          INNER JOIN bms.assets a
            ON a.id = agm.asset_id AND a.organization_id = $2
          LEFT JOIN bms.rtus r ON r.id = a.rtu_id
          LEFT JOIN bms.locations l ON l.id = a.location_id
          WHERE agm.asset_group_id = ANY($1::uuid[])
            AND agm.role = ANY($3::text[])
            AND ($4::uuid[] IS NULL OR a.id = ANY($4::uuid[]))
        ) m
        LEFT JOIN LATERAL (
          SELECT al.severity, s.tone, s.label, al.message, al.raised_at, s.rank
          FROM bms.alarms al
          INNER JOIN bms.alarm_severities s ON s.code = al.severity
          WHERE al.asset_id = m.asset_id
            AND al.organization_id = $2
            AND al.cleared_at IS NULL
          ORDER BY s.rank DESC, al.raised_at DESC, al.id ASC
          LIMIT 1
        ) ta ON true
        WHERE m.rn = 1 OR (m.rn <= $6 AND m.role = ANY($5::text[]))
        ORDER BY m.asset_group_id, m.role, m.rn
        `,
        [groupIds, organizationId, roleCodes, readableAssetIds, fanOutRoleCodes, MIMIC_FANOUT_MAX],
      );
      for (const row of memberRows.rows) {
        const byRole = members.get(row.asset_group_id) ?? new Map<string, MemberRow[]>();
        byRole.set(row.role, [...(byRole.get(row.role) ?? []), row]);
        members.set(row.asset_group_id, byRole);
      }

      const shownIds = [...new Set(memberRows.rows.map((member) => member.asset_id))];
      const listed = listedPairs(widgets, nodesOf, members);
      if (shownIds.length > 0) {
        const pointRows = await this.pool.query<PointRow>(
          `
          SELECT
            sa.id AS asset_id,
            top.point_key,
            top.name,
            top.unit,
            top.headline_rank,
            top.is_state,
            top.is_listed,
            top.value,
            top.time
          FROM unnest($1::uuid[]) AS sa(id)
          CROSS JOIN LATERAL (
            SELECT
              ranked.point_key,
              ranked.name,
              ranked.unit,
              ranked.headline_rank,
              ranked.is_state,
              ranked.is_listed,
              lt.value,
              lt.time
            FROM (
              (
                SELECT ap.point_key, pk.name, COALESCE(ap.unit, pk.unit) AS unit, pk.headline_rank,
                       false AS is_state, false AS is_listed, true AS held
                FROM bms.asset_points ap
                LEFT JOIN bms.point_keys pk ON pk.code = ap.point_key
                WHERE ap.asset_id = sa.id
                  AND ap.organization_id = $2
                  AND ap.active = true
                ORDER BY pk.headline_rank ASC NULLS LAST, ap.point_key ASC
                LIMIT ${MIMIC_HEADLINE_POINTS}
              )
              UNION ALL
              SELECT sp.point_key, spk.name, COALESCE(sp.unit, spk.unit) AS unit, spk.headline_rank,
                     true AS is_state, false AS is_listed, true AS held
              FROM bms.asset_points sp
              LEFT JOIN bms.point_keys spk ON spk.code = sp.point_key
              WHERE sp.asset_id = sa.id
                AND sp.organization_id = $2
                AND sp.active = true
                AND EXISTS (SELECT 1 FROM bms.point_key_states pks WHERE pks.point_key_code = sp.point_key)
              UNION ALL
              SELECT lk.point_key, lpk.name, COALESCE(lap.unit, lpk.unit) AS unit, lpk.headline_rank,
                     false AS is_state, true AS is_listed, (lap.id IS NOT NULL) AS held
              FROM unnest($3::uuid[], $4::text[], $5::smallint[]) AS lk(asset_id, point_key, ord)
              LEFT JOIN bms.point_keys lpk ON lpk.code = lk.point_key
              LEFT JOIN bms.asset_points lap
                ON lap.asset_id = sa.id
               AND lap.point_key = lk.point_key
               AND lap.organization_id = $2
               AND lap.active = true
              WHERE lk.asset_id = sa.id
            ) ranked
            LEFT JOIN LATERAL (
              SELECT pv.value, pv.time
              FROM telemetry.point_values pv
              WHERE ranked.held
                AND pv.asset_id = sa.id
                AND pv.point_key = ranked.point_key
                AND pv.time > now() - ${generatedSiteView.GENERATED_LATEST_WINDOW_SQL}
              ORDER BY pv.time DESC
              LIMIT 1
            ) lt ON true
          ) top
          ORDER BY sa.id, top.is_state, top.headline_rank ASC NULLS LAST, top.point_key ASC
          `,
          [shownIds, organizationId, listed.assetIds, listed.pointKeys, listed.ords],
        );
        for (const row of pointRows.rows) {
          const time = toIsoString(row.time);
          const point: GeneratedSitePointDto = {
            pointKey: row.point_key,
            name: row.name,
            unit: row.unit,
            headlineRank: row.headline_rank === null ? null : Number(row.headline_rank),
            latest: time !== null && row.value !== null ? { value: Number(row.value), time } : null,
          };
          if (row.is_listed) {
            const byKey = listedByAsset.get(row.asset_id) ?? new Map<string, GeneratedSitePointDto>();
            listedByAsset.set(row.asset_id, byKey.set(row.point_key, point));
            continue;
          }
          const byAsset = row.is_state ? statePointsByAsset : pointsByAsset;
          byAsset.set(row.asset_id, [...(byAsset.get(row.asset_id) ?? []), point]);
        }

        // Statement (4): the maps of the state keys seen, and only those — `bms.point_key_states`
        // is global master data (0097, no `organization_id`), so the key list is the filter.
        const stateKeys = [
          ...new Set([...statePointsByAsset.values()].flatMap((points) => points.map((point) => point.pointKey))),
        ];
        if (stateKeys.length > 0) {
          const stateRows = await this.pool.query<StateMapRow>(
            `
            SELECT pks.point_key_code, pks.value, pks.label, pks.tone
            FROM bms.point_key_states pks
            WHERE pks.point_key_code = ANY($1::text[])
            ORDER BY pks.point_key_code, pks.value
            `,
            [stateKeys],
          );
          stateMaps = stateMapsOf(stateRows.rows);
        }
      }
    }

    // One resolution for both arms (ADR 0081 decision 6): a layout's unit resolves exactly as a
    // preset node does, by its role code against the members of the WIDGET's group (`F3.73`
    // plan D3), and fans out exactly as a preset node does (`F3.74` OQ3b). A widget with no
    // group finds no member, so every node reads unassigned.
    const resolveNode = (groupId: string | null, node: ResolvableNode): MimicNodeDto => {
      const rows = groupId === null ? [] : (members.get(groupId)?.get(node.roleCode) ?? []);
      const first = rows[0];
      if (first === undefined) {
        return {
          key: node.key,
          label: node.label,
          roleCode: node.roleCode,
          asset: null,
          memberCount: 0,
          activeAlarms: 0,
          topAlarm: null,
          statePoints: [],
          members: [],
        };
      }
      // `F4.307` (plan C5): an empty list shows the headline points; a list shows its keys in
      // its order, a fan-out member's too (plan Q4). Every requested pair has a row in (3); the
      // fallback only keeps the answer whole.
      const pointsOf = (assetId: string): GeneratedSitePointDto[] =>
        node.pointKeys.length === 0
          ? (pointsByAsset.get(assetId) ?? [])
          : node.pointKeys.map(
              (pointKey) =>
                listedByAsset.get(assetId)?.get(pointKey) ?? { pointKey, name: null, unit: null, headlineRank: null, latest: null },
            );
      const memberOf = (row: MemberRow): MimicNodeMemberDto => {
        const statePoints = statePointsByAsset.get(row.asset_id) ?? [];
        return {
          asset: assetOf(row, pointsOf(row.asset_id), statePoints, nowMs, pointsByAsset.get(row.asset_id) ?? []),
          activeAlarms: Number(row.active_alarms),
          topAlarm: topAlarmOf(row),
          statePoints,
        };
      };
      const shown = memberOf(first);
      if (!node.fanOut) {
        return {
          key: node.key,
          label: node.label,
          roleCode: node.roleCode,
          asset: shown.asset,
          memberCount: Number(first.member_count),
          activeAlarms: shown.activeAlarms,
          topAlarm: shown.topAlarm,
          statePoints: shown.statePoints,
          members: [],
        };
      }
      const fanned = rows.map(memberOf);
      return {
        key: node.key,
        label: node.label,
        roleCode: node.roleCode,
        asset: shown.asset,
        memberCount: Number(first.member_count),
        activeAlarms: fanned.reduce((sum, member) => sum + member.activeAlarms, 0),
        topAlarm: worstTopAlarm(rows),
        statePoints: shown.statePoints,
        members: fanned,
      };
    };

    return {
      stateMaps,
      widgets: widgets.map((widget) => {
        if (widget.source === "preset") {
          return {
            source: "preset" as const,
            widgetId: widget.widgetId,
            preset: widget.preset,
            nodes: nodesOf(widget).map((node) => resolveNode(widget.groupId, node)),
          };
        }
        // Present: `widgets` kept only the layout widgets whose layout (1b) found.
        const layout = layouts.get(widget.layoutId) as MimicLayoutGeometryDto;
        return {
          source: "layout" as const,
          widgetId: widget.widgetId,
          layoutId: widget.layoutId,
          layout,
          // A passive unit (no role, plan D6), a panel and a label are drawn from `layout`
          // alone; only a roled unit has a member to resolve.
          nodes: roledUnits(layout).map((node) => resolveNode(widget.groupId, node)),
        };
      }),
    };
  }

  /**
   * Statements (1b) and (1c) (`F3.32c`, plan D9): the named layouts THIS organization holds, as
   * geometry keyed by layout id. Every table is filtered on `organization_id` — `FLEET_POOL`
   * bypasses RLS, so these predicates are the isolation (ADR 0043 Amendment 3). Nodes in the
   * table's index order (`z, y, x`, then `key` so a tie is stable); pipes by their ends' keys.
   */
  private async readLayouts(
    organizationId: string,
    layoutIds: readonly string[],
  ): Promise<Map<string, MimicLayoutGeometryDto>> {
    const nodeRows = await this.pool.query<LayoutNodeRow>(
      `
      SELECT l.id AS layout_id, l.name, l.canvas_w, l.canvas_h,
             n.key, n.kind, n.symbol, n.org_symbol_key, n.label, n.role_code, n.tone, n.x, n.y, n.w, n.h, n.z,
             n.fan_out, n.is_source, n.is_switching,
             (SELECT coalesce(array_agg(np.point_key ORDER BY np.ord), '{}')
                FROM bms.mimic_layout_node_points np
               WHERE np.node_id = n.id AND np.organization_id = $2) AS point_keys
      FROM bms.mimic_layouts l
      LEFT JOIN bms.mimic_layout_nodes n
        ON n.layout_id = l.id
       AND n.organization_id = $2
      WHERE l.id = ANY($1::uuid[]) AND l.organization_id = $2
      ORDER BY l.id, n.z, n.y, n.x, n.key
      `,
      [layoutIds, organizationId],
    );
    const layouts = new Map<string, MimicLayoutGeometryDto>();
    for (const row of nodeRows.rows) {
      let layout = layouts.get(row.layout_id);
      if (layout === undefined) {
        layout = {
          name: row.name,
          canvasW: Number(row.canvas_w),
          canvasH: Number(row.canvas_h),
          nodes: [],
          pipes: [],
          orgSymbols: [],
        };
        layouts.set(row.layout_id, layout);
      }
      const node = layoutNodeOf(row);
      if (node !== null) {
        layout.nodes.push(node);
      }
    }
    if (layouts.size === 0) {
      return layouts;
    }

    const pipeRows = await this.pool.query<LayoutPipeRow>(
      `
      SELECT p.layout_id, f.key AS from_key, t.key AS to_key
      FROM bms.mimic_layout_pipes p
      INNER JOIN bms.mimic_layout_nodes f
        ON f.id = p.from_node_id AND f.layout_id = p.layout_id AND f.organization_id = $2
      INNER JOIN bms.mimic_layout_nodes t
        ON t.id = p.to_node_id AND t.layout_id = p.layout_id AND t.organization_id = $2
      WHERE p.layout_id = ANY($1::uuid[]) AND p.organization_id = $2
      ORDER BY p.layout_id, f.key, t.key
      `,
      [[...layouts.keys()], organizationId],
    );
    for (const row of pipeRows.rows) {
      layouts.get(row.layout_id)?.pipes.push({ fromKey: row.from_key, toKey: row.to_key });
    }

    // Statement (1d) (`F3.32f` slice 3, ADR 0086 decision 7): the organization symbols the units
    // draw, retired ones included, so a published dashboard never draws the fallback for an
    // uploaded symbol. Only when a unit names one, so a layout of global symbols keeps its two
    // statements. Every table carries `organization_id = $2` — the fleet pool bypasses RLS — and
    // each row is re-checked by the response contract (`orgSymbolsOf`).
    if (nodeRows.rows.some((row) => row.org_symbol_key !== null)) {
      const symbolRows = await this.pool.query<LayoutOrgSymbolRow>(
        `
        SELECT un.layout_id, s.id, s.library_id, s.key, s.label, s.group_code, sl.style,
               s.view_box, s.shapes, s.active, s.source_filename, s.sha256, s.updated_at
        FROM (
          SELECT DISTINCT un.layout_id, un.org_symbol_key
          FROM bms.mimic_layout_nodes un
          WHERE un.layout_id = ANY($1::uuid[]) AND un.organization_id = $2 AND un.org_symbol_key IS NOT NULL
        ) un
        INNER JOIN bms.mimic_org_symbols s
          ON s.key = un.org_symbol_key AND s.organization_id = $2
        INNER JOIN bms.mimic_org_symbol_libraries sl
          ON sl.id = s.library_id AND sl.organization_id = $2
        ORDER BY un.layout_id, s.key
        `,
        [[...layouts.keys()], organizationId],
      );
      const byLayout = new Map<string, OrgSymbolRow[]>();
      for (const row of symbolRows.rows) {
        const list = byLayout.get(row.layout_id) ?? [];
        list.push({
          id: row.id,
          libraryId: row.library_id,
          key: row.key,
          label: row.label,
          groupCode: row.group_code,
          style: row.style,
          viewBox: row.view_box,
          shapes: row.shapes,
          active: row.active,
          sourceFilename: row.source_filename,
          sha256: row.sha256,
          updatedAt: row.updated_at,
        });
        byLayout.set(row.layout_id, list);
      }
      for (const [layoutId, rows] of byLayout) {
        const layout = layouts.get(layoutId);
        if (layout !== undefined) {
          layout.orgSymbols = orgSymbolsOf(rows, (message) => this.logger.warn(message));
        }
      }
    }
    return layouts;
  }
}
