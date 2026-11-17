import { sql, type SQL } from "drizzle-orm";

import { PAST_FORECAST_MAX_LEAD_HOURS } from "@bms/shared";

import type { BmsTx } from "../database/tenant-context";
import {
  lookBackStartOf,
  type ForecastListDbRow,
  type PastForecastDbRow,
  type PointForecastDbRow,
} from "./ml-forecasts.pure";

/**
 * `E1.4a` / ADR 0135 Amendment 3 R-c, S1, S3, C3, C4, C6 — the forecast SQL.
 *
 * **Every function takes the `tx` that `withReadScope` hands it, and nothing
 * else** (plan §16 security 3): on the tenant branch that transaction carries
 * the `app.current_organization` GUC, so `0157`'s `tenant_isolation` policy
 * scopes every `ml` row read here; on the fleet branch (`bms_fleet`,
 * `BYPASSRLS`) the `asset_id = ANY(ids)` line is the only isolation control. That
 * line is present whenever the caller's ids are not `null`, on **both** branches
 * (S1), and is chosen by `ids !== null`, never by the branch (§16 security 2).
 *
 * **"Current" (R1, C3).** The newest succeeded run for the point that holds the
 * current hour's bucket. A run's buckets are consecutive hours from the hour it
 * scored, so this is C3's "a bucket at or after the current hour" for every run
 * whose first bucket is not in the future. Both reads look back
 * `FORECAST_MAX_HORIZON_HOURS` (R3): no older run has a bucket at the current hour.
 *
 * **Only three run fields are selected (S3):** `model_name`, `model_version` and
 * the issue time. Times leave as epoch milliseconds (`float8`), the device-health
 * reads' rule; the current hour is the request's one clock, bound as a parameter
 * (R2). Parameterised throughout, no raw text.
 *
 * **The list's `LATERAL … OFFSET 0` is load-bearing (R4).** A plain join of
 * recent runs to `ml.forecasts` plans a sequential scan of the whole table once
 * it grows (measured in the plan, section 2). Per run, the lateral subquery
 * reads `forecasts_model_run_idx`; `OFFSET 0` keeps the planner from flattening
 * it back into the join. `ml-forecasts.integration.spec.ts` holds both reads to
 * no sequential scan of `ml.forecasts`.
 */

const at = (ms: number): SQL => sql`to_timestamp(${ms}::float8 / 1000)`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One `uuid[]` parameter (the `admin/users/effective-grant.ts` shape), never a spread array
 * (§16 N8). The literal is bound, so this is no SQL injection, but an element holding `,`, `}`
 * or `"` would add array elements and widen the fleet branch's only filter. The ids come from
 * `readableAssetIds` today; the check keeps a later caller from passing request text through.
 */
export function uuidArray(ids: readonly string[]): string {
  for (const id of ids) {
    if (!UUID.test(id)) {
      throw new Error("ml forecast read: an asset id is not a UUID");
    }
  }
  return `{${ids.join(",")}}`;
}

/**
 * The one-point read. Step one finds the current run with three equalities on
 * `forecasts_pkey` (asset, point, the current hour) and the run's status; step
 * two reads that run's rows for the point from the look-back start, so the
 * first row is the run's first bucket and decides `stale` in the pure step,
 * which then drops the buckets before the current hour (C4).
 */
export function pointForecastStatement(point: { assetId: string; pointKey: string }, currentHourMs: number): SQL {
  const since = lookBackStartOf(currentHourMs);
  return sql`
    WITH current_run AS (
      SELECT f.model_run_id, f.issued_at, r.model_name, r.model_version
        FROM ml.forecasts f
        JOIN ml.model_runs r ON r.id = f.model_run_id AND r.organization_id = f.organization_id
       WHERE f.asset_id = ${point.assetId}::uuid AND f.point_key = ${point.pointKey}
         AND f.horizon_bucket = ${at(currentHourMs)}
         AND r.status = 'succeeded' AND f.issued_at >= ${at(since)}
       ORDER BY f.issued_at DESC
       LIMIT 1
    )
    SELECT (extract(epoch FROM f.horizon_bucket) * 1000)::float8 AS bucket_ms,
           f.p10, f.p50, f.p90,
           (extract(epoch FROM c.issued_at) * 1000)::float8 AS issued_ms,
           c.model_name, c.model_version
      FROM current_run c
      JOIN ml.forecasts f ON f.asset_id = ${point.assetId}::uuid AND f.point_key = ${point.pointKey}
                         AND f.model_run_id = c.model_run_id AND f.horizon_bucket >= ${at(since)}
     ORDER BY f.horizon_bucket`;
}

