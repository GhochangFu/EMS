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
 * **The read.** At most three statements on `FLEET_POOL` (ADR 0043 Amendment 3: the `WHERE` is
 * the isolation control, so every statement names the organization explicitly):
 *
 * 1. The dashboard's `asset_group_id`, left-joined to its mimic widgets. A widget whose stored
 *    config no longer parses is skipped with one warning (field paths only), never thrown. No
 *    parsable mimic widget → `widgets: []`; no group → every node unassigned. Both end here.
 * 2. Per role the presets name, the first readable member by asset code, how many readable
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

    const widgets: { widgetId: string; preset: MimicPreset }[] = [];
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
      widgets.push({ widgetId: row.widget_id, preset: parsed.data.preset });
    }
    if (widgets.length === 0) {
      return { dashboardId, resolvedAt, widgets: [] };
    }

    const groupId = widgetRows.rows[0]?.asset_group_id ?? null;
    const roleCodes = [
      ...new Set(widgets.flatMap((widget) => MIMIC_PRESETS[widget.preset].nodes.map((node) => node.roleCode))),
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

    return {
      dashboardId,
      resolvedAt,
      widgets: widgets.map(({ widgetId, preset }) => ({
        widgetId,
        preset,
        nodes: MIMIC_PRESETS[preset].nodes.map((node): MimicNodeDto => {
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
        }),
      })),
    };
  }
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
