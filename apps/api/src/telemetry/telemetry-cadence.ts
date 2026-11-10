/**
 * `F4.350` (ADR 0075 Amendment 3) — how long an asset's newest sample keeps it live: a
 * window that follows the asset's own RTU's send interval instead of one fixed number.
 *
 * `window = clamp(CEIL(2.5 x interval), FLOOR, CAP)` with `FLOOR = 25 s` and `CAP = 900 s`.
 * `interval` is, in order: `bms.rtus.expected_interval_seconds` when set (configured wins),
 * else the **learned** interval (the median over the last 24 completed hours of
 * 3600 / samples-per-hour), else none, which gives the floor. A 60 s device gets 150 s: one missed report still counts, two do not. A
 * 1-10 s simulator device gets the floor.
 *
 * This module is the single source. {@link windowSecondsFor} is the pure rule (JS readers);
 * {@link ASSET_WINDOW_SECONDS_SQL} and {@link LIVE_ASSETS_CTE_SQL} state the same rule in SQL.
 * `tests/f3.28-offline-bound-single-source.test.ts` pins every reader to them and forbids a
 * restated number. The 150 s `REPORTING_WINDOW_SECONDS` of Amendments 1-2 is gone.
 */

/** The window no asset gets less than; also the window of an RTU with no known interval. */
export const FRESHNESS_FLOOR_SECONDS = 25;

/** The window no asset gets more than (proposed 900 s; to be confirmed against the measured gaps). */
export const FRESHNESS_CAP_SECONDS = 900;

/** Window = this x the interval: one missed report counts, two do not. */
export const FRESHNESS_INTERVAL_FACTOR = 2.5;

/** How far back the learned interval reads. */
export const LEARNED_INTERVAL_LOOKBACK_HOURS = 24;

/** The pure rule. A missing, zero, negative or non-finite interval is the floor. */
export function windowSecondsFor(intervalSeconds: number | null | undefined): number {
  if (typeof intervalSeconds !== "number" || !Number.isFinite(intervalSeconds) || intervalSeconds <= 0) {
    return FRESHNESS_FLOOR_SECONDS;
  }
  const window = Math.ceil(FRESHNESS_INTERVAL_FACTOR * intervalSeconds);
  return Math.min(FRESHNESS_CAP_SECONDS, Math.max(FRESHNESS_FLOOR_SECONDS, window));
}

/**
 * The per-asset window in SQL. It needs `r` (`bms.rtus`, LEFT JOINed on `a.rtu_id`) and `l`
 * (the `learned` CTE, LEFT JOINed on `a.rtu_id`) in scope. `COALESCE(..., 0)` makes an unknown
 * interval 0, which `GREATEST` lifts to the floor — the same as {@link windowSecondsFor}.
 * Every number is this module's own constant, never request input (§4.4).
 */
export const ASSET_WINDOW_SECONDS_SQL =
  `LEAST(${FRESHNESS_CAP_SECONDS}, GREATEST(${FRESHNESS_FLOOR_SECONDS}, ` +
  `CEIL(${FRESHNESS_INTERVAL_FACTOR} * COALESCE(r.expected_interval_seconds, l.interval_seconds, 0))))`;

/**
 * The `learned` CTE: per RTU, the median over the last {@link LEARNED_INTERVAL_LOOKBACK_HOURS}
 * completed hours of `3600 / n`, where `n` is the largest per-point `sample_count` of any asset
 * of the RTU in that hour, read from the `point_values_1h` aggregate (24 rows per asset-point,
 * against 1,440 for the minute aggregate and every raw row for a scan). A device that sends
 * every T seconds has `n = 3600 / T`, so the estimate is T for any T, including 75-90 s, which a
 * minute-bucket estimate misreads. Only completed hours count (the current hour is partial and
 * would read slow), so an RTU younger than an hour has no learned interval and takes the floor;
 * a device that was down for part of an hour reads slow for that hour, which the median absorbs
 * and which can only widen the window, never narrow it. The window ignores `learned` for an RTU
 * with a configured interval. `scope` narrows it to the RTUs of the scoped assets (see
 * {@link liveAssetsCteSql}).
 */
function learnedIntervalsCteSql(scope: string | null): string {
  const rtuScope = scope === null ? "" : `AND la.rtu_id IN (SELECT sa.rtu_id FROM bms.assets sa WHERE sa.id IN (${scope}))`;
  return `learned AS (
  SELECT x.rtu_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY 3600.0 / x.n) AS interval_seconds
  FROM (
    SELECT la.rtu_id, v.bucket, max(v.sample_count) AS n
    FROM telemetry.point_values_1h v
    JOIN bms.assets la ON la.id = v.asset_id
    WHERE v.bucket >= date_trunc('hour', now()) - interval '${LEARNED_INTERVAL_LOOKBACK_HOURS} hours'
      AND v.bucket < date_trunc('hour', now())
      AND la.rtu_id IS NOT NULL
      ${rtuScope}
    GROUP BY la.rtu_id, v.bucket
  ) x
  GROUP BY x.rtu_id
)`;
}

