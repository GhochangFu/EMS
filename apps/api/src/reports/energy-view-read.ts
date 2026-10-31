import type { Pool } from "pg";

import type { AggregateLevel, EnergySourceMixPoint, EnergyTopConsumer } from "@bms/shared";

import { nominalSourceSplit } from "../telemetry/energy-sources";
import { aggregateRelation, avgExpr, bucketHours } from "../telemetry/point-aggregates";

/**
 * `F4.298` U3 (ADR 0108 decisions 2.4, 2.5 and 2.10) — the energy view's SQL
 * reads, each over one period `[start, end]` (inclusive, the reports path's
 * `bucket >= $1 AND bucket <= $2` convention).
 *
 * **The asset-id bound.** Telemetry has no RLS: the asset filter is the
 * isolation control. `energyPeriodRead` and `averagePf` take
 * `assetIds: readonly string[]` — never `null` — and carry
 * `a.id = ANY($3::uuid[])` with no `IS NULL OR` leg. The view reaches the top
 * consumers only through {@link viewTopConsumers}, whose list is never `null`;
 * {@link topConsumersRead} keeps the preview's nullable leg because the preview
 * passes `null` for a global admin, and its SQL moved here byte for byte from
 * `ReportsService.energyTopConsumers` (decision 2.10). An empty list returns the
 * empty result before any statement runs.
 *
 * Every read joins `bms.assets` (`F4.159`: no foreign key holds telemetry to
 * `bms.assets`; only existing assets count), so it runs on the fleet pool, as
 * `ReportsService` does.
 */

type Queryable = Pick<Pool, "query">;

/** The display grouping of `energyPeriodRead`'s series: a closed two-member lookup, never caller text. */
const DISPLAY_GROUP = {
  /** The bucket is the read level's own bucket. */
  level: "agg.bucket",
  /** A `1d` bucket over `_1h`: the local day of `$5` (`point_values_1d` holds UTC days). */
  zoneDay: "time_bucket(INTERVAL '1 day', agg.bucket, $5::text)",
} as const;

export type EnergyPeriodReadInput = {
  /** The relation read. */
  readonly level: AggregateLevel;
  /** The display bucket of `series`: the level, or `1d` over a `1h` level. */
  readonly bucket: AggregateLevel;
  /** The zone a `1d` bucket is a day of: the arithmetic zone (`Etc/UTC` for a stored `UTC`). Unused by other buckets. */
  readonly timeZone: string;
  readonly start: Date;
  readonly end: Date;
  readonly assetIds: readonly string[];
};

export type EnergyPeriodRead = {
  /** One point per display bucket: the mean of the summed kW of its read-level buckets, split by source. */
  readonly series: EnergySourceMixPoint[];
  /** Σ per read-level bucket of the summed kW × `bucketHours(level)`. Unrounded. */
  readonly totalKwh: number;
  /** The `PV%` part of `totalKwh`. Unrounded. */
  readonly solarKwh: number;
  /** `MAX` over read-level buckets of the summed kW. Unrounded. */
  readonly peakKw: number;
  /** The read-level bucket of `peakKw` (the earliest on a tie); `null` with no data. */
  readonly peakAt: string | null;
  /** At least one `kw` bucket in the period. */
  readonly hasData: boolean;
};

