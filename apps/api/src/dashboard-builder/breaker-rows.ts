import { sql } from "drizzle-orm";

import {
  BREAKER_ROLE_CODES,
  BREAKER_TABLE_POINT_KEYS,
  MAX_SITE_BREAKER_ROWS,
  type BreakerRow,
  type GeneratedSitePointDto,
  type MimicNodeAlarmDto,
  type PointKeyStateMapDto,
} from "@bms/shared";

// A namespace import, so the window constant's name appears in this file once: at the one
// interpolation (the `mimic-nodes.service.ts` idiom).
import * as generatedSiteView from "../control-room/generated-site-view.service";
import type { BmsTx } from "../database/tenant-context";
import { telemetryFreshnessAt } from "../telemetry/telemetry-freshness";

/** What the site-widgets read adds for the `breaker_table` widget (`F3.74`, plan D8). */
export interface BreakerRowsResult {
  readonly breakers: BreakerRow[];
  readonly stateMaps: PointKeyStateMapDto[];
}

/** Statement (1)'s row: one breaker member with its role and its alarms. */
interface MemberRow extends Record<string, unknown> {
  asset_id: string;
  asset_code: string;
  asset_name: string;
  domain: string;
  rating: string | null;
  trip_cause: string | null;
  role: string;
  role_label: string;
  active_alarms: number;
  top_alarm_severity: string | null;
  top_alarm_tone: string | null;
  top_alarm_label: string | null;
  top_alarm_message: string | null;
  top_alarm_raised_at: Date | string | null;
}

/** Statement (2)'s row: one point of one member, with its newest sample in the window. */
interface PointRow extends Record<string, unknown> {
  asset_id: string;
  point_key: string;
  name: string | null;
  unit: string | null;
  headline_rank: number | null;
  is_state: boolean;
  value: number | string | null;
  time: Date | string | null;
}

/** Statement (3)'s row: one state-map entry. */
interface StateMapRow extends Record<string, unknown> {
  point_key_code: string;
  value: number | string;
  label: string;
  tone: string;
}

const EMPTY: BreakerRowsResult = { breakers: [], stateMaps: [] };

/**
 * `F3.74` (plan D8, ADR 0088 decision 10) — the breaker rows of the read's bound group (the tab's,
 * else the dashboard's own, once the caller may read it — `SiteWidgetsService.read`), on the caller's
 * tenant transaction (`SiteWidgetsService.read`'s `withTenant`).
 *
 * `assetIds` is the read's scope already narrowed to what the caller may read and to active assets
 * (`activeAssetIds`); it is bound as ONE `uuid[]` parameter and matched with `ANY`, so an asset
 * outside it is never a row. `groupId = null` (a group-less tab of a location, organization or
 * asset dashboard, or a group the caller may not read) or an empty scope answers `[]` without a
 * statement.
 *
 * Every `bms` table that carries `organization_id` is filtered on it, in its own statement:
 * `asset_groups`, `assets`, `asset_points`, `alarms`. The others are global vocabularies
 * (`asset_roles`, `point_keys`, `point_key_states`, `alarm_severities`) or have no tenant column
 * (`asset_group_members`, reached through its organization-filtered group and asset;
 * `telemetry.point_values`, reached through the organization-filtered asset ids).
 *
 * 1. The members of the five breaker roles (`BREAKER_ROLE_CODES`) in the group ∩ `assetIds`, by
 *    `asset_roles.sort_order` then asset code, each with its role's label, its `rating` and
 *    `trip_cause`, its open-alarm count (`cleared_at IS NULL`, ADR 0057 decision 1) and its most
 *    severe open alarm (`mimic-nodes.service.ts`' lateral: rank, then newest, then id). At most
 *    `MAX_SITE_BREAKER_ROWS` rows, the contract's `.max()` on `breakers`.
 * 2. Each member's ACTIVE registered points among `BREAKER_TABLE_POINT_KEYS`, plus every active
 *    key that has a `bms.point_key_states` row — selected by name and by the state table, never by
 *    headline rank (a top-three statement would drop `current_a` for any ranked key). Each point's
 *    newest sample comes from F3.68's bounded literal-window lateral, never a bound `now() - $n`.
 * 3. Only when (2) found a state point: the `bms.point_key_states` rows of the keys seen.
 */
