import { sql, type SQL } from "drizzle-orm";

import { locationAncestors } from "../auth/location-tree";
import type { BmsTx } from "../database/tenant-context";
import {
  ROOT_CAUSE_LINKED_ROW_CAP,
  ROOT_CAUSE_RECORDED_ROW_CAP,
  ROOT_CAUSE_RTU_COMMS_ROW_CAP,
  ROOT_CAUSE_WINDOW_ROW_CAP,
  type RootCauseAlarmRow,
  type RootCausePastRow,
  type RootCauseWindowRow,
} from "./alarm-root-cause.pure";

/**
 * `E2.3` / ADR 0136 decision 5 (plan `docs/plans/e2.3-root-cause-suggestions.md`
 * §6 T1.4) — the evidence SQL of the root-cause suggestions. Read-only.
 *
 * **Every function takes the `tx` it is handed and nothing else.** The service
 * hands the one `withTenant` transaction of the subject's organization (Q2), so
 * `bms_tenant`'s row security scopes every row read here — **and every `bms`
 * alias still carries its own `organization_id = $org` line**, so a call on the
 * BYPASSRLS fleet pool returns the same rows (`tests/e2.3-root-cause-containment.test.ts`
 * holds the text; the integration suite holds both controls).
 *
 * **Bounds.** Every statement is bounded by a time window and a row cap; the
 * subject read is by primary key. Every value is a bound parameter; times cross
 * as epoch milliseconds (`float8`); every output column is aliased.
 *
 * **Why `raisedMs` comes from SQL** ({@link readSubjectAsset}): `raised_at` holds
 * microseconds, and the details' ISO string only milliseconds. One rule sweep
 * stamps several alarms with one `now()` (R-f), so a `T` cut to the millisecond
 * would put a same-instant alarm *after* `T` — in this SQL and in the pure step's
 * re-check. The same `extract(epoch …) * 1000` expression on both sides makes
 * equal stamps equal numbers, and `to_timestamp(ms / 1000)` rounds back to the
 * exact microsecond.
 *
 * **R4's `LATERAL … OFFSET 0` is load-bearing** (plan §2.3): it drives the read
 * from the organization's enrichments through `alarms_pkey`; `OFFSET 0` keeps
 * the planner from flattening it into a join that scans `bms.alarms`.
 */

const at = (ms: number): SQL => sql`to_timestamp(${ms}::float8 / 1000)`;

/** The subject's asset as the rules need it, with `T` at full precision. */
export type RootCauseSubjectAssetRow = {
  readonly raisedMs: number;
  readonly rtuId: string | null;
  readonly rtuName: string | null;
  readonly locationId: string;
};

/** The subject's raise instant and its asset's RTU and location, by alarm primary key, asset and organization. */
export function subjectAssetStatement(organizationId: string, alarmId: string, assetId: string): SQL {
  return sql`
    SELECT (extract(epoch FROM al.raised_at) * 1000)::float8 AS raised_ms,
           x.rtu_id AS rtu_id, r.display_name AS rtu_name, x.location_id AS location_id
      FROM bms.alarms al
      JOIN bms.assets x ON x.id = al.asset_id AND x.organization_id = ${organizationId}::uuid
      LEFT JOIN bms.rtus r ON r.id = x.rtu_id AND r.organization_id = ${organizationId}::uuid
     WHERE al.id = ${alarmId}::uuid AND al.organization_id = ${organizationId}::uuid
       AND al.asset_id = ${assetId}::uuid
     LIMIT 1`;
}

/** The subject alarm's asset, by primary key and organization; `null` when it is not there. */
export async function readSubjectAsset(
  tx: BmsTx,
  organizationId: string,
  alarmId: string,
  assetId: string,
): Promise<RootCauseSubjectAssetRow | null> {
  const result = await tx.execute<{ raised_ms: number; rtu_id: string | null; rtu_name: string | null; location_id: string }>(
    subjectAssetStatement(organizationId, alarmId, assetId),
  );
  const row = result.rows[0];
  if (!row) return null;
  return { raisedMs: Number(row.raised_ms), rtuId: row.rtu_id, rtuName: row.rtu_name, locationId: row.location_id };
}

