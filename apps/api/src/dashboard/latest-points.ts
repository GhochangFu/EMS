import type { Pool } from "pg";

import { RAW_RETENTION_DAYS } from "../telemetry/point-aggregates";

/**
 * `F4.390` — the Assets tab's "newest sample per point" read
 * (`DashboardService.locationDashboard`), in two steps that never read an asset's whole history.
 *
 * **Why.** The old `latest_points` CTE was a `DISTINCT ON (asset_id, point_key) … ORDER BY time
 * DESC` over `telemetry.point_values` joined to the page's assets, with no time bound. Measured on
 * the demo host 2026-11-19 for Lotapata I (4 assets): 1,425,482 rows decompressed from all 134
 * chunks, an 88 MB on-disk sort, planning 491 ms, execution **100,759 ms** — to keep 33 rows.
 * `point_values` keeps 730 days and gains a chunk a day, so that read got slower daily.
 *
 * - **D1 — the key set comes from `telemetry.point_values_1d`** ({@link discoverLatestPairs}). Per
 *   `(asset_id, point_key)` of the page's assets, `max(bucket)`: the UTC day that holds the pair's
 *   newest sample. The aggregate is real-time on all four levels (migration `0027`), never dropped
 *   and uncompressed, so the read unions each level's real-time tail. An uncatalogued key is listed
 *   because it has a bucket; a never-reported catalogued key is absent, as before.
 * - **D2 — the newest value is a lateral `LIMIT 1` bounded to that UTC day by SQL-text timestamp
 *   literals** ({@link planLatestPoints}). Pairs are grouped by day; each group is one `UNION ALL`
 *   arm. The planner sees constants and plans one or two chunks per arm, for a live pair and for a
 *   pair silent for months alike. A bound computed from a value instead of a literal planned for
 *   374 ms (133 chunks excluded only at startup); with the literal, 3.3 ms. At most
 *   {@link LATEST_DAY_ARMS_MAX} arms: the oldest days share the last arm, bounded from the oldest
 *   of them to the day after the newest of them.
 * - **D3 — exactness rests on the aggregate being a complete record**, the standing obligation of
 *   `0027`'s header: live samples are stamped at receive time (ADR 0061) and every writer of old
 *   timestamps refreshes. Residual: a sample written behind a watermark is invisible until its
 *   refresh; a pair whose raw rows are gone yields no row from the lateral and drops out, as in the
 *   old read.
 * - **D4 — values never cross JavaScript.** Only `(asset_id, point_key, group)` go back in as three
 *   array parameters; value, unit and time are read inside the main statement, so the caller's
 *   `telemetry` CTE keeps its order and its microsecond timestamps.
 *
 * Task 0 (demo host, 2026-11-19, `bms_fleet`, warm): discovery 5.1 ms planning + 5.0 ms execution;
 * one arm 0.5 ms + 0.7 ms; old read and new read differed by 0 rows (33 = 33).
 *
 * The one value from the database that enters SQL text is the day literal, and it is validated as
 * a real `YYYY-MM-DD` date before any text is built (§4.4; the `assetIdsScopeSql` precedent in
 * `telemetry-cadence.ts`).
 */

/** At most this many `UNION ALL` arms; the oldest days share the last one (D2). */
export const LATEST_DAY_ARMS_MAX = 6;

/** One discovered pair: the UTC day (`YYYY-MM-DD`) that holds its newest sample. */
export interface LatestPair {
  readonly assetId: string;
  readonly pointKey: string;
  readonly lastDay: string;
}

/** `cteSql` is `latest_pairs AS (…),\nlatest_points AS (…)` — no `WITH`, no trailing comma. */
export interface LatestPointsPlan {
  readonly cteSql: string;
  readonly params: readonly [readonly string[], readonly string[], readonly number[]];
}

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The day after `day`, both `YYYY-MM-DD`; throws unless `day` is a real date. */
function nextDay(day: string): string {
  const match = DAY_PATTERN.exec(day);
  if (!match) {
    throw new Error("planLatestPoints: not a YYYY-MM-DD day");
  }
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new Error("planLatestPoints: not a real date");
  }
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function armSql(group: number, fromDay: string, toDay: string): string {
  return `SELECT p.asset_id, p.point_key, s.value, s.unit, s.time
  FROM latest_pairs p
  CROSS JOIN LATERAL (
    SELECT v.value, v.unit, v.time FROM telemetry.point_values v
    WHERE v.asset_id = p.asset_id AND v.point_key = p.point_key
      AND v.time >= timestamptz '${fromDay} 00:00:00+00' AND v.time < timestamptz '${toDay} 00:00:00+00'
    ORDER BY v.time DESC LIMIT 1
  ) s
  WHERE p.grp = ${group}`;
}