/** Runs {@link pointForecastStatement} on `tx`: the current run's rows for one point, ascending. */
export async function readPointForecast(
  tx: BmsTx,
  point: { assetId: string; pointKey: string },
  currentHourMs: number,
): Promise<PointForecastDbRow[]> {
  const result = await tx.execute<PointForecastDbRow>(pointForecastStatement(point, currentHourMs));
  return result.rows;
}

/**
 * The list's run chain, exported so `E1.9a`'s findings read (`ml-findings.reads.ts`) uses the
 * same text: `recent_runs` (the succeeded runs of the look-back), `covering` (per run, through
 * the `LATERAL … OFFSET 0` of R4, the rows at the current hour among `ids`) and `current_runs`
 * (the newest covering run per point). `ids` `null` is the unrestricted admin; the
 * `asset_id = ANY(ids)` line is chosen by `ids === null`, never by the branch (S1).
 */
export function currentForecastRunsCte(ids: readonly string[] | null, currentHourMs: number): SQL {
  const since = lookBackStartOf(currentHourMs);
  const assetFilter = ids === null ? sql`` : sql`AND f0.asset_id = ANY(${uuidArray(ids)}::uuid[])`;
  return sql`
    WITH recent_runs AS (
      SELECT r.id, r.organization_id, r.model_name, r.model_version
        FROM ml.model_runs r
       WHERE r.status = 'succeeded' AND r.started_at >= ${at(since)}
    ), covering AS (
      SELECT f.asset_id, f.point_key, f.model_run_id, f.issued_at, rr.model_name, rr.model_version
        FROM recent_runs rr
       CROSS JOIN LATERAL (
         SELECT f0.asset_id, f0.point_key, f0.model_run_id, f0.issued_at
           FROM ml.forecasts f0
          WHERE f0.model_run_id = rr.id AND f0.organization_id = rr.organization_id
            AND f0.horizon_bucket = ${at(currentHourMs)}
            ${assetFilter}
         OFFSET 0
       ) f
    ), current_runs AS (
      SELECT DISTINCT ON (asset_id, point_key) asset_id, point_key, model_run_id, issued_at, model_name, model_version
        FROM covering
       ORDER BY asset_id, point_key, issued_at DESC
    )`;
}

/**
 * The list read: one row per `(asset, point)` with a current run, the p50
 * summary over that run's buckets at or after the current hour, and the site's
 * names and zones. `ids` `null` is the unrestricted admin (`readableAssetIds`).
 * Every output column is aliased (§16 B1): a raw read keys the row by column
 * name, and two unaliased `timezone` columns would collide.
 */
