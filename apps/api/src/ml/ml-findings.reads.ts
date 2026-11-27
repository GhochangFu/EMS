import { sql, type SQL } from "drizzle-orm";

import type { BmsTx } from "../database/tenant-context";
import type { ActualMeanDbRow, ForecastFindingDbRow, ThresholdRuleDbRow } from "./ml-findings.forecast-facts";
import type { FindingOrganizationDbRow } from "./ml-findings.lines";
import { HOUR_MS, lookBackStartOf } from "./ml-forecasts.pure";
import { currentForecastRunsCte, uuidArray } from "./ml-forecasts.reads";

/**
 * `E1.9a` / ADR 0135 Amendment 8 decisions 2, 3 and 10 (plan T1.5, §2.3) — the
 * forecast findings SQL: the band and peak of each current forecast point, its
 * 24 h `_1h` mean, the covered rules of each point, and the Q1(a) organization
 * read. The anomaly findings read lives in `ml-anomalies.reads.ts`, the one
 * family of files that may name the scores table.
 *
 * **Every function takes the `tx` that `withReadScope` hands it, and nothing
 * else.** On the tenant branch the transaction carries the
 * `app.current_organization` GUC, so the row policies scope every row; on the
 * fleet branch (`bms_fleet`, `BYPASSRLS`) the `asset_id = ANY(ids)` line of the
 * list's own run chain is the isolation control, chosen by `ids === null`. The
 * means and rule reads take the first read's own `(asset, point)` pairs, which
 * are already inside the caller's scope; the rule read carries the organization
 * by hand (`a.organization_id = r.organization_id`, ADR 0059 decision 9), so a
 * rule whose organization is not its asset's never reaches a line on either
 * branch. The severity is never selected.
 *
 * Times cross as epoch milliseconds; every value is a bound parameter; every
 * output column is aliased. Each lateral keeps its `OFFSET 0` fence (R4).
 */

const at = (ms: number): SQL => sql`to_timestamp(${ms}::float8 / 1000)`;

/** The forecast window: 48 whole hours from the current UTC hour (plan §4.1). */
export const FINDINGS_HORIZON_HOURS = 48;

/**
 * One `text[]` literal, every element double-quoted with `\` and `"` escaped, so a point key
 * holding `,`, `{`, `}` or `"` stays one element. Bound as a parameter, never spliced.
 */