/**
 * The shared CTEs: `learned`, then `live` — the asset ids whose newest sample of any point is
 * newer than their own window. Use as `WITH ${liveAssetsCteSql()}` (or after the caller's own
 * CTEs). Unscoped by default (fleet-wide; the caller joins it against its own scope). A caller
 * that has already narrowed its assets passes `scopeAssetIdsSql`, a subquery text returning
 * `asset_id`s (for example `SELECT asset_id FROM members`); it limits both CTEs. That text is
 * the caller's own SQL, never request input (§4.4).
 *
 * The `time` predicate is the cap as a plan-time literal, not a bound parameter — TimescaleDB
 * excludes `point_values` chunks at plan time only for `now() - <literal interval>` (measured
 * 2026-09-24: 520-1900 ms with a parameter, 42-100 ms with the literal). Inside the cap it takes
 * each asset's newest sample once (`GROUP BY asset_id`), and only then joins the asset's RTU and
 * applies the per-asset window, so the joins run per asset, not per sample.
 */
export function liveAssetsCteSql(scopeAssetIdsSql: string | null = null): string {
  const liveScope = scopeAssetIdsSql === null ? "" : `AND pv.asset_id IN (${scopeAssetIdsSql})`;
  return `${learnedIntervalsCteSql(scopeAssetIdsSql)},
live AS (
  SELECT n.asset_id
  FROM (
    SELECT pv.asset_id, max(pv.time) AS newest
    FROM telemetry.point_values pv
    WHERE pv.time > now() - interval '${FRESHNESS_CAP_SECONDS} seconds'
      ${liveScope}
    GROUP BY pv.asset_id
  ) n
  JOIN bms.assets a ON a.id = n.asset_id
  LEFT JOIN bms.rtus r ON r.id = a.rtu_id
  LEFT JOIN learned l ON l.rtu_id = a.rtu_id
  WHERE n.newest > now() - (${ASSET_WINDOW_SECONDS_SQL} * interval '1 second')
)`;
}

/** The unscoped form: `WITH ${LIVE_ASSETS_CTE_SQL}`. */
export const LIVE_ASSETS_CTE_SQL = liveAssetsCteSql();

/**
 * The `learned` and `asset_windows` CTEs for a reader that judges one newest sample in JS
 * (`telemetryFreshnessAt(latestIso, nowMs, windowSeconds)`): `asset_windows(asset_id,
 * window_seconds)` has one row per scoped asset, with the window of {@link ASSET_WINDOW_SECONDS_SQL}.
 * `scopeAssetIdsSql` is the caller's own subquery returning `asset_id`s (never request input,
 * §4.4). Join it `LEFT JOIN asset_windows aw ON aw.asset_id = <asset>` and read
 * `COALESCE(aw.window_seconds, ${FRESHNESS_FLOOR_SECONDS})`.
 */
export function assetWindowsCteSql(scopeAssetIdsSql: string): string {
  return `${learnedIntervalsCteSql(scopeAssetIdsSql)},
asset_windows AS (
  SELECT a.id AS asset_id, ${ASSET_WINDOW_SECONDS_SQL} AS window_seconds
  FROM bms.assets a
  LEFT JOIN bms.rtus r ON r.id = a.rtu_id
  LEFT JOIN learned l ON l.rtu_id = a.rtu_id
  WHERE a.id IN (${scopeAssetIdsSql})
)`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A scope subquery (`scopeAssetIdsSql` of {@link assetWindowsCteSql}) for a list of asset ids a
 * reader already holds. The ids are written into the SQL text — a Drizzle `sql.raw` cannot carry
 * a bound parameter — so each one must be a UUID; anything else throws before it can reach SQL
 * (§4.4). An empty list is a scope of no assets.
 */
export function assetIdsScopeSql(ids: readonly string[]): string {
  for (const id of ids) {
    if (!UUID_PATTERN.test(id)) {
      throw new Error("assetIdsScopeSql: not a UUID");
    }
  }
  return ids.length === 0
    ? "SELECT NULL::uuid WHERE FALSE"
    : `SELECT unnest(ARRAY[${ids.map((id) => `'${id}'`).join(",")}]::uuid[])`;
}

/** What {@link assetWindowsCteSql} yields, read into a map: asset id to window seconds. */
export function windowsByAsset(rows: readonly { asset_id: string; window_seconds: number | string }[]): Map<string, number> {
  return new Map(rows.map((row) => [row.asset_id, Number(row.window_seconds)]));
}