/** Ancestor-or-self of the subject's location (`auth/location-tree.ts`; this file writes no recursive CTE). */
export async function readLocationAncestorIds(tx: BmsTx, organizationId: string, locationId: string): Promise<string[]> {
  return (await locationAncestors(tx, { organizationIds: [organizationId], id: locationId })).map((row) => row.id);
}

/**
 * R1: windows that started by `T`, had not ended 60 min before it and did run
 * (a window cancelled before it started has `ended_at < starts_at`), with the
 * subject's asset target or a target on an ancestor-or-self of its location —
 * so the row cap counts only targets that can cover the asset. The cover test
 * is still the pure step's (`windowCovers`, R-d).
 */
export function coveringWindowsStatement(
  organizationId: string,
  assetId: string,
  locationAncestorIds: readonly string[],
  raisedMs: number,
): SQL {
  return sql`
    SELECT w.id AS id, (extract(epoch FROM w.starts_at) * 1000)::float8 AS starts_ms,
           (extract(epoch FROM COALESCE(w.ended_at, w.ends_at)) * 1000)::float8 AS end_ms,
           t.asset_id AS asset_id, t.location_id AS location_id
      FROM bms.maintenance_windows w
      JOIN bms.maintenance_window_targets t ON t.window_id = w.id AND t.organization_id = ${organizationId}::uuid
     WHERE w.organization_id = ${organizationId}::uuid
       AND w.starts_at <= ${at(raisedMs)}
       AND COALESCE(w.ended_at, w.ends_at) > ${at(raisedMs)} - interval '60 minutes'
       AND COALESCE(w.ended_at, w.ends_at) > w.starts_at
       AND (t.asset_id = ${assetId}::uuid OR t.location_id = ANY(${sql.param([...locationAncestorIds])}::uuid[]))
     ORDER BY w.starts_at DESC, w.id
     LIMIT ${ROOT_CAUSE_WINDOW_ROW_CAP}`;
}

/** Runs {@link coveringWindowsStatement}; one row per window, its targets split by kind. */
export async function readCoveringWindows(
  tx: BmsTx,
  organizationId: string,
  assetId: string,
  locationAncestorIds: readonly string[],
  raisedMs: number,
): Promise<RootCauseWindowRow[]> {
  const result = await tx.execute<{
    id: string;
    starts_ms: number;
    end_ms: number;
    asset_id: string | null;
    location_id: string | null;
  }>(coveringWindowsStatement(organizationId, assetId, locationAncestorIds, raisedMs));
  const byId = new Map<string, { id: string; organizationId: string; startsMs: number; endMs: number; assetIds: string[]; locationIds: string[]; ruleIds: string[] }>();
  for (const row of result.rows) {
    let window = byId.get(row.id);
    if (window === undefined) {
      window = {
        id: row.id,
        organizationId,
        startsMs: Number(row.starts_ms),
        endMs: Number(row.end_ms),
        assetIds: [],
        locationIds: [],
        // R-d: the statement reads no rule target, so none is ever handed on.
        ruleIds: [],
      };
      byId.set(row.id, window);
    }
    if (row.asset_id !== null) window.assetIds.push(row.asset_id);
    if (row.location_id !== null) window.locationIds.push(row.location_id);
  }
  return [...byId.values()];
}

/**
 * The caller's read scope over the related `rule` alarms — `alarmVisibleTo`'s
 * `rule` arm (`alarm-scope.ts`). `null` is the global admin: no predicate. An
 * `rtu_comms` row passes: it is on the subject asset's RTU, and the subject's
 * asset is in the scope (the details gate held), which is that arm's rule.
 */