export function textArray(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

/** One row per current forecast point and bucket among `ids`, the buckets of the next 48 hours. */
export function forecastFindingsStatement(ids: readonly string[] | null, currentHourMs: number): SQL {
  const since = lookBackStartOf(currentHourMs);
  const end = currentHourMs + FINDINGS_HORIZON_HOURS * HOUR_MS;
  return sql`
    ${currentForecastRunsCte(ids, currentHourMs)}
    SELECT c.asset_id AS asset_id, c.point_key AS point_key,
           (extract(epoch FROM c.issued_at) * 1000)::float8 AS issued_ms,
           (extract(epoch FROM fb.first_bucket) * 1000)::float8 AS first_bucket_ms,
           (extract(epoch FROM f.horizon_bucket) * 1000)::float8 AS bucket_ms,
           f.p10 AS p10, f.p50 AS p50, f.p90 AS p90,
           a.organization_id AS organization_id, o.code AS organization_code, o.name AS organization_name,
           a.code AS asset_code, rtu.display_name AS asset_rtu_name, l.name AS location_name,
           l.timezone AS location_time_zone, o.timezone AS organization_time_zone, ap.unit AS unit
      FROM current_runs c
     CROSS JOIN LATERAL (
       SELECT f2.horizon_bucket AS first_bucket
         FROM ml.forecasts f2
        WHERE f2.asset_id = c.asset_id AND f2.point_key = c.point_key AND f2.issued_at = c.issued_at
          AND f2.horizon_bucket >= ${at(since)}
        ORDER BY f2.horizon_bucket
       LIMIT 1 OFFSET 0
     ) fb
     CROSS JOIN LATERAL (
       SELECT f1.horizon_bucket, f1.p10, f1.p50, f1.p90
         FROM ml.forecasts f1
        WHERE f1.asset_id = c.asset_id AND f1.point_key = c.point_key AND f1.issued_at = c.issued_at
          AND f1.horizon_bucket >= ${at(currentHourMs)} AND f1.horizon_bucket < ${at(end)}
       OFFSET 0
     ) f
      JOIN bms.assets a ON a.id = c.asset_id
      JOIN bms.locations l ON l.id = a.location_id
      LEFT JOIN bms.rtus rtu ON rtu.id = a.rtu_id
      LEFT JOIN bms.organizations o ON o.id = a.organization_id
      LEFT JOIN bms.asset_points ap ON ap.asset_id = c.asset_id AND ap.point_key = c.point_key
     ORDER BY c.asset_id, c.point_key, f.horizon_bucket`;
}

/** Runs {@link forecastFindingsStatement} on `tx`. */
export async function readForecastFindings(
  tx: BmsTx,
  ids: readonly string[] | null,
  currentHourMs: number,
): Promise<ForecastFindingDbRow[]> {
  const result = await tx.execute<ForecastFindingDbRow>(forecastFindingsStatement(ids, currentHourMs));
  return result.rows;
}

export type FindingPointPair = { readonly assetId: string; readonly pointKey: string };

const pairArrays = (pairs: readonly FindingPointPair[]) => ({
  assetIds: uuidArray(pairs.map((p) => p.assetId)),
  pointKeys: textArray(pairs.map((p) => p.pointKey)),
});

/**
 * The 24 h mean of each pair's `_1h` actuals before the current hour, and how many of those
 * hours hold a sample (F3 leaves out a point with fewer than 12).
 */
export function actualMeansStatement(pairs: readonly FindingPointPair[], currentHourMs: number): SQL {
  const { assetIds, pointKeys } = pairArrays(pairs);
  return sql`
    SELECT v.asset_id AS asset_id, v.point_key AS point_key,
           (sum(v.sum_value) / NULLIF(sum(v.sample_count), 0))::float8 AS mean_24h,
           (count(*) FILTER (WHERE v.sample_count > 0))::int AS hours
      FROM unnest(${assetIds}::uuid[], ${pointKeys}::text[]) AS p(asset_id, point_key)
      JOIN telemetry.point_values_1h v ON v.asset_id = p.asset_id AND v.point_key = p.point_key
     WHERE v.bucket >= ${at(currentHourMs - 24 * HOUR_MS)} AND v.bucket < ${at(currentHourMs)}
     GROUP BY v.asset_id, v.point_key`;
}

/** Runs {@link actualMeansStatement} on `tx`; no pair reads nothing. */
export async function readActualMeans(
  tx: BmsTx,
  pairs: readonly FindingPointPair[],
  currentHourMs: number,
): Promise<ActualMeanDbRow[]> {
  if (pairs.length === 0) return [];
  const result = await tx.execute<ActualMeanDbRow>(actualMeansStatement(pairs, currentHourMs));
  return result.rows;
}

/** The covered threshold rules of each pair (decision 3), the organization carried by hand. */
export function thresholdRulesStatement(pairs: readonly FindingPointPair[]): SQL {
  const { assetIds, pointKeys } = pairArrays(pairs);
  return sql`
    SELECT r.id AS rule_id, r.asset_id AS asset_id, r.point_key AS point_key, r.name AS rule_name,
           r.operator AS operator, r.threshold_value AS threshold_value, r.condition ->> 'unit' AS rule_unit,
           r.rule_type AS rule_type, r.condition ->> 'window' AS rule_window
      FROM unnest(${assetIds}::uuid[], ${pointKeys}::text[]) AS p(asset_id, point_key)
      JOIN bms.automation_rules r ON r.asset_id = p.asset_id AND r.point_key = p.point_key
      JOIN bms.assets a ON a.id = r.asset_id AND a.organization_id = r.organization_id
     WHERE r.rule_type = 'threshold' AND r.enabled AND r.lifecycle_status = 'published'
       AND r.operator IN ('gt', 'gte', 'lt', 'lte') AND r.threshold_value IS NOT NULL
       AND r.condition ->> 'window' = 'latest'
     ORDER BY r.asset_id, r.point_key, r.name, r.id`;
}

/** Runs {@link thresholdRulesStatement} on `tx`; no pair reads nothing. */
export async function readThresholdRules(tx: BmsTx, pairs: readonly FindingPointPair[]): Promise<ThresholdRuleDbRow[]> {
  if (pairs.length === 0) return [];
  const result = await tx.execute<ThresholdRuleDbRow>(thresholdRulesStatement(pairs));
  return result.rows;
}

/**
 * Q1(a) — the organizations among `ids` with any current forecast point, so the anomaly
 * summary gives each of them a card. The list's runs, one row per run (`LIMIT 1`, fenced),
 * then the distinct organizations with their code and name.
 */
export function forecastOrganizationsStatement(ids: readonly string[] | null, currentHourMs: number): SQL {
  const since = lookBackStartOf(currentHourMs);
  const assetFilter = ids === null ? sql`` : sql`AND f0.asset_id = ANY(${uuidArray(ids)}::uuid[])`;
  return sql`
    WITH recent_runs AS (
      SELECT r.id, r.organization_id
        FROM ml.model_runs r
       WHERE r.status = 'succeeded' AND r.started_at >= ${at(since)}
    )
    SELECT DISTINCT f.organization_id AS organization_id, o.code AS organization_code, o.name AS organization_name
      FROM recent_runs rr
     CROSS JOIN LATERAL (
       SELECT f0.organization_id
         FROM ml.forecasts f0
        WHERE f0.model_run_id = rr.id AND f0.organization_id = rr.organization_id
          AND f0.horizon_bucket = ${at(currentHourMs)}
          ${assetFilter}
       LIMIT 1 OFFSET 0
     ) f
      LEFT JOIN bms.organizations o ON o.id = f.organization_id`;
}

/** Runs {@link forecastOrganizationsStatement} on `tx`. */
export async function readForecastOrganizations(
  tx: BmsTx,
  ids: readonly string[] | null,
  currentHourMs: number,
): Promise<FindingOrganizationDbRow[]> {
  const result = await tx.execute<FindingOrganizationDbRow>(forecastOrganizationsStatement(ids, currentHourMs));
  return result.rows;
}
