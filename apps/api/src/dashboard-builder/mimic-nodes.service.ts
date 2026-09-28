import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import type { Pool } from "pg";

import { dashboards } from "@bms/db";
import type { BmsDb } from "@bms/db";
import {
  MIMIC_HEADLINE_POINTS,
  MIMIC_PRESETS,
  mimicConfigSchema,
  type DashboardMimicNodesResponseDto,
  type GeneratedSiteAssetDto,
  type GeneratedSitePointDto,
  type JwtPayload,
  type MimicLayoutGeometryDto,
  type MimicLayoutNodeDto,
  type MimicNodeAlarmDto,
  type MimicNodeDto,
  type MimicPreset,
} from "@bms/shared";

import { AccessControlService } from "../auth/access-control.service";
// A namespace import, so the window constant's name appears in this file once: at the one
// place it is interpolated (`tests/f3.32-mimic-widget.test.ts` counts it in the raw text).
import * as generatedSiteView from "../control-room/generated-site-view.service";
import { FLEET_DRIZZLE, FLEET_POOL } from "../database/database.tokens";
import { telemetryFreshnessAt } from "../telemetry/telemetry-freshness";

/** Statement (1)'s row: the dashboard's group, and one of its mimic widgets (or none). */
interface WidgetRow {
  asset_group_id: string | null;
  widget_id: string | null;
  config: unknown;
}

/**
 * Statement (1b)'s row (`F3.32c`): one layout, left-joined to one of its nodes (all node columns
 * `null` for a layout with no node). `kind`, `symbol` and `tone` are closed by the table's CHECKs.
 */
interface LayoutNodeRow {
  layout_id: string;
  name: string;
  canvas_w: number;
  canvas_h: number;
  key: string | null;
  kind: string | null;
  symbol: string | null;
  label: string | null;
  role_code: string | null;
  tone: string | null;
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
  z: number | null;
}

/** Statement (1c)'s row (`F3.32c`): one pipe of a layout, by its two ends' keys. */
interface LayoutPipeRow {
  layout_id: string;
  from_key: string;
  to_key: string;
}

/** A parsed mimic widget of statement (1), either arm, in statement (1)'s grid order. */
type ParsedWidget =
  | { source: "preset"; widgetId: string; preset: MimicPreset }
  | { source: "layout"; widgetId: string; layoutId: string };

/** Statement (2)'s row: the first readable member carrying one role, by asset code, and its top alarm. */
interface MemberRow {
  role: string;
  asset_id: string;
  asset_code: string;
  asset_name: string;
  domain: string;
  member_count: number;
  active_alarms: number;
  /**
   * The shown asset's most severe open alarm (`F3.32b`), with its severity's vocabulary tone and
   * label; all five `null` when it has none.
   */
  top_alarm_severity: string | null;
  top_alarm_tone: string | null;
  top_alarm_label: string | null;
  top_alarm_message: string | null;
  top_alarm_raised_at: Date | string | null;
}

/** Statement (3)'s row: one of a shown asset's top points, with its latest sample. */
interface PointRow {
  asset_id: string;
  point_key: string;
  name: string | null;
  unit: string | null;
  headline_rank: number | null;
  value: number | null;
  time: Date | string | null;
}