const EMPTY_PERIOD: EnergyPeriodRead = {
  series: [],
  totalKwh: 0,
  solarKwh: 0,
  peakKw: 0,
  peakAt: null,
  hasData: false,
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function relationFor(level: AggregateLevel): string {
  const relation = aggregateRelation(level);
  if (relation === undefined) {
    throw new Error(`energy view: no aggregate relation for level ${String(level)}`);
  }
  return relation;
}

function displayGroupFor(level: AggregateLevel, bucket: AggregateLevel): keyof typeof DISPLAY_GROUP {
  if (bucket === level) {
    return "level";
  }
  if (bucket === "1d" && level === "1h") {
    return "zoneDay";
  }
  throw new Error(`energy view: a ${level} read cannot serve a ${bucket} bucket`);
}

/**
 * The period's kWh, solar kWh, peak with its time, and the display series, in
 * one statement: `per` (each asset's mean kW per read bucket) → `agg` (summed per
 * read bucket, with the existing `PV%` solar rule) → the display grouping.
 */
export async function energyPeriodRead(pool: Queryable, input: EnergyPeriodReadInput): Promise<EnergyPeriodRead> {
  const group = displayGroupFor(input.level, input.bucket);
  const relation = relationFor(input.level);
  if (input.assetIds.length === 0) {
    return EMPTY_PERIOD;
  }
  const params: unknown[] = [input.start, input.end, [...input.assetIds], bucketHours(input.level)];
  if (group === "zoneDay") {
    params.push(input.timeZone);
  }

  const r = await pool.query<{
    total_kwh: number | string | null;
    solar_kwh: number | string | null;
    peak_kw: number | string | null;
    peak_at: Date | string | null;
    bucket_count: number | string | null;
    series: { t: string; total_kw: number; solar_kw: number }[] | null;
  }>(
    `
    WITH per AS (
      SELECT v.bucket, v.asset_id, ${avgExpr("v")} AS kw
      FROM ${relation} v
      WHERE v.point_key = 'kw'
        AND v.bucket >= $1
        AND v.bucket <= $2
        AND v.asset_id = ANY($3::uuid[])
      GROUP BY 1, 2
    ),
    agg AS (
      SELECT
        per.bucket,
        SUM(per.kw)::float8 AS total_kw,
        COALESCE(SUM(per.kw) FILTER (WHERE a.code ILIKE 'PV%'), 0)::float8 AS solar_kw
      FROM per
      INNER JOIN bms.assets a ON a.id = per.asset_id
      WHERE a.id = ANY($3::uuid[])
      GROUP BY per.bucket
    ),
    display AS (
      SELECT ${DISPLAY_GROUP[group]} AS t, AVG(agg.total_kw)::float8 AS total_kw, AVG(agg.solar_kw)::float8 AS solar_kw
      FROM agg
      GROUP BY 1
    )
    SELECT
      (SELECT COALESCE(SUM(total_kw), 0) * $4::float8 FROM agg)::float8 AS total_kwh,
      (SELECT COALESCE(SUM(solar_kw), 0) * $4::float8 FROM agg)::float8 AS solar_kwh,
      (SELECT COALESCE(MAX(total_kw), 0) FROM agg)::float8 AS peak_kw,
      (SELECT (array_agg(bucket ORDER BY total_kw DESC, bucket ASC))[1] FROM agg) AS peak_at,
      (SELECT count(*) FROM agg)::int AS bucket_count,
      (SELECT json_agg(json_build_object('t', t, 'total_kw', total_kw, 'solar_kw', solar_kw) ORDER BY t) FROM display) AS series
    `,
    params,
  );
  const row = r.rows[0];
  if (!row || Number(row.bucket_count ?? 0) === 0) {
    return EMPTY_PERIOD;
  }
  const series = (row.series ?? []).map((point) => {
    const total = Number(point.total_kw);
    const solar = Number(point.solar_kw);
    const { dg, grid } = nominalSourceSplit(total, solar);
    return {
      t: new Date(point.t).toISOString(),
      gridKw: round2(grid),
      solarKw: round2(solar),
      dgKw: round2(dg),
    };
  });
  return {
    series,
    totalKwh: Number(row.total_kwh ?? 0),
    solarKwh: Number(row.solar_kwh ?? 0),
    peakKw: Number(row.peak_kw ?? 0),
    peakAt: row.peak_at === null ? null : new Date(row.peak_at).toISOString(),
    hasData: true,
  };
}

/**
 * The sample average of every `pf` point of the scoped assets in the period —
 * `avgExpr` over the read level, so it equals Σ value / count over the raw
 * samples (ADR 0108 decision 2.3; a kW-weighted PF is a later row). `null` when
 * the period holds no `pf` row.
 */
export async function averagePf(
  pool: Queryable,
  input: { readonly level: AggregateLevel; readonly start: Date; readonly end: Date; readonly assetIds: readonly string[] },
): Promise<number | null> {
  const relation = relationFor(input.level);
  if (input.assetIds.length === 0) {
    return null;
  }
  const r = await pool.query<{ avg_pf: number | string | null }>(
    `
    SELECT ${avgExpr("v")}::float8 AS avg_pf
    FROM ${relation} v
    INNER JOIN bms.assets a ON a.id = v.asset_id
    WHERE v.point_key = 'pf'
      AND v.bucket >= $1
      AND v.bucket <= $2
      AND a.id = ANY($3::uuid[])
    `,
    [input.start, input.end, [...input.assetIds]],
  );
  const value = r.rows[0]?.avg_pf;
  return value === null || value === undefined ? null : Number(value);
}

export type TopConsumersReadInput = {
  readonly level: AggregateLevel;
  readonly start: Date;
  readonly end: Date;
  /** The period length; `estimatedKwh` is the mean kW × this. */
  readonly durationHours: number;
  /** Clamped to 1–25. */
  readonly limit: number;
};

/**
 * The assets with the highest mean kW over the period. The SQL of
 * `ReportsService.energyTopConsumers`, moved byte for byte (ADR 0108 decision
 * 2.10), so `rollup-conversion.integration.spec.ts`'s parity holds unchanged.
 *
 * **No display bucket**: every row for an asset folds into one mean, so
 * `avgExpr` is the only correct form here (ADR 0025 facts 3 and 4).
 *
 * `assetIds: null` is the preview's global-admin path and keeps the nullable
 * `$4` leg. The energy view never calls this directly: it calls
 * {@link viewTopConsumers}, whose list is never `null`.
 */
export async function topConsumersRead(
  pool: Queryable,
  input: TopConsumersReadInput & { readonly assetIds: readonly string[] | null },
): Promise<EnergyTopConsumer[]> {
  if (input.assetIds && input.assetIds.length === 0) {
    return [];
  }
  const r = await pool.query<{
    id: string;
    code: string;
    name: string;
    site_name: string;
    avg_kw: string;
  }>(
    `
      SELECT
        a.id,
        a.code,
        a.name,
        a.site_name,
        ${avgExpr("v")}::float8 AS avg_kw
      FROM ${aggregateRelation(input.level)} v
      INNER JOIN bms.assets a ON a.id = v.asset_id
      WHERE v.point_key = 'kw'
        AND v.bucket >= $1
        AND v.bucket <= $2
        AND ($4::uuid[] IS NULL OR a.id = ANY($4::uuid[]))
      GROUP BY a.id, a.code, a.name, a.site_name
      ORDER BY avg_kw DESC
      LIMIT $3
      `,
    [
      input.start,
      input.end,
      Math.min(25, Math.max(1, input.limit)),
      input.assetIds === null ? null : [...input.assetIds],
    ],
  );
  return r.rows.map((row) => {
    const avgKw = Number(row.avg_kw);
    return {
      assetId: row.id,
      code: row.code,
      name: row.name,
      siteName: row.site_name,
      avgKw: round2(avgKw),
      estimatedKwh: round2(avgKw * input.durationHours),
    };
  });
}

/**
 * The energy view's top consumers: {@link topConsumersRead} with the scope's
 * explicit list bound as `$4`, never `null`. An empty list returns `[]` with no
 * statement.
 */
export async function viewTopConsumers(
  pool: Queryable,
  input: TopConsumersReadInput & { readonly assetIds: readonly string[] },
): Promise<EnergyTopConsumer[]> {
  if (input.assetIds.length === 0) {
    return [];
  }
  return topConsumersRead(pool, input);
}
