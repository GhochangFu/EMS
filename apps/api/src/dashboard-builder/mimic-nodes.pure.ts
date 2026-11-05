import {
  MIMIC_PRESETS,
  type GeneratedSiteAssetDto,
  type GeneratedSitePointDto,
  type MimicLayoutGeometryDto,
  type MimicLayoutNodeDto,
  type MimicNodeAlarmDto,
  type MimicPreset,
  type MimicPresetNode,
  type PointKeyStateMapDto,
} from "@bms/shared";

import { telemetryFreshnessAt } from "../telemetry/telemetry-freshness";

// ---------------------------------------------------------------------------
// `F4.308` (plan C6) — the mimic resolver's row shapes and SQL-free helpers, moved out of
// `mimic-nodes.service.ts` unchanged (the `dashboards.pure.ts` precedent). Every SQL string stays
// in the service, so `tests/f3.32-mimic-widget.test.ts` reads one file.
// ---------------------------------------------------------------------------

/**
 * Statement (1)'s row: one of the dashboard's mimic widgets (or none), with the group it
 * resolves against — its tab's group, else the dashboard's (`F3.73` plan D3).
 */
export interface WidgetRow {
  asset_group_id: string | null;
  widget_id: string | null;
  config: unknown;
}

/**
 * Statement (1b)'s row (`F3.32c`): one layout, left-joined to one of its nodes (all node columns
 * `null` for a layout with no node). `kind` and `tone` are closed by the table's CHECKs, `symbol` by
 * `mimic_layout_nodes_symbol_fkey` to `bms.mimic_symbols` (migration `0090`), `org_symbol_key` by
 * the composite `mimic_layout_nodes_org_symbol_fkey` (migration `0093`); a unit has one of the two.
 */
export interface LayoutNodeRow {
  layout_id: string;
  name: string;
  canvas_w: number;
  canvas_h: number;
  key: string | null;
  kind: string | null;
  symbol: string | null;
  org_symbol_key: string | null;
  label: string | null;
  role_code: string | null;
  tone: string | null;
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
  z: number | null;
  /** `F3.74` (0097): `NOT NULL DEFAULT false`, `null` only on a node-less layout's row. */
  fan_out: boolean | null;
  is_source: boolean | null;
  is_switching: boolean | null;
  /**
   * `F4.307` (plan C2): the unit's listed point keys by `ord`, `{}` when it lists none — and on a
   * node-less layout's row, which `layoutNodeOf` drops.
   */
  point_keys: string[] | null;
}

/** Statement (1d)'s row (`F3.32f` slice 3): one organization symbol a layout's units draw. */
export interface LayoutOrgSymbolRow {
  layout_id: string;
  id: string;
  library_id: string;
  key: string;
  label: string;
  group_code: string;
  style: string;
  view_box: number[];
  shapes: unknown;
  active: boolean;
  source_filename: string;
  sha256: string;
  updated_at: Date | string;
}

/** Statement (1c)'s row (`F3.32c`): one pipe of a layout, by its two ends' keys. */
export interface LayoutPipeRow {
  layout_id: string;
  from_key: string;
  to_key: string;
}

/**
 * A parsed mimic widget of statement (1), either arm, in statement (1)'s grid order, with the
 * group its nodes resolve against (`null`: every node unassigned).
 */
export type ParsedWidget = { groupId: string | null } & (
  | { source: "preset"; widgetId: string; preset: MimicPreset }
  | { source: "layout"; widgetId: string; layoutId: string }
);

/**
 * Statement (2)'s row: per group and role, a readable member carrying the role — the first by
 * asset code, and for a fan-out role every one up to `MIMIC_FANOUT_MAX` (`F3.74` plan D4) — with
 * its top alarm.
 */
export interface MemberRow {
  asset_group_id: string;
  role: string;
  /** 1-based position among the role's readable members, by asset code. */
  rn: number;
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
  /**
   * The top alarm's `bms.alarm_severities.rank` (`F3.74`): how a fan-out node picks the worst
   * alarm across its members. Never answered — it is not on `mimicNodeAlarmSchema`.
   */
  top_alarm_rank: number | null;
}

/**
 * Statement (3)'s row: one of a shown asset's top points, (`F3.74` plan D4) one of its state
 * points, or (`F4.307` plan C3) one key a unit lists for it, with its latest sample. A key on two
 * arms is one row per arm.
 */
export interface PointRow {
  asset_id: string;
  point_key: string;
  name: string | null;
  unit: string | null;
  headline_rank: number | null;
  /** `true`: a state point (an active key with a `bms.point_key_states` row). */
  is_state: boolean;
  /** `true`: a listed key (`F4.307`); `latest` is `null` unless the asset holds it active. */
  is_listed: boolean;
  value: number | null;
  time: Date | string | null;
}

/** Statement (4)'s row (`F3.74` plan D4): one `bms.point_key_states` row of a key seen in (3). */
export interface StateMapRow {
  point_key_code: string;
  value: number;
  label: string;
  tone: string;
}


/**
 * One node a read resolves, either arm: its key, label, role, whether it fans out (`F3.74`) and
 * (`F4.307`) its listed point keys — `[]` on a preset node and on a unit that lists none.
 */
export interface ResolvableNode {
  key: string;
  label: string;
  roleCode: string;
  fanOut: boolean;
  pointKeys: readonly string[];
}

/**
 * A preset's nodes that carry a role, in the preset's order (`F3.74` OQ8: a `roleCode: null` bus
 * is drawn by the web from the preset alone and is absent from `nodes`, as a passive layout unit
 * is), each with its `fanOut` flag.
 */