/**
 * Builds the `latest_pairs` and `latest_points` CTEs for `pairs`, with the three array parameters
 * numbered from `firstParam`. Every day is validated before any text is built. With no pairs the
 * CTEs still name all three parameters (a statement naming fewer than are bound fails at Bind).
 */
export function planLatestPoints(pairs: readonly LatestPair[], firstParam: number): LatestPointsPlan {
  const next = new Map<string, string>();
  for (const pair of pairs) {
    if (!next.has(pair.lastDay)) {
      next.set(pair.lastDay, nextDay(pair.lastDay));
    }
  }

  // Newest day first; group i is arm i, the oldest days share the last arm.
  const days = [...next.keys()].sort().reverse();
  const groupOfDay = new Map<string, number>(days.map((day, i) => [day, Math.min(i, LATEST_DAY_ARMS_MAX - 1)]));
  const arms: string[] = [];
  for (let i = 0; i < Math.min(days.length, LATEST_DAY_ARMS_MAX); i += 1) {
    const merged = i === LATEST_DAY_ARMS_MAX - 1;
    const fromDay = merged ? days[days.length - 1] : days[i];
    arms.push(armSql(i, fromDay, next.get(days[i]) as string));
  }

  const [a, k, g] = [firstParam, firstParam + 1, firstParam + 2];
  const latestPoints =
    arms.length === 0
      ? "SELECT p.asset_id, p.point_key, NULL::float8 AS value, NULL::varchar AS unit, NULL::timestamptz AS time FROM latest_pairs p WHERE false"
      : arms.join("\n  UNION ALL\n  ");

  return {
    cteSql: `latest_pairs AS (
  SELECT u.asset_id, u.point_key, u.grp
  FROM unnest($${a}::uuid[], $${k}::varchar[], $${g}::int[]) AS u(asset_id, point_key, grp)
),
latest_points AS (
  ${latestPoints}
)`,
    params: [
      pairs.map((pair) => pair.assetId),
      pairs.map((pair) => pair.pointKey),
      pairs.map((pair) => groupOfDay.get(pair.lastDay) as number),
    ],
  };
}

/**
 * The discovery horizon: the raw retention plus one day, a closed constant written into the SQL
 * text as a literal so the planner sees it (D1; never request input, §4.4). A bucket older than
 * this has no raw row left for the lateral to read.
 */
const DISCOVERY_INTERVAL_SQL = `interval '${RAW_RETENTION_DAYS + 1} days'`;

/**
 * D1 — per `(asset_id, point_key)` of `assetIds`, the UTC day of its newest daily bucket in the
 * real-time `telemetry.point_values_1d`. `asset_id = ANY($1)` is a plain qual on a grouping
 * column, so it reaches every level of the hierarchical view; a join against a CTE would not. An
 * empty list issues no query.
 */
export async function discoverLatestPairs(pool: Pool, assetIds: readonly string[]): Promise<LatestPair[]> {
  if (assetIds.length === 0) {
    return [];
  }
  const { rows } = await pool.query<{ asset_id: string; point_key: string; last_day: string }>(
    `SELECT d.asset_id, d.point_key,
            to_char(max(d.bucket) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS last_day
     FROM telemetry.point_values_1d d
     WHERE d.asset_id = ANY($1::uuid[])
       AND d.bucket > now() - ${DISCOVERY_INTERVAL_SQL}
     GROUP BY d.asset_id, d.point_key`,
    [assetIds],
  );
  return rows.map((row) => ({ assetId: row.asset_id, pointKey: row.point_key, lastDay: row.last_day }));
}
