import type { Pool } from "pg";

import type { AggregateLevel, EnergyHeatmapCell, EnergySiteEnergy, EnergySiteTrend } from "@bms/shared";

import { aggregateRelation, avgExpr, bucketHours } from "../telemetry/point-aggregates";
import type { BaselineWindow, EntityWindowRow } from "./energy-abnormal";
import { displayGroupExpr } from "./energy-view-read";

/**
 * `F4.299` U3 (ADR 0108 Amendment 1, 7.4–7.8) — the SQL reads of the four
 * organization views, each one statement over one aggregate level.
 *
 * **A site is the asset's own `location_id`** (`NOT NULL`, ADR 0018), named by
 * `bms.locations.name` through `INNER JOIN bms.locations l ON l.id =
 * a.location_id` — never `assets.site_name`, the denormalised text the
 * preview's top consumers carry. One row per location, no roll-up.
 *
 * **The asset-id bound (decision 5.3).** Telemetry has no RLS: the asset filter
 * is the isolation control. Every read takes `assetIds: readonly string[]` —
 * the frame's explicit list, never `null` — and carries `= ANY($n::uuid[])`
 * with no `IS NULL OR` leg, on the aggregate and again on `bms.assets`. An
 * empty list returns the empty result before any statement runs.
 *
 * **kWh** is the `energyPeriodRead` definition: Σ over read-level buckets of
 * the summed per-asset mean kW × `bucketHours(level)`, so the sites' kWh and
 * the heatmap's cells each sum to the period's `totalKwh`. Figures are
 * unrounded; the service rounds what it sends.
 *
 * Every read joins `bms.assets` (`F4.159`: no foreign key holds telemetry to
 * `bms.assets`), so it runs on the fleet pool, as the other reports reads do.
 * Read-only: nothing here writes (ruling 4.7).
 */

type Queryable = Pick<Pool, "query">;

function relationFor(level: AggregateLevel): string {
  const relation = aggregateRelation(level);
  if (relation === undefined) {
    throw new Error(`energy organization views: no aggregate relation for level ${String(level)}`);
  }
  return relation;
}

function positiveInt(value: number): number {
  return Math.max(1, Math.floor(Number.isFinite(value) ? value : 1));
}

function isoOf(value: Date | string): string {
  return new Date(value).toISOString();
}

// ---------------------------------------------------------------------------
// Sites ranked (7.4)
// ---------------------------------------------------------------------------

export type SiteEnergyReadInput = {
  readonly level: AggregateLevel;
  readonly start: Date;
  readonly end: Date;
  readonly assetIds: readonly string[];
  /** The rows sent, top by kWh; at least 1. */
  readonly limit: number;
  /** The compare path: only these locations (the current period's rows). */
  readonly locationIds?: readonly string[];
};

export type SiteEnergyRead = {
  /** By kWh desc, then name, then id; at most `limit`. */
  readonly sites: EnergySiteEnergy[];
  /** The sites with a `kw` row in the period, before the cut. */
  readonly totalSites: number;
};

/**
 * Per site: kWh, the peak of its summed kW with the bucket (the earliest on a
 * tie), and the count of its assets with data. A site is listed only when it
 * has a `kw` row in the period, so presence is `hasData` (ruling 4.6).
 */
