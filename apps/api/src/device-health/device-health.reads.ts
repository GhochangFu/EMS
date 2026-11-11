import { eq, inArray, sql, type SQL } from "drizzle-orm";

import { rtus } from "@bms/db";
import type { BmsDb } from "@bms/db";
import type { DropFirst, DropReason, RtuDropCount, UnattributedDrop } from "@bms/shared";

import { FRESHNESS_FLOOR_SECONDS, rtuWindowsCteSql } from "../telemetry/telemetry-cadence";
import { rtuStateAt, type HostBeat, type RtuHealthFacts } from "./device-state";

/**
 * `F3.16` / ADR 0127 decisions 3, 11, 14, 17 — the device-health SQL. Every
 * statement here runs on `fleetDb` (`bms_fleet`, BYPASSRLS); the isolation
 * control is the caller's scope predicate ({@link RtuScope}, from
 * `writableLocationIds` / `canManageLocation`), and each call site in
 * `device-health.service.ts` says so (§4.3). Parameterised throughout; the only
 * raw text is `rtuWindowsCteSql`, whose scope is this module's own subquery (§4.4).
 *
 * Timestamps cross as epoch milliseconds (`float8`), so no driver date parsing
 * and no session time zone is involved. "The last 24 hours" of hour buckets is
 * every bucket that **overlaps** them (`bucket > now() - 25 h`), a range
 * comparison rather than a `date_trunc` in the session zone.
 */

/** Hour buckets overlapping this many hours count as "the last 24 h" (`drops24h`, `unattributed`). */
export const DROPS_RECENT_HOURS = 24;

/** The drop history reads this many days of hour buckets (ADR 0127 decision 3). */
export const DROP_HISTORY_DAYS = 30;

/** The bound on `unattributed` rows (a misconfigured endpoint can name many device keys). */
const UNATTRIBUTED_LIMIT = 200;

/**
 * Which RTUs a list reads: every RTU, one location, a set of writable locations, or (`F3.16` PR B)
 * every RTU the ingest host monitors — the system sweeps' scope, the worker's raise and the
 * lifecycle's clear, which judge only RTUs with a `monitored_since` (decision 20).
 */
export type RtuScope =
  | { readonly kind: "all" }
  | { readonly kind: "monitored" }
  | { readonly kind: "location"; readonly locationId: string }
  | { readonly kind: "locations"; readonly locationIds: readonly string[] };

function scopePredicate(scope: RtuScope): SQL {
  if (scope.kind === "location") return eq(rtus.locationId, scope.locationId);
  if (scope.kind === "locations") return inArray(rtus.locationId, [...scope.locationIds]);
  if (scope.kind === "monitored") {
    return sql`${rtus.id} IN (SELECT mh.rtu_id FROM bms.rtu_health mh WHERE mh.monitored_since IS NOT NULL)`;
  }
  return sql`TRUE`;
}

/** The scope CTE, unaliased so Drizzle's column renders against `bms.rtus`. */
function scopeCte(scope: RtuScope): SQL {
  return sql`scope AS (SELECT rtus.id FROM bms.rtus WHERE ${scopePredicate(scope)})`;
}

const ms = (column: string): SQL => sql.raw(`(extract(epoch FROM ${column}) * 1000)::float8`);

export interface RtuHealthRow extends RtuHealthFacts {
  readonly rtuId: string;
  readonly organizationId: string;
  readonly code: string;
  readonly displayName: string;
  readonly edgeServed: boolean;
  readonly windowSeconds: number;
  readonly clockSkewSeconds: number | null;
  readonly clockSkewAtMs: number | null;
}