export async function readBreakerRows(
  tx: BmsTx,
  organizationId: string,
  groupId: string | null,
  assetIds: readonly string[],
  nowMs: number,
): Promise<BreakerRowsResult> {
  if (groupId === null || assetIds.length === 0) {
    return EMPTY;
  }
  const ids = sql.param([...assetIds]);
  const members = await tx.execute<MemberRow>(sql`
    SELECT
      m.asset_id, m.asset_code, m.asset_name, m.domain, m.rating, m.trip_cause, m.role, m.role_label,
      (
        SELECT count(*)::int
        FROM bms.alarms al
        WHERE al.asset_id = m.asset_id
          AND al.organization_id = ${organizationId}
          AND al.cleared_at IS NULL
      ) AS active_alarms,
      ta.severity AS top_alarm_severity,
      ta.tone AS top_alarm_tone,
      ta.label AS top_alarm_label,
      ta.message AS top_alarm_message,
      ta.raised_at AS top_alarm_raised_at
    FROM (
      SELECT
        a.id AS asset_id, a.code AS asset_code, a.name AS asset_name, a.domain, a.rating, a.trip_cause,
        agm.role, ar.label AS role_label, ar.sort_order
      FROM bms.asset_group_members agm
      INNER JOIN bms.asset_groups ag
        ON ag.id = agm.asset_group_id AND ag.organization_id = ${organizationId}
      INNER JOIN bms.assets a
        ON a.id = agm.asset_id AND a.organization_id = ${organizationId}
      INNER JOIN bms.asset_roles ar ON ar.code = agm.role
      WHERE agm.asset_group_id = ${groupId}
        AND agm.role = ANY(${sql.param([...BREAKER_ROLE_CODES])}::text[])
        AND a.id = ANY(${ids}::uuid[])
    ) m
    LEFT JOIN LATERAL (
      SELECT al.severity, s.tone, s.label, al.message, al.raised_at
      FROM bms.alarms al
      INNER JOIN bms.alarm_severities s ON s.code = al.severity
      WHERE al.asset_id = m.asset_id
        AND al.organization_id = ${organizationId}
        AND al.cleared_at IS NULL
      ORDER BY s.rank DESC, al.raised_at DESC, al.id ASC
      LIMIT 1
    ) ta ON true
    ORDER BY m.sort_order ASC, m.asset_code ASC
    LIMIT ${MAX_SITE_BREAKER_ROWS}
  `);
  if (members.rows.length === 0) {
    return EMPTY;
  }

  const shownIds = members.rows.map((row) => row.asset_id);
  const points = await tx.execute<PointRow>(sql`
    SELECT
      sa.id AS asset_id,
      p.point_key,
      p.name,
      p.unit,
      p.headline_rank,
      p.is_state,
      lt.value,
      lt.time
    FROM unnest(${sql.param(shownIds)}::uuid[]) AS sa(id)
    CROSS JOIN LATERAL (
      SELECT
        ap.point_key,
        pk.name,
        COALESCE(ap.unit, pk.unit) AS unit,
        pk.headline_rank,
        EXISTS (SELECT 1 FROM bms.point_key_states pks WHERE pks.point_key_code = ap.point_key) AS is_state
      FROM bms.asset_points ap
      LEFT JOIN bms.point_keys pk ON pk.code = ap.point_key
      WHERE ap.asset_id = sa.id
        AND ap.organization_id = ${organizationId}
        AND ap.active = true
    ) p
    LEFT JOIN LATERAL (
      SELECT pv.value, pv.time
      FROM telemetry.point_values pv
      WHERE pv.asset_id = sa.id
        AND pv.point_key = p.point_key
        AND pv.time > now() - ${sql.raw(generatedSiteView.GENERATED_LATEST_WINDOW_SQL)}
      ORDER BY pv.time DESC
      LIMIT 1
    ) lt ON true
    WHERE p.point_key = ANY(${sql.param([...BREAKER_TABLE_POINT_KEYS])}::text[]) OR p.is_state
    ORDER BY sa.id, p.point_key ASC
  `);

  const pointsByAsset = new Map<string, GeneratedSitePointDto[]>();
  const stateKeys = new Set<string>();
  for (const row of points.rows) {
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
    if (row.is_state) {
      stateKeys.add(row.point_key);
    }
  }

  let stateMaps: PointKeyStateMapDto[] = [];
  if (stateKeys.size > 0) {
    // `bms.point_key_states` is global master data (0097, no `organization_id`): the key list is
    // the filter.
    const stateRows = await tx.execute<StateMapRow>(sql`
      SELECT pks.point_key_code, pks.value, pks.label, pks.tone
      FROM bms.point_key_states pks
      WHERE pks.point_key_code = ANY(${sql.param([...stateKeys])}::text[])
      ORDER BY pks.point_key_code, pks.value
    `);
    stateMaps = stateMapsOf(stateRows.rows);
  }

  return {
    breakers: members.rows.map((row) => breakerRowOf(row, pointsByAsset.get(row.asset_id) ?? [], nowMs)),
    stateMaps,
  };
}

/**
 * One member as the contract's row. `latestTelemetryAt` and `freshness` come from the newest sample
 * among the points statement (2) SELECTED — the table keys and the state keys — not from every
 * point the asset reports, so a breaker that reports only an unselected key reads `none`.
 */
function breakerRowOf(member: MemberRow, points: GeneratedSitePointDto[], nowMs: number): BreakerRow {
  let latestTelemetryAt: string | null = null;
  for (const point of points) {
    if (point.latest !== null && (latestTelemetryAt === null || Date.parse(point.latest.time) > Date.parse(latestTelemetryAt))) {
      latestTelemetryAt = point.latest.time;
    }
  }
  return {
    asset: {
      id: member.asset_id,
      code: member.asset_code,
      name: member.asset_name,
      domain: member.domain,
      latestTelemetryAt,
      freshness: telemetryFreshnessAt(latestTelemetryAt, nowMs),
      points,
    },
    roleCode: member.role,
    roleLabel: member.role_label,
    rating: member.rating,
    tripCause: member.trip_cause,
    activeAlarms: Number(member.active_alarms),
    topAlarm: topAlarmOf(member),
  };
}

/**
 * The member's top alarm, or `null` when the lateral found none. The tone is
 * `alarm_severities_tone_check`'s closed set, so the cast restates the SQL `CHECK`.
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

/**
 * Statement (3)'s rows as one map per key, in key then value order. The tone is
 * `point_key_states_tone_check`'s closed set (0097), so the cast restates the SQL `CHECK`.
 */
function stateMapsOf(rows: readonly StateMapRow[]): PointKeyStateMapDto[] {
  const byKey = new Map<string, PointKeyStateMapDto>();
  for (const row of rows) {
    const map = byKey.get(row.point_key_code) ?? { pointKey: row.point_key_code, states: [] };
    map.states.push({
      value: Number(row.value),
      label: row.label,
      tone: row.tone as PointKeyStateMapDto["states"][number]["tone"],
    });
    byKey.set(row.point_key_code, map);
  }
  return [...byKey.values()];
}

function toIsoString(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