export function forecastListStatement(ids: readonly string[] | null, currentHourMs: number): SQL {
  const since = lookBackStartOf(currentHourMs);
  return sql`
    ${currentForecastRunsCte(ids, currentHourMs)}
    SELECT c.asset_id AS asset_id, c.point_key AS point_key,
           (extract(epoch FROM c.issued_at) * 1000)::float8 AS issued_ms,
           c.model_name AS model_name, c.model_version AS model_version,
           (extract(epoch FROM agg.first_bucket) * 1000)::float8 AS first_bucket_ms,
           agg.p50_min AS p50_min, agg.p50_max AS p50_max,
           (extract(epoch FROM agg.p50_peak_at) * 1000)::float8 AS p50_peak_ms,
           a.code AS asset_code, a.name AS asset_name, rtu.display_name AS asset_rtu_name,
           l.id AS location_id, l.name AS location_name,
           l.timezone AS location_time_zone, o.timezone AS organization_time_zone,
           ap.unit AS unit
      FROM current_runs c
     CROSS JOIN LATERAL (
       SELECT min(f.horizon_bucket) AS first_bucket,
              min(f.p50) FILTER (WHERE f.horizon_bucket >= ${at(currentHourMs)}) AS p50_min,
              max(f.p50) FILTER (WHERE f.horizon_bucket >= ${at(currentHourMs)}) AS p50_max,
              (array_agg(f.horizon_bucket ORDER BY f.p50 DESC, f.horizon_bucket)
                 FILTER (WHERE f.horizon_bucket >= ${at(currentHourMs)}))[1] AS p50_peak_at
         FROM ml.forecasts f
        WHERE f.asset_id = c.asset_id AND f.point_key = c.point_key
          AND f.model_run_id = c.model_run_id AND f.horizon_bucket >= ${at(since)}
     ) agg
      JOIN bms.assets a ON a.id = c.asset_id
      JOIN bms.locations l ON l.id = a.location_id
      LEFT JOIN bms.rtus rtu ON rtu.id = a.rtu_id
      LEFT JOIN bms.organizations o ON o.id = a.organization_id
      LEFT JOIN bms.asset_points ap ON ap.asset_id = c.asset_id AND ap.point_key = c.point_key
     ORDER BY l.name, a.code, c.point_key`;
}

/** Runs {@link forecastListStatement} on `tx`: one row per point with a current run among `ids`. */
export async function readForecastList(
  tx: BmsTx,
  ids: readonly string[] | null,
  currentHourMs: number,
): Promise<ForecastListDbRow[]> {
  const result = await tx.execute<ForecastListDbRow>(forecastListStatement(ids, currentHourMs));
  return result.rows;
}

/**
 * `E1.4e` / ADR 0135 Amendment 4 — the past-forecast read: for each whole hour
 * `t` in `[fromHourMs, endMs)`, the p50 of the forecast for bucket `t` that was
 * issued **before `t`** and no more than `PAST_FORECAST_MAX_LEAD_HOURS` before
 * it, from a succeeded run; the newest such issue when several qualify. A row
 * issued once its hour had begun is never used (it saw part of the hour it
 * forecasts), and an hour with no qualifying row has no row here (a gap).
 *
 * `DISTINCT ON (horizon_bucket) … ORDER BY horizon_bucket, issued_at DESC` walks
 * `forecasts_pkey (asset_id, point_key, horizon_bucket, issued_at)` for one point
 * over the window. The service has already clipped `endMs` to the current hour
 * (`pastForecastWindowOf`), so the live forecast's hours never appear.
 * Parameterised throughout, times out as epoch ms; the lead is bound as a number.
 */
export function pastForecastStatement(
  point: { assetId: string; pointKey: string },
  fromHourMs: number,
  endMs: number,
): SQL {
  return sql`
    SELECT DISTINCT ON (f.horizon_bucket)
           (extract(epoch FROM f.horizon_bucket) * 1000)::float8 AS bucket_ms,
           f.p50
      FROM ml.forecasts f
      JOIN ml.model_runs r ON r.id = f.model_run_id AND r.organization_id = f.organization_id
                          AND r.status = 'succeeded'
     WHERE f.asset_id = ${point.assetId}::uuid AND f.point_key = ${point.pointKey}
       AND f.horizon_bucket >= ${at(fromHourMs)} AND f.horizon_bucket < ${at(endMs)}
       AND f.issued_at < f.horizon_bucket
       AND f.issued_at >= f.horizon_bucket - make_interval(hours => ${PAST_FORECAST_MAX_LEAD_HOURS}::int)
     ORDER BY f.horizon_bucket, f.issued_at DESC`;
}

/** Runs {@link pastForecastStatement} on `tx`: one row per past bucket with a qualifying forecast, ascending. */
export async function readPastForecast(
  tx: BmsTx,
  point: { assetId: string; pointKey: string },
  fromHourMs: number,
  endMs: number,
): Promise<PastForecastDbRow[]> {
  const result = await tx.execute<PastForecastDbRow>(pastForecastStatement(point, fromHourMs, endMs));
  return result.rows;
}