/** The main list: one row per scoped RTU, its `rtu_health` fields (null when it has none) and its window. */
export async function readRtuHealthRows(db: BmsDb, scope: RtuScope): Promise<RtuHealthRow[]> {
  const result = await db.execute<{
    rtu_id: string;
    organization_id: string;
    code: string;
    display_name: string;
    edge_served: boolean;
    host_key: string | null;
    last_seen_ms: number | null;
    monitored_since_ms: number | null;
    clock_skew_seconds: number | null;
    clock_skew_at_ms: number | null;
    window_seconds: number;
  }>(sql`
    WITH ${scopeCte(scope)},
    ${sql.raw(rtuWindowsCteSql("SELECT id FROM scope"))}
    SELECT r.id AS rtu_id, r.organization_id, r.code, r.display_name,
           (r.edge_gateway_id IS NOT NULL) AS edge_served,
           h.host_key,
           ${ms("h.last_seen_at")} AS last_seen_ms,
           ${ms("h.monitored_since")} AS monitored_since_ms,
           h.clock_skew_seconds,
           ${ms("h.clock_skew_at")} AS clock_skew_at_ms,
           COALESCE(w.window_seconds, ${FRESHNESS_FLOOR_SECONDS})::int AS window_seconds
      FROM scope s
      JOIN bms.rtus r ON r.id = s.id
      LEFT JOIN bms.rtu_health h ON h.rtu_id = r.id
      LEFT JOIN rtu_windows w ON w.rtu_id = r.id
     ORDER BY r.display_name, r.id
  `);
  return result.rows.map((row) => ({
    rtuId: row.rtu_id,
    organizationId: row.organization_id,
    code: row.code,
    displayName: row.display_name,
    edgeServed: row.edge_served,
    hostKey: row.host_key,
    lastSeenMs: row.last_seen_ms,
    monitoredSinceMs: row.monitored_since_ms,
    clockSkewSeconds: row.clock_skew_seconds,
    clockSkewAtMs: row.clock_skew_at_ms,
    windowSeconds: Number(row.window_seconds),
  }));
}

/** Judges one row against its serving host (decision 11): the one call of the state rule on this path. */
export function stateOf(row: RtuHealthRow, hostsByKey: ReadonlyMap<string, HostBeat>) {
  return rtuStateAt(row, row.hostKey === null ? undefined : hostsByKey.get(row.hostKey), row.windowSeconds);
}

interface FirstColumns extends Record<string, unknown> {
  first_asset_id: string | null;
  first_asset_code: string | null;
  first_asset_rtu_name: string | null;
  first_asset_location_name: string | null;
  first_point_key: string | null;
  first_source_key: string | null;
}

/**
 * The first dropped point, named for `assetLabel` (ADR 0111). The asset is joined only inside the
 * bucket's own organization, so a stale `first_asset_id` (no foreign key, decision 7) never names
 * another tenant's asset.
 */
const FIRST_SELECT = sql.raw(`
  x.first_asset_id, fa.code AS first_asset_code, fr.display_name AS first_asset_rtu_name,
  fl.name AS first_asset_location_name, x.first_point_key, x.first_source_key`);
// Security review L1: the asset is labelled only while it is still on the bucket's own RTU, so a
// moved asset never shows a location admin another location's code, RTU or location name.
const FIRST_JOINS = sql.raw(`
  LEFT JOIN bms.assets fa ON fa.id = x.first_asset_id AND fa.organization_id = x.organization_id
    AND fa.rtu_id = x.rtu_id
  LEFT JOIN bms.rtus fr ON fr.id = fa.rtu_id
  LEFT JOIN bms.locations fl ON fl.id = fa.location_id`);

function firstOf(row: FirstColumns): DropFirst | null {
  if (row.first_asset_id === null && row.first_point_key === null && row.first_source_key === null) {
    return null;
  }
  return {
    assetId: row.first_asset_id,
    assetCode: row.first_asset_code,
    assetRtuName: row.first_asset_rtu_name,
    assetLocationName: row.first_asset_location_name,
    pointKey: row.first_point_key,
    sourceKey: row.first_source_key,
  };
}

/**
 * Per scoped RTU and reason, the drops of the buckets overlapping the last 24 h, with the
 * earliest bucket's first point and that bucket as `firstAt`, so the web can name the
 * earliest drop across reasons.
 */
export async function readRecentDrops(db: BmsDb, scope: RtuScope): Promise<Map<string, RtuDropCount[]>> {
  const result = await db.execute<
    FirstColumns & { rtu_id: string; reason: DropReason; total: number; first_at_ms: number }
  >(sql`
    WITH ${scopeCte(scope)},
    x AS (
      SELECT d.*,
             row_number() OVER (PARTITION BY d.rtu_id, d.reason ORDER BY d.bucket) AS rn,
             sum(d.dropped) OVER (PARTITION BY d.rtu_id, d.reason) AS total
        FROM bms.rtu_drop_hours d
       WHERE d.rtu_id IN (SELECT id FROM scope)
         AND d.bucket > now() - make_interval(hours => ${DROPS_RECENT_HOURS + 1})
    )
    SELECT x.rtu_id, x.reason, x.total::float8 AS total, ${ms("x.bucket")} AS first_at_ms, ${FIRST_SELECT}
      FROM x ${FIRST_JOINS}
     WHERE x.rn = 1
     ORDER BY x.rtu_id, x.reason
  `);
  const byRtu = new Map<string, RtuDropCount[]>();
  for (const row of result.rows) {
    const list = byRtu.get(row.rtu_id) ?? [];
    list.push({
      reason: row.reason,
      count: Number(row.total),
      firstAt: new Date(Number(row.first_at_ms)).toISOString(),
      first: firstOf(row),
    });
    byRtu.set(row.rtu_id, list);
  }
  return byRtu;
}