export function presetRoledNodes(preset: MimicPreset): ResolvableNode[] {
  const nodes: readonly MimicPresetNode[] = MIMIC_PRESETS[preset].nodes;
  return nodes.flatMap((node) =>
    node.roleCode === null
      ? []
      : [{ key: node.key, label: node.label, roleCode: node.roleCode, fanOut: node.fanOut === true, pointKeys: [] }],
  );
}

/**
 * A layout's units that carry a role, in the layout's node order — the nodes a read resolves —
 * each with its stored `fan_out` (`F3.74` plan D3b), so a layout unit fans out exactly as a
 * preset node does (ADR 0081 decision 6).
 */
export function roledUnits(layout: MimicLayoutGeometryDto | undefined): ResolvableNode[] {
  return (layout?.nodes ?? []).flatMap((node) =>
    node.kind === "unit" && node.roleCode !== null
      ? [{ key: node.key, label: node.label, roleCode: node.roleCode, fanOut: node.fanOut, pointKeys: node.pointKeys }]
      : [],
  );
}

/**
 * `F4.307` (plan C4): the `(asset, key, ord)` triples statement (3)'s listed arm reads, as three
 * parallel arrays — per roled unit with a list, its shown member, or every fanned member — once
 * per `(asset, key)`.
 */
export function listedPairs(
  widgets: readonly ParsedWidget[],
  nodesOf: (widget: ParsedWidget) => ResolvableNode[],
  members: ReadonlyMap<string, ReadonlyMap<string, readonly MemberRow[]>>,
): { assetIds: string[]; pointKeys: string[]; ords: number[] } {
  const pairs = { assetIds: [] as string[], pointKeys: [] as string[], ords: [] as number[] };
  const seen = new Set<string>();
  for (const widget of widgets) {
    if (widget.groupId === null) continue;
    for (const node of nodesOf(widget)) {
      const rows = members.get(widget.groupId)?.get(node.roleCode) ?? [];
      for (const row of node.fanOut ? rows : rows.slice(0, 1)) {
        for (const [ord, pointKey] of node.pointKeys.entries()) {
          if (seen.has(`${row.asset_id} ${pointKey}`)) continue;
          seen.add(`${row.asset_id} ${pointKey}`);
          pairs.assetIds.push(row.asset_id);
          pairs.pointKeys.push(pointKey);
          pairs.ords.push(ord);
        }
      }
    }
  }
  return pairs;
}

/**
 * One (1b) row as a geometry node, or `null` for the all-`null` half of a node-less layout's
 * LEFT JOIN. The casts restate the table's `_kind_check` and `_tone_check`, and its
 * `mimic_layout_nodes_symbol_fkey` to `bms.mimic_symbols` (migration `0090`).
 */
export function layoutNodeOf(row: LayoutNodeRow): MimicLayoutNodeDto | null {
  if (row.key === null || row.kind === null || row.label === null) {
    return null;
  }
  return {
    key: row.key,
    kind: row.kind as MimicLayoutNodeDto["kind"],
    symbol: (row.symbol ?? row.org_symbol_key) as MimicLayoutNodeDto["symbol"],
    label: row.label,
    roleCode: row.role_code,
    tone: row.tone as MimicLayoutNodeDto["tone"],
    x: Number(row.x),
    y: Number(row.y),
    w: Number(row.w),
    h: Number(row.h),
    z: Number(row.z),
    // `F3.74` (0097): both columns are `NOT NULL DEFAULT false`; the guard above already left
    // out the all-`null` row of a node-less layout.
    fanOut: row.fan_out === true,
    isSource: row.is_source === true,
    isSwitching: row.is_switching === true,
    // `F4.307` (plan C2): the stored list; `resolveNode` reads it per node (plan C5).
    pointKeys: row.point_keys ?? [],
  };
}

/**
 * A shown member as F3.68's asset shape: freshness from the newest sample among its shown points,
 * (`F3.74` plan D4) its state points — a breaker reporting only its state is live — and
 * (`F4.307`) `liveness`, the asset's headline points: a unit listing only keys the asset lacks is
 * still as fresh as its asset. `liveness` never joins `points`.
 */
export function assetOf(
  member: MemberRow,
  points: GeneratedSitePointDto[],
  statePoints: GeneratedSitePointDto[],
  nowMs: number,
  liveness: readonly GeneratedSitePointDto[] = [],
): GeneratedSiteAssetDto {
  let latestTelemetryAt: string | null = null;
  for (const point of [...points, ...statePoints, ...liveness]) {
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
export function topAlarmOf(member: MemberRow): MimicNodeAlarmDto | null {
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
 * A fan-out node's top alarm (`F3.74` plan D4): the most severe across its members by the
 * severity's rank, then the newest; a tie keeps the member that comes first by code.
 */
export function worstTopAlarm(rows: readonly MemberRow[]): MimicNodeAlarmDto | null {
  let worst: { row: MemberRow; alarm: MimicNodeAlarmDto } | null = null;
  for (const row of rows) {
    const alarm = topAlarmOf(row);
    if (alarm === null) continue;
    if (
      worst === null ||
      Number(row.top_alarm_rank) > Number(worst.row.top_alarm_rank) ||
      (Number(row.top_alarm_rank) === Number(worst.row.top_alarm_rank) &&
        Date.parse(alarm.raisedAt) > Date.parse(worst.alarm.raisedAt))
    ) {
      worst = { row, alarm };
    }
  }
  return worst === null ? null : worst.alarm;
}

/**
 * Statement (4)'s rows as one map per key, in key then value order. The tone is
 * `point_key_states_tone_check`'s closed set (0097), so the cast restates the SQL `CHECK`.
 */
export function stateMapsOf(rows: readonly StateMapRow[]): PointKeyStateMapDto[] {
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

export function toIsoString(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