export async function siteEnergyRead(pool: Queryable, input: SiteEnergyReadInput): Promise<SiteEnergyRead> {
  const relation = relationFor(input.level);
  if (input.assetIds.length === 0 || (input.locationIds !== undefined && input.locationIds.length === 0)) {
    return { sites: [], totalSites: 0 };
  }
  const params: unknown[] = [
    input.start,
    input.end,
    [...input.assetIds],
    bucketHours(input.level),
    positiveInt(input.limit),
  ];
  let locationFilter = "";
  if (input.locationIds !== undefined) {
    params.push([...input.locationIds]);
    locationFilter = "AND l.id = ANY($6::uuid[])";
  }

  const r = await pool.query<{
    location_id: string;
    name: string;
    asset_count: number | string;
    kwh: number | string;
    peak_kw: number | string;
    peak_at: Date | string | null;
    total_sites: number | string;
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
    site_bucket AS (
      SELECT l.id AS location_id, per.bucket, SUM(per.kw)::float8 AS kw, count(DISTINCT per.asset_id)::int AS assets
      FROM per
      INNER JOIN bms.assets a ON a.id = per.asset_id
      INNER JOIN bms.locations l ON l.id = a.location_id
      WHERE a.id = ANY($3::uuid[])
        ${locationFilter}
      GROUP BY l.id, per.bucket
    ),
    site_assets AS (
      SELECT a.location_id, count(DISTINCT per.asset_id)::int AS asset_count
      FROM per
      INNER JOIN bms.assets a ON a.id = per.asset_id
      WHERE a.id = ANY($3::uuid[])
      GROUP BY a.location_id
    ),
    site AS (
      SELECT
        sb.location_id,
        (SUM(sb.kw) * $4::float8)::float8 AS kwh,
        MAX(sb.kw)::float8 AS peak_kw,
        (array_agg(sb.bucket ORDER BY sb.kw DESC, sb.bucket ASC))[1] AS peak_at
      FROM site_bucket sb
      GROUP BY sb.location_id
    )
    SELECT
      s.location_id,
      l.name,
      sa.asset_count,
      s.kwh,
      s.peak_kw,
      s.peak_at,
      (count(*) OVER ())::int AS total_sites
    FROM site s
    INNER JOIN bms.locations l ON l.id = s.location_id
    INNER JOIN site_assets sa ON sa.location_id = s.location_id
    ORDER BY s.kwh DESC, l.name ASC, l.id ASC
    LIMIT $5
    `,
    params,
  );
  return {
    sites: r.rows.map((row) => ({
      locationId: row.location_id,
      name: row.name,
      assetCount: Number(row.asset_count),
      kwh: Number(row.kwh),
      peakKw: Number(row.peak_kw),
      peakAt: row.peak_at === null ? null : isoOf(row.peak_at),
    })),
    totalSites: Number(r.rows[0]?.total_sites ?? 0),
  };
}

// ---------------------------------------------------------------------------
// The total trend by site (7.5)
// ---------------------------------------------------------------------------

export type SiteSeriesReadInput = {
  readonly level: AggregateLevel;
  /** The display bucket: the level, or `1d` over a `1h` level (a local day). */
  readonly bucket: AggregateLevel;
  /** The zone a `1d` bucket is a day of. Unused by other buckets. */
  readonly timeZone: string;
  readonly start: Date;
  readonly end: Date;
  readonly assetIds: readonly string[];
  /** The site columns sent; the rest fold into `other`. At least 1. */
  readonly siteLimit: number;
};

/** `$5` is the zone, bound only for the `1d`-over-`1h` grouping. */
const SERIES_ZONE_PARAM = 5;

/**
 * One aligned grid over the display bucket. Columns: the top `siteLimit` sites
 * by kWh (ties: name, then id), then `other` — only when more sites have data —
 * holding the rest, folded here. A point's value per column is the column's
 * summed kW over the display bucket's read buckets ÷ the count of read buckets
 * with any data in it — the `energyPeriodRead` series' mean — so the columns of
 * a point sum to that series' total. Zeros, never holes.
 */
export async function siteSeriesRead(pool: Queryable, input: SiteSeriesReadInput): Promise<EnergySiteTrend> {
  const groupExpr = displayGroupExpr(input.level, input.bucket, SERIES_ZONE_PARAM);
  const relation = relationFor(input.level);
  if (input.assetIds.length === 0) {
    return { columns: [], points: [] };
  }
  const siteLimit = positiveInt(input.siteLimit);
  const params: unknown[] = [input.start, input.end, [...input.assetIds], siteLimit];
  if (groupExpr !== "agg.bucket") {
    params.push(input.timeZone);
  }

  const r = await pool.query<{
    columns: { location_id: string; name: string; rn: number }[] | null;
    site_count: number | string | null;
    buckets: { t: string; n: number }[] | null;
    cells: { t: string; col: number; kw: number }[] | null;
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
    site_bucket AS (
      SELECT l.id AS location_id, per.bucket, SUM(per.kw)::float8 AS kw
      FROM per
      INNER JOIN bms.assets a ON a.id = per.asset_id
      INNER JOIN bms.locations l ON l.id = a.location_id
      WHERE a.id = ANY($3::uuid[])
      GROUP BY l.id, per.bucket
    ),
    ranked AS (
      SELECT
        sb.location_id,
        l.name,
        row_number() OVER (ORDER BY SUM(sb.kw) DESC, l.name ASC, l.id ASC) AS rn
      FROM site_bucket sb
      INNER JOIN bms.locations l ON l.id = sb.location_id
      GROUP BY sb.location_id, l.name, l.id
    ),
    read_bucket AS (
      SELECT DISTINCT bucket FROM site_bucket
    ),
    display_count AS (
      SELECT ${groupExpr} AS t, count(*)::int AS n
      FROM read_bucket agg
      GROUP BY 1
    ),
    cells AS (
      SELECT
        ${groupExpr} AS t,
        (CASE WHEN r.rn <= $4 THEN r.rn ELSE $4 + 1 END)::int AS col,
        SUM(agg.kw)::float8 AS kw
      FROM site_bucket agg
      INNER JOIN ranked r ON r.location_id = agg.location_id
      GROUP BY 1, 2
    )
    SELECT
      (SELECT json_agg(json_build_object('location_id', location_id, 'name', name, 'rn', rn) ORDER BY rn)
         FROM ranked WHERE rn <= $4) AS columns,
      (SELECT count(*) FROM ranked)::int AS site_count,
      (SELECT json_agg(json_build_object('t', t, 'n', n) ORDER BY t) FROM display_count) AS buckets,
      (SELECT json_agg(json_build_object('t', t, 'col', col, 'kw', kw)) FROM cells) AS cells
    `,
    params,
  );
  const row = r.rows[0];
  const siteColumns = row?.columns ?? [];
  if (!row || siteColumns.length === 0) {
    return { columns: [], points: [] };
  }
  const columns: EnergySiteTrend["columns"] = siteColumns.map((c) => ({
    kind: "site" as const,
    locationId: c.location_id,
    name: c.name,
  }));
  if (Number(row.site_count ?? 0) > siteLimit) {
    columns.push({ kind: "other" });
  }
  const sums = new Map<string, number[]>();
  for (const cell of row.cells ?? []) {
    const t = isoOf(cell.t);
    const kw = sums.get(t) ?? new Array<number>(columns.length).fill(0);
    // `col` is 1-based; the `other` fold is `siteLimit + 1`, the last column.
    const index = Number(cell.col) - 1;
    if (index >= 0 && index < columns.length) kw[index] = (kw[index] ?? 0) + Number(cell.kw);
    sums.set(t, kw);
  }
  const points = (row.buckets ?? []).map((b) => {
    const t = isoOf(b.t);
    const n = Number(b.n);
    const kw = sums.get(t) ?? new Array<number>(columns.length).fill(0);
    return { t, kw: kw.map((sum) => (n > 0 ? sum / n : 0)) };
  });
  return { columns, points };
}