/** One RTU's hour buckets of the last {@link DROP_HISTORY_DAYS} days, newest first. */
export async function readDropHistory(db: BmsDb, rtuId: string) {
  const result = await db.execute<FirstColumns & { bucket_ms: number; reason: DropReason; dropped: number }>(sql`
    SELECT ${ms("x.bucket")} AS bucket_ms, x.reason, x.dropped::float8 AS dropped, ${FIRST_SELECT}
      FROM bms.rtu_drop_hours x ${FIRST_JOINS}
     WHERE x.rtu_id = ${rtuId}
       AND x.bucket > now() - make_interval(days => ${DROP_HISTORY_DAYS}) - interval '1 hour'
     ORDER BY x.bucket DESC, x.reason
  `);
  return result.rows.map((row) => ({
    bucket: new Date(row.bucket_ms).toISOString(),
    reason: row.reason,
    count: Number(row.dropped),
    first: firstOf(row),
  }));
}

/** The RTU's location, for the drop-history gate; `undefined` when no such RTU exists. */
export async function readRtuLocation(db: BmsDb, rtuId: string): Promise<string | undefined> {
  const [row] = await db.select({ locationId: rtus.locationId }).from(rtus).where(eq(rtus.id, rtuId)).limit(1);
  return row?.locationId;
}

/** Every ingest host's beat, and the database clock the host state is judged on (decision 16). */
export async function readIngestHosts(db: BmsDb): Promise<{ hosts: HostBeat[]; dbNowMs: number }> {
  const result = await db.execute<{
    now_ms: number;
    host_key: string | null;
    last_beat_ms: number | null;
    healthy_since_ms: number | null;
  }>(sql`
    SELECT ${ms("now()")} AS now_ms, h.host_key,
           ${ms("h.last_beat_at")} AS last_beat_ms, ${ms("h.healthy_since")} AS healthy_since_ms
      FROM (SELECT 1) one
      LEFT JOIN bms.ingest_hosts h ON TRUE
  `);
  const hosts: HostBeat[] = [];
  for (const row of result.rows) {
    if (row.host_key !== null && row.last_beat_ms !== null) {
      hosts.push({ hostKey: row.host_key, lastBeatMs: row.last_beat_ms, healthySinceMs: row.healthy_since_ms });
    }
  }
  return { hosts, dbNowMs: Number(result.rows[0]?.now_ms ?? Date.now()) };
}

/** The drops with no RTU (decision 17), per host, endpoint and reason, over the buckets overlapping the last 24 h. */
export async function readUnattributedDrops(db: BmsDb): Promise<UnattributedDrop[]> {
  const result = await db.execute<{
    host_key: string;
    endpoint_key: string;
    reason: DropReason;
    total: number;
    first_device_key: string | null;
    first_source_key: string | null;
  }>(sql`
    WITH x AS (
      SELECT d.*,
             row_number() OVER (PARTITION BY d.host_key, d.endpoint_key, d.reason ORDER BY d.bucket) AS rn,
             sum(d.dropped) OVER (PARTITION BY d.host_key, d.endpoint_key, d.reason) AS total
        FROM bms.ingest_endpoint_drop_hours d
       WHERE d.bucket > now() - make_interval(hours => ${DROPS_RECENT_HOURS + 1})
    )
    SELECT x.host_key, x.endpoint_key, x.reason, x.total::float8 AS total, x.first_device_key, x.first_source_key
      FROM x
     WHERE x.rn = 1
     ORDER BY x.total DESC, x.host_key, x.endpoint_key, x.reason
     LIMIT ${UNATTRIBUTED_LIMIT}
  `);
  return result.rows.map((row) => ({
    hostKey: row.host_key,
    endpointKey: row.endpoint_key,
    reason: row.reason,
    count: Number(row.total),
    firstDeviceKey: row.first_device_key,
    firstSourceKey: row.first_source_key,
  }));
}