/**
 * `F3.32` / ADR 0079 — `GET /api/v1/dashboards/:id/mimic-nodes` (plan D1, U2): every `mimic`
 * widget on one dashboard, each preset node resolved AT READ TIME to the member of the
 * dashboard's asset group that carries the node's `bms.asset_roles` code.
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
 * layout (`F3.32c` plan D9), all on `FLEET_POOL` (ADR 0043 Amendment 3: the `WHERE` is the
 * isolation control, so every statement names the organization explicitly):
 *
 * 1. The dashboard's `asset_group_id`, left-joined to its mimic widgets. A widget whose stored
 *    config no longer parses is skipped with one warning (field paths only), never thrown. No
 *    parsable mimic widget → `widgets: []`; no group → every node unassigned. Both end here.
 *    1b. Only when a widget takes the layout arm (ADR 0081 decision 6): those layouts of THIS
 *    organization, each left-joined to its nodes. A layout id with no row here — deleted, or
 *    another organization's — skips its widget with one warning (ids only), never thrown.
 *    1c. Only when (1b) found a layout: their pipes, each end named by its node's key.
 * 2. Per role the presets and the layouts' roled units name, the first readable member by
 *    asset code, how many readable
 *    members carry the role, and the shown asset's open-alarm count (`cleared_at IS NULL`,
 *    ADR 0057 decision 1). `F3.32b` (ADR 0079 Amendment 2 item 3) folds the shown asset's most
 *    severe open alarm into the same statement as a lateral: `bms.alarm_severities.rank DESC`
 *    (a higher rank is more severe, ADR 0032), then `raised_at DESC`, then `id` so a tie is
 *    stable. The same join answers the severity's `tone` and `label`, so the widget draws a
 *    level from its vocabulary row, never from a list of codes (ADR 0032 decision 9). Its
 *    `message` is the stored text the Alarm Centre already shows; it is never logged.
 * 3. Each shown asset's top `MIMIC_HEADLINE_POINTS` active points, ordered by F3.68's rule
 *    (`headline_rank ASC NULLS LAST, point_key ASC`), the limit applied PER ASSET inside a
 *    lateral, each point's newest sample found by F3.68's bounded literal-window lateral —
 *    never a bound `now() - $n`, which plans every hypertable chunk.
 *
 * **Rows are mapped by hand** — no `.parse` of stored data beyond the widget config.
 */
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
      SELECT d.asset_group_id, w.id AS widget_id, w.config
      FROM bms.dashboards d
      LEFT JOIN bms.dashboard_widgets w
        ON w.dashboard_id = d.id
       AND w.organization_id = d.organization_id
       AND w.widget_type = 'mimic'
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
      parsedWidgets.push({ widgetId: row.widget_id, ...parsed.data });
    }

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
            `dashboard ${dashboardId}, widget ${widget.widgetId}, layout ${widget.layoutId}`,
        );
        continue;
      }
      widgets.push(widget);
    }
    if (widgets.length === 0) {
      return { dashboardId, resolvedAt, widgets: [] };
    }

    const groupId = widgetRows.rows[0]?.asset_group_id ?? null;
    const roleCodes = [
      ...new Set(
        widgets.flatMap((widget) =>
          widget.source === "preset"
            ? MIMIC_PRESETS[widget.preset].nodes.map((node) => node.roleCode)
            : roledUnits(layouts.get(widget.layoutId)).map((node) => node.roleCode),
        ),
      ),
    ];
    const members = new Map<string, MemberRow>();
    const pointsByAsset = new Map<string, GeneratedSitePointDto[]>();

    if (groupId !== null && (readableAssetIds === null || readableAssetIds.length > 0)) {
      const memberRows = await this.pool.query<MemberRow>(
        `
        SELECT DISTINCT ON (agm.role)
          agm.role,
          a.id AS asset_id,
          a.code AS asset_code,
          a.name AS asset_name,
          a.domain,
          (count(*) OVER (PARTITION BY agm.role))::int AS member_count,
          (
            SELECT count(*)::int
            FROM bms.alarms al
            WHERE al.asset_id = a.id
              AND al.organization_id = $2
              AND al.cleared_at IS NULL
          ) AS active_alarms,
          ta.severity AS top_alarm_severity,
          ta.tone AS top_alarm_tone,
          ta.label AS top_alarm_label,
          ta.message AS top_alarm_message,
          ta.raised_at AS top_alarm_raised_at
        FROM bms.asset_group_members agm
        INNER JOIN bms.asset_groups ag
          ON ag.id = agm.asset_group_id AND ag.organization_id = $2
        INNER JOIN bms.assets a
          ON a.id = agm.asset_id AND a.organization_id = $2
        LEFT JOIN LATERAL (
          SELECT al.severity, s.tone, s.label, al.message, al.raised_at
          FROM bms.alarms al
          INNER JOIN bms.alarm_severities s ON s.code = al.severity
          WHERE al.asset_id = a.id
            AND al.organization_id = $2
            AND al.cleared_at IS NULL
          ORDER BY s.rank DESC, al.raised_at DESC, al.id ASC
          LIMIT 1
        ) ta ON true
        WHERE agm.asset_group_id = $1
          AND agm.role = ANY($3::text[])
          AND ($4::uuid[] IS NULL OR a.id = ANY($4::uuid[]))
        ORDER BY agm.role, a.code ASC
        `,
        [groupId, organizationId, roleCodes, readableAssetIds],
      );
      for (const row of memberRows.rows) {
        members.set(row.role, row);
      }

      const shownIds = [...new Set([...members.values()].map((member) => member.asset_id))];
      if (shownIds.length > 0) {
        const pointRows = await this.pool.query<PointRow>(
          `
          SELECT
            sa.id AS asset_id,
            top.point_key,
            top.name,
            top.unit,
            top.headline_rank,
            top.value,
            top.time
          FROM unnest($1::uuid[]) AS sa(id)
          CROSS JOIN LATERAL (
            SELECT
              ranked.point_key,
              ranked.name,
              ranked.unit,
              ranked.headline_rank,
              lt.value,
              lt.time
            FROM (
              SELECT ap.point_key, pk.name, COALESCE(ap.unit, pk.unit) AS unit, pk.headline_rank
              FROM bms.asset_points ap
              LEFT JOIN bms.point_keys pk ON pk.code = ap.point_key
              WHERE ap.asset_id = sa.id
                AND ap.organization_id = $2
                AND ap.active = true
              ORDER BY pk.headline_rank ASC NULLS LAST, ap.point_key ASC
              LIMIT ${MIMIC_HEADLINE_POINTS}
            ) ranked
            LEFT JOIN LATERAL (
              SELECT pv.value, pv.time
              FROM telemetry.point_values pv
              WHERE pv.asset_id = sa.id
                AND pv.point_key = ranked.point_key
                AND pv.time > now() - ${generatedSiteView.GENERATED_LATEST_WINDOW_SQL}
              ORDER BY pv.time DESC
              LIMIT 1
            ) lt ON true
          ) top
          ORDER BY sa.id, top.headline_rank ASC NULLS LAST, top.point_key ASC
          `,
          [shownIds, organizationId],
        );
        for (const row of pointRows.rows) {
          const time = toIsoString(row.time);
          const list = pointsByAsset.get(row.asset_id) ?? [];
          list.push({
            pointKey: row.point_key,
            name: row.name,
            unit: row.unit,
            headlineRank: row.headline_rank === null ? null : Number(row.headline_rank),
            latest: time !== null && row.value !== null ? { value: Number(row.value), time } : null,
          });
          pointsByAsset.set(row.asset_id, list);
        }
      }
    }

    // One resolution for both arms (ADR 0081 decision 6): a layout's unit resolves exactly as a
    // preset node does, by its role code against the group's members.
    const resolveNode = (node: { key: string; label: string; roleCode: string }): MimicNodeDto => {
      const member = members.get(node.roleCode);
      return {
        key: node.key,
        label: node.label,
        roleCode: node.roleCode,
        asset: member === undefined ? null : assetOf(member, pointsByAsset.get(member.asset_id) ?? [], nowMs),
        memberCount: member === undefined ? 0 : Number(member.member_count),
        activeAlarms: member === undefined ? 0 : Number(member.active_alarms),
        topAlarm: member === undefined ? null : topAlarmOf(member),
      };
    };

    return {
      dashboardId,
      resolvedAt,
      widgets: widgets.map((widget) => {
        if (widget.source === "preset") {
          return {
            source: "preset" as const,
            widgetId: widget.widgetId,
            preset: widget.preset,
            nodes: MIMIC_PRESETS[widget.preset].nodes.map(resolveNode),
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
          nodes: roledUnits(layout).map(resolveNode),
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
             n.key, n.kind, n.symbol, n.label, n.role_code, n.tone, n.x, n.y, n.w, n.h, n.z
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
        layout = { name: row.name, canvasW: Number(row.canvas_w), canvasH: Number(row.canvas_h), nodes: [], pipes: [] };
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
    return layouts;
  }
}

/** A layout's units that carry a role, in the layout's node order — the nodes a read resolves. */
function roledUnits(
  layout: MimicLayoutGeometryDto | undefined,
): { key: string; label: string; roleCode: string }[] {
  return (layout?.nodes ?? []).flatMap((node) =>
    node.kind === "unit" && node.roleCode !== null
      ? [{ key: node.key, label: node.label, roleCode: node.roleCode }]
      : [],
  );
}

/**
 * One (1b) row as a geometry node, or `null` for the all-`null` half of a node-less layout's
 * LEFT JOIN. The casts restate the table's `_kind_check`, `_symbol_check` and `_tone_check`.
 */
function layoutNodeOf(row: LayoutNodeRow): MimicLayoutNodeDto | null {
  if (row.key === null || row.kind === null || row.label === null) {
    return null;
  }
  return {
    key: row.key,
    kind: row.kind as MimicLayoutNodeDto["kind"],
    symbol: row.symbol as MimicLayoutNodeDto["symbol"],
    label: row.label,
    roleCode: row.role_code,
    tone: row.tone as MimicLayoutNodeDto["tone"],
    x: Number(row.x),
    y: Number(row.y),
    w: Number(row.w),
    h: Number(row.h),
    z: Number(row.z),
  };
}

/** A shown member as F3.68's asset shape: freshness from its newest shown point's sample. */
function assetOf(member: MemberRow, points: GeneratedSitePointDto[], nowMs: number): GeneratedSiteAssetDto {
  let latestTelemetryAt: string | null = null;
  for (const point of points) {
    if (point.latest !== null && (latestTelemetryAt === null || Date.parse(point.latest.time) > Date.parse(latestTelemetryAt))) {
      latestTelemetryAt = point.latest.time;
    }
  }
  return {
    id: member.asset_id,
    code: member.asset_code,
    name: member.asset_name,
    domain: member.domain,
    latestTelemetryAt,
    freshness: telemetryFreshnessAt(latestTelemetryAt, nowMs),
    points,
  };
}

/**
 * The member's top alarm, or `null` when the lateral found none (or its row is incomplete). The
 * tone is `alarm_severities_tone_check`'s closed set, so the cast restates the SQL `CHECK`.
 */
function topAlarmOf(member: MemberRow): MimicNodeAlarmDto | null {
  const raisedAt = toIsoString(member.top_alarm_raised_at);
  if (
    member.top_alarm_severity === null ||
    member.top_alarm_tone === null ||
    member.top_alarm_label === null ||
    member.top_alarm_message === null ||
    raisedAt === null
  ) {
    return null;
  }
  return {
    severity: member.top_alarm_severity,
    tone: member.top_alarm_tone as MimicNodeAlarmDto["tone"],
    label: member.top_alarm_label,
    message: member.top_alarm_message,
    raisedAt,
  };
}

function toIsoString(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