// ---------------------------------------------------------------------------
// The day x hour heatmap (7.6)
// ---------------------------------------------------------------------------

export type HeatmapReadInput = {
  readonly level: AggregateLevel;
  /** The arithmetic zone (`Etc/UTC` for a stored `UTC`). Bound, never interpolated. */
  readonly timeZone: string;
  readonly start: Date;
  readonly end: Date;
  readonly assetIds: readonly string[];
};

/**
 * One cell per (local date, local hour) in the zone: Σ over the read-level
 * buckets whose **start** falls in that local hour of the summed kW ×
 * `bucketHours(level)`. A 25-hour day sums its two repeated-hour buckets into
 * one cell; a 23-hour day has no cell for its missing hour; a half-hour zone
 * puts a UTC-aligned bucket in the local hour of its start (decision 2.12).
 * Ordered by day, then hour.
 */
export async function heatmapRead(pool: Queryable, input: HeatmapReadInput): Promise<EnergyHeatmapCell[]> {
  const relation = relationFor(input.level);
  if (input.assetIds.length === 0) {
    return [];
  }
  const r = await pool.query<{ day: string; hour: number | string; kwh: number | string }>(
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
      SELECT per.bucket, SUM(per.kw)::float8 AS kw
      FROM per
      INNER JOIN bms.assets a ON a.id = per.asset_id
      INNER JOIN bms.locations l ON l.id = a.location_id
      WHERE a.id = ANY($3::uuid[])
      GROUP BY per.bucket
    )
    SELECT
      to_char(agg.bucket AT TIME ZONE $5::text, 'YYYY-MM-DD') AS day,
      extract(hour FROM agg.bucket AT TIME ZONE $5::text)::int AS hour,
      (SUM(agg.kw) * $4::float8)::float8 AS kwh
    FROM agg
    GROUP BY 1, 2
    ORDER BY 1, 2
    `,
    [input.start, input.end, [...input.assetIds], bucketHours(input.level), input.timeZone],
  );
  return r.rows.map((row) => ({ day: row.day, hour: Number(row.hour), kwh: Number(row.kwh) }));
}

// ---------------------------------------------------------------------------
// The abnormal list's windows (7.7)
// ---------------------------------------------------------------------------

export type EntityWindowReadsInput = {
  readonly level: AggregateLevel;
  /** `idx 0` is the current period, `1..n` the baseline windows within the horizon. */
  readonly windows: readonly BaselineWindow[];
  readonly assetIds: readonly string[];
};

/**
 * One row per (asset, window) and per (site, window) with data: the kWh (the
 * 7.4 definition) and the **distinct** read-bucket count in that window. One
 * statement over `GROUPING SETS`; the windows are bound as three parallel
 * arrays and unnested, so no window value is interpolated. A window with no
 * data for an entity has no row. A site row carries the location id as `id`
 * and as `locationId`, with `code` and `siteName` `null`; an asset row carries
 * its location's name as `siteName`.
 */
export async function entityWindowReads(pool: Queryable, input: EntityWindowReadsInput): Promise<EntityWindowRow[]> {
  const relation = relationFor(input.level);
  if (input.assetIds.length === 0 || input.windows.length === 0) {
    return [];
  }
  const r = await pool.query<{
    is_site: boolean;
    idx: number | string;
    asset_id: string | null;
    location_id: string;
    code: string | null;
    asset_name: string | null;
    site_name: string;
    kwh: number | string;
    bucket_count: number | string;
  }>(
    `
    WITH w AS (
      SELECT * FROM unnest($1::int[], $2::timestamptz[], $3::timestamptz[]) AS w(idx, ws, we)
    ),
    per AS (
      SELECT w.idx, v.bucket, v.asset_id, ${avgExpr("v")} AS kw
      FROM w
      INNER JOIN ${relation} v ON v.bucket >= w.ws AND v.bucket <= w.we
      WHERE v.point_key = 'kw'
        AND v.asset_id = ANY($4::uuid[])
      GROUP BY 1, 2, 3
    )
    SELECT
      (GROUPING(a.id) = 1) AS is_site,
      per.idx,
      a.id AS asset_id,
      l.id AS location_id,
      a.code,
      a.name AS asset_name,
      l.name AS site_name,
      (SUM(per.kw) * $5::float8)::float8 AS kwh,
      count(DISTINCT per.bucket)::int AS bucket_count
    FROM per
    INNER JOIN bms.assets a ON a.id = per.asset_id
    INNER JOIN bms.locations l ON l.id = a.location_id
    WHERE a.id = ANY($4::uuid[])
    GROUP BY GROUPING SETS ((per.idx, a.id, a.code, a.name, l.id, l.name), (per.idx, l.id, l.name))
    `,
    [
      input.windows.map((w) => w.idx),
      input.windows.map((w) => w.start.toISOString()),
      input.windows.map((w) => w.end.toISOString()),
      [...input.assetIds],
      bucketHours(input.level),
    ],
  );
  return r.rows.map((row): EntityWindowRow => {
    const common = {
      locationId: row.location_id,
      idx: Number(row.idx),
      kwh: Number(row.kwh),
      bucketCount: Number(row.bucket_count),
    };
    if (row.is_site || row.asset_id === null) {
      return { kind: "site", id: row.location_id, code: null, name: row.site_name, siteName: null, ...common };
    }
    return {
      kind: "asset",
      id: row.asset_id,
      code: row.code,
      name: row.asset_name ?? row.code ?? row.asset_id,
      siteName: row.site_name,
      ...common,
    };
  });
}