const readableRuleAlarms = (assetIds: readonly string[] | null): SQL =>
  assetIds === null ? sql`` : sql`AND (al.source <> 'rule' OR al.asset_id = ANY(${sql.param([...assetIds])}::uuid[]))`;

/**
 * R2 and R3 in **one scan** of `bms.alarms`, each class capped by itself:
 * `rtu_comms` alarms on the asset's RTU in `[T − 60 min, T]` (class 0), and
 * `rule` alarms in `[T − 30 min, T]` on the asset or its RTU (class 1, R3) or
 * on its location only (class 2, R3b). Re-raises of the subject's rule on its
 * asset are R4's population and are left out before the cap, as are `rule`
 * alarms outside the caller's scope, so neither takes a capped row. `$rtu` and
 * `$rule` may be null: `= NULL` is never true, so an RTU-less asset links to no
 * RTU-less asset, and a rule-less subject has no re-raise.
 */
export function relatedAlarmsStatement(args: {
  readonly organizationId: string;
  readonly alarmId: string;
  readonly assetId: string;
  readonly ruleId: string | null;
  readonly rtuId: string | null;
  readonly locationId: string;
  readonly raisedMs: number;
  /** The caller's readable asset ids; `null` is the global admin. */
  readonly assetIds: readonly string[] | null;
}): SQL {
  const { organizationId: org, raisedMs } = args;
  return sql`
    SELECT q.id AS id, q.source AS source, q.asset_id AS asset_id, q.rule_id AS rule_id, q.rtu_id AS rtu_id,
           q.message AS message, q.raised_ms AS raised_ms, q.cleared_ms AS cleared_ms,
           q.asset_code AS asset_code, q.asset_rtu_id AS asset_rtu_id, q.asset_location_id AS asset_location_id,
           q.asset_rtu_name AS asset_rtu_name, q.asset_location_name AS asset_location_name
      FROM (
        SELECT al.id AS id, al.source AS source, al.asset_id AS asset_id, al.rule_id AS rule_id, al.rtu_id AS rtu_id,
               al.message AS message,
               (extract(epoch FROM al.raised_at) * 1000)::float8 AS raised_ms,
               (extract(epoch FROM al.cleared_at) * 1000)::float8 AS cleared_ms,
               x.code AS asset_code, x.rtu_id AS asset_rtu_id, x.location_id AS asset_location_id,
               r.display_name AS asset_rtu_name, l.name AS asset_location_name,
               row_number() OVER (
                 PARTITION BY CASE WHEN al.source = 'rtu_comms' THEN 0
                                   WHEN al.asset_id = ${args.assetId}::uuid OR x.rtu_id = ${args.rtuId}::uuid THEN 1
                                   ELSE 2 END
                 ORDER BY al.raised_at DESC, al.id DESC) AS rn
          FROM bms.alarms al
          LEFT JOIN bms.assets x ON x.id = al.asset_id AND x.organization_id = ${org}::uuid
          LEFT JOIN bms.rtus r ON r.id = x.rtu_id AND r.organization_id = ${org}::uuid
          LEFT JOIN bms.locations l ON l.id = x.location_id AND l.organization_id = ${org}::uuid
         WHERE al.organization_id = ${org}::uuid
           AND al.id <> ${args.alarmId}::uuid
           AND al.raised_at >= ${at(raisedMs)} - interval '60 minutes' AND al.raised_at <= ${at(raisedMs)}
           AND (   (al.source = 'rtu_comms' AND al.rtu_id = ${args.rtuId}::uuid)
                OR (al.source = 'rule' AND al.raised_at >= ${at(raisedMs)} - interval '30 minutes'
                    AND (al.asset_id = ${args.assetId}::uuid OR x.rtu_id = ${args.rtuId}::uuid
                         OR x.location_id = ${args.locationId}::uuid)))
           AND NOT COALESCE(al.asset_id = ${args.assetId}::uuid AND al.rule_id = ${args.ruleId}::uuid, false)
           ${readableRuleAlarms(args.assetIds)}
      ) q
     WHERE (q.source = 'rtu_comms' AND q.rn <= ${ROOT_CAUSE_RTU_COMMS_ROW_CAP})
        OR (q.source = 'rule' AND q.rn <= ${ROOT_CAUSE_LINKED_ROW_CAP})
     ORDER BY q.raised_ms DESC, q.id DESC`;
}

/** Runs {@link relatedAlarmsStatement}. The service splits the rows by `source` (R2, R3). */
export async function readRelatedAlarms(
  tx: BmsTx,
  args: Parameters<typeof relatedAlarmsStatement>[0],
): Promise<RootCauseAlarmRow[]> {
  const result = await tx.execute<{
    id: string;
    source: string;
    asset_id: string | null;
    rule_id: string | null;
    rtu_id: string | null;
    message: string;
    raised_ms: number;
    cleared_ms: number | null;
    asset_code: string | null;
    asset_rtu_id: string | null;
    asset_location_id: string | null;
    asset_rtu_name: string | null;
    asset_location_name: string | null;
  }>(relatedAlarmsStatement(args));
  return result.rows.map((row) => ({
    id: row.id,
    source: row.source,
    assetId: row.asset_id,
    ruleId: row.rule_id,
    rtuId: row.rtu_id,
    message: row.message,
    raisedMs: Number(row.raised_ms),
    clearedMs: row.cleared_ms === null ? null : Number(row.cleared_ms),
    assetCode: row.asset_code,
    assetRtuId: row.asset_rtu_id,
    assetLocationId: row.asset_location_id,
    assetRtuName: row.asset_rtu_name,
    assetLocationName: row.asset_location_name,
  }));
}

/**
 * R4: root causes recorded on earlier alarms of the subject's rule and asset in
 * `[T − 180 d, T)`, newest first, at most 50. Driven from the organization's
 * enrichments; the lateral probes `alarms_pkey` per row (`OFFSET 0`, see the header).
 */
export function pastRootCausesStatement(args: {
  readonly organizationId: string;
  readonly alarmId: string;
  readonly assetId: string;
  readonly ruleId: string;
  readonly raisedMs: number;
}): SQL {
  const { organizationId: org, raisedMs } = args;
  return sql`
    SELECT e.root_cause AS root_cause, al.id AS alarm_id, al.raised_ms AS raised_ms
      FROM bms.alarm_enrichments e
     CROSS JOIN LATERAL (
       SELECT a0.id AS id, (extract(epoch FROM a0.raised_at) * 1000)::float8 AS raised_ms
         FROM bms.alarms a0
        WHERE a0.id = e.alarm_id AND a0.organization_id = ${org}::uuid
          AND a0.asset_id = ${args.assetId}::uuid AND a0.rule_id = ${args.ruleId}::uuid AND a0.id <> ${args.alarmId}::uuid
          AND a0.raised_at < ${at(raisedMs)} AND a0.raised_at >= ${at(raisedMs)} - interval '180 days'
       OFFSET 0
     ) al
     WHERE e.organization_id = ${org}::uuid AND e.root_cause IS NOT NULL AND btrim(e.root_cause) <> ''
     ORDER BY al.raised_ms DESC, al.id DESC
     LIMIT ${ROOT_CAUSE_RECORDED_ROW_CAP}`;
}

/** Runs {@link pastRootCausesStatement}. */
export async function readPastRootCauses(
  tx: BmsTx,
  args: Parameters<typeof pastRootCausesStatement>[0],
): Promise<RootCausePastRow[]> {
  const result = await tx.execute<{ root_cause: string; alarm_id: string; raised_ms: number }>(pastRootCausesStatement(args));
  return result.rows.map((row) => ({ alarmId: row.alarm_id, raisedMs: Number(row.raised_ms), rootCause: row.root_cause }));
}
