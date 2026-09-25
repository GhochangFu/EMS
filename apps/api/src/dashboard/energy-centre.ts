import { BadRequestException } from "@nestjs/common";
import type { Pool } from "pg";
import type { EnergyCentreSummary } from "@bms/shared";

import type { CalcParametersService } from "../calc/calc-parameters.service";
import {
  aggregateRelation,
  avgExpr,
  bucketHours,
  levelForRange,
} from "../telemetry/point-aggregates";
import { energyCost, perAssetEnergy, resolveTariffs } from "../telemetry/energy-cost";
import { windowedPueRatio } from "../telemetry/pue-ratio";

/**
 * The Energy Centre reads — `energySummary`, `energySourceMix`,
 * `energyTopConsumers` — and the window parsing they share. Moved out of
 * `dashboard.service.ts` unchanged by `F4.159`, because that file sat at 994
 * of AGENTS.md §4.5's 1000 lines; `DashboardService` keeps one delegating
 * method per read, so the controller and every spec still call the service.
 * `pool` is the service's `FLEET_POOL` (ADR 0043), and the `assetIds` scope
 * is the isolation control, as it was in the service.
 */

/** What `energySummary` needs from the service: its pool and its tariff resolver (`E4.1c`). */
export interface EnergyCentreDeps {
  readonly pool: Pool;
  readonly parameters: Pick<CalcParametersService, "resolveForAssets">;
}

/**
 * Energy Centre: `Nh` or `Nd` windows; hourly buckets when >= 48h or any day-based window.
 */
export function parseEnergyWindow(raw?: string): {
  intervalSql: string;
  useHourlyBuckets: boolean;
  windowLabel: string;
  durationHours: number;
} {
  const w = (raw ?? "24h").trim().toLowerCase();
  const m = /^(\d+)(h|d)$/.exec(w);
  if (!m) {
    throw new BadRequestException(
      'Invalid energy window; use "24h", "7d", or "30d" style (hours or days only)',
    );
  }
  const n = Number(m[1]);
  const u = m[2];
  if (u === "h") {
    if (n < 1 || n > 168) {
      throw new BadRequestException("Energy window: 1–168 hours");
    }
    return {
      intervalSql: `${n} hours`,
      useHourlyBuckets: n >= 48,
      windowLabel: w,
      durationHours: n,
    };
  }
  if (n < 1 || n > 30) {
    throw new BadRequestException("Energy window: 1–30 days");
  }
  return {
    intervalSql: `${n} days`,
    useHourlyBuckets: true,
    windowLabel: w,
    durationHours: n * 24,
  };
}

export async function energySummary(
  { pool, parameters }: EnergyCentreDeps,
  windowRaw?: string, assetIds?: string[] | null): Promise<EnergyCentreSummary> {
  const { intervalSql, useHourlyBuckets, windowLabel, durationHours } =
    parseEnergyWindow(windowRaw);
  if (assetIds && assetIds.length === 0) {
    return {
      window: windowLabel,
      totalKwh: 0,
      peakKw: 0,
      pueEstimate: null,
      // `E4.1c` — an empty scope has no cost, no tariff and no currency
      // (`energy-cost.ts`, the three fail-closed rules).
      indicativeCost: null,
      tariffPerKwh: null,
      currency: null,
      asOf: new Date().toISOString(),
    };
  }
  // ADR 0023 (`F4.1`) — this reads the continuous aggregates, not raw
  // `point_values`. Measured 2026-08-10 on the pilot database: 144.7 ms → 11.8
  // ms cold, 32.7 → 5.4 ms warm for the hourly window.
  //
  // The mean is `sum(sum_value) / sum(sample_count)` via `avgExpr`, never an
  // average of averages — over these same five days the naive form was wrong
  // in 151 of 169 buckets while still agreeing on the window total. Do not
  // "simplify" it.
  //
  // The newest bucket stays correct because migration `0027` sets
  // `materialized_only = false`, so the view unions its stored rows with a
  // live aggregate over the un-materialized tail. That branch is exact
  // (7.1e-14 against raw, three levels deep) — the aggregate is not an
  // approximation of the raw query, it is the same number.
  //
  // ADR 0025 decision 2 (`F4.28`): the level now comes from `levelForRange`
  // rather than the inline ternary this line used to be. Same answer for every
  // window this method can produce — `parseEnergyWindow` caps at 168 hours OR 30
  // days, so 720 hours is the real bound, still three orders of magnitude inside
  // `_1m`'s 735-day horizon — but there is now exactly one implementation of level
  // choice, and it is the one carrying the retention guard.
  // Hoisted out of the `levelForRange` call because `F2.8`'s PUE read needs the
  // same instant. Note the two queries bound their windows differently and that
  // is deliberate: the kWh query keeps `bucket > now() - $1::interval` (the
  // **database** clock, unchanged from before this row), while `windowedPueRatio`
  // takes `bucket >= start` off the **application** clock. The two differ by the
  // round trip and never by a bucket at these widths, and unifying them would
  // mean rewriting a measured ADR 0025 query for no gain.
  const start = trailingStart(durationHours);
  const { level } = levelForRange({
    start,
    granularity: useHourlyBuckets ? "1h" : "1m",
  });
  const kwhFactor = bucketHours(level);

  const r = await pool.query<{
    total_kwh: string;
    peak_kw: string;
  }>(
    `
    WITH per AS (
      SELECT bucket, asset_id, ${avgExpr()} AS kw
      FROM ${aggregateRelation(level)}
      WHERE point_key = 'kw'
        AND bucket > now() - $1::interval
        AND ($3::uuid[] IS NULL OR asset_id = ANY($3::uuid[]))
      GROUP BY 1, 2
    ),
    agg AS (
      SELECT bucket, SUM(kw)::float8 AS total_kw FROM per GROUP BY bucket
    )
    SELECT
      COALESCE(SUM(total_kw) * $2::float8, 0) AS total_kwh,
      COALESCE(MAX(total_kw), 0) AS peak_kw
    FROM agg
    `,
    [intervalSql, kwhFactor, assetIds ?? null],
  );

  const row = r.rows[0];
  const totalKwh = row ? Number(row.total_kwh) : 0;
  const peakKw = row ? Number(row.peak_kw) : 0;

  // `E4.1c` (ADR 0070 decision 7) — the cost is Σ per-asset kWh × that asset's
  // nearest-scope `energy_tariff_per_kwh`, effective **now** (the window ends
  // now), in the organization's currency. The per-asset read uses the same
  // `now() - interval` bound as the total above, so the two describe the same
  // window. A missing tariff or a second currency in scope is `null`, not 0.
  const perAsset = await perAssetEnergy(pool, {
    level,
    window: { kind: "trailing", intervalSql },
    kwhFactor,
    assetIds: assetIds ?? null,
  });
  const cost = energyCost(perAsset, await resolveTariffs(parameters, perAsset, new Date()));

  return {
    window: windowLabel,
    totalKwh: Math.round(totalKwh * 100) / 100,
    peakKw: Math.round(peakKw * 100) / 100,
    // `avg_kw` is gone from the query above with the curve it fed — it had no
    // other reader (`energyTopConsumers` computes its own).
    pueEstimate: await windowedPueRatio(pool, {
      level,
      start,
      end: new Date(),
      assetIds: assetIds ?? null,
    }),
    ...cost,
    asOf: new Date().toISOString(),
  };
}

export async function energySourceMix(pool: Pool, windowRaw?: string, assetIds?: string[] | null): Promise<{
  points: { t: string; gridKw: number; solarKw: number; dgKw: number }[];
}> {
  const { intervalSql, useHourlyBuckets, durationHours } =
    parseEnergyWindow(windowRaw);
  if (assetIds && assetIds.length === 0) {
    return { points: [] };
  }
  // ADR 0025 (`F4.28`) site 2 — the level's own bucket width *is* the display
  // granularity, so `bucket` replaces `date_trunc('${trunc}', time)` and the
  // `trunc` string is gone entirely. That also removes an interpolated
  // identifier from the SQL, which §4.4 could never parameterise.
  //
  // Measured at parity per bucket over 29 hour buckets on both the total and
  // the solar series, worst error 1.7e-13 (ADR 0025 fact 1).
  const { level } = levelForRange({
    start: trailingStart(durationHours),
    granularity: useHourlyBuckets ? "1h" : "1m",
  });

  const r = await pool.query<{
    bucket: Date;
    total_kw: string;
    solar_kw: string;
  }>(
    `
    WITH per AS (
      SELECT bucket, asset_id, ${avgExpr()} AS kw
      FROM ${aggregateRelation(level)}
      WHERE point_key = 'kw'
        AND bucket > now() - $1::interval
        AND ($2::uuid[] IS NULL OR asset_id = ANY($2::uuid[]))
      GROUP BY 1, 2
    ),
    solar_ids AS (
      SELECT id FROM bms.assets
      WHERE code ILIKE 'PV%' AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
    ),
    tot AS (
      SELECT bucket, SUM(kw)::float8 AS total_kw FROM per GROUP BY bucket
    ),
    sol AS (
      SELECT p.bucket, SUM(p.kw)::float8 AS solar_kw
      FROM per p
      JOIN solar_ids s ON s.id = p.asset_id
      GROUP BY p.bucket
    )
    SELECT
      t.bucket,
      t.total_kw,
      COALESCE(s.solar_kw, 0)::float8 AS solar_kw
    FROM tot t
    LEFT JOIN sol s ON s.bucket = t.bucket
    ORDER BY t.bucket ASC
    `,
    [intervalSql, assetIds ?? null],
  );

  const points = r.rows.map((x) => {
    const totalKw = Number(x.total_kw);
    const solarKw = Number(x.solar_kw);
    const net = Math.max(totalKw - solarKw, 0);
    const dgKw = Math.min(net * 0.04, totalKw * 0.1);
    const gridKw = Math.max(net - dgKw, 0);
    return {
      t: new Date(x.bucket).toISOString(),
      gridKw: Math.round(gridKw * 100) / 100,
      solarKw: Math.round(solarKw * 100) / 100,
      dgKw: Math.round(dgKw * 100) / 100,
    };
  });

  return { points };
}

export async function energyTopConsumers(
  pool: Pool,
  windowRaw?: string,
  limit = 10,
  assetIds?: string[] | null,
): Promise<{
  consumers: {
    assetId: string;
    code: string;
    name: string;
    siteName: string;
    avgKw: number;
    estimatedKwh: number;
  }[];
}> {
  const { intervalSql, durationHours } = parseEnergyWindow(windowRaw);
  const lim = Math.min(25, Math.max(1, limit));
  if (assetIds && assetIds.length === 0) {
    return { consumers: [] };
  }

  // ADR 0025 (`F4.28`) site 3 — and the one dashboard site where `avgExpr`
  // earns its existence.
  //
  // There is **no display bucket** here: every source row for an asset folds
  // into one mean, measured at up to **1172** `_1m` rows per asset over 24 h
  // (ADR 0025 fact 2). So this is the shape where the naive average-of-averages
  // form is detectably wrong — measured wrong in **29 of 29** assets, worst
  // 0.0458 kW (fact 3) — unlike the fold-1 sites above, where both forms agree
  // and a parity test proves nothing about the expression.
  //
  // `sum(sum_value) / sum(sample_count)` over the window is exactly
  // `sum(value) / count(value)` over the same rows, so this is an algebraic
  // identity with the raw query rather than a close approximation: measured 0
  // mismatches across 29 assets, worst 1.4e-13.
  //
  // Granularity `1m` — the finest level, since nothing here displays buckets and
  // a coarser level would only lose precision at the window edge.
  const { level } = levelForRange({
    start: trailingStart(durationHours),
    granularity: "1m",
  });

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
    FROM ${aggregateRelation(level)} v
    INNER JOIN bms.assets a ON a.id = v.asset_id
    WHERE v.point_key = 'kw'
      AND v.bucket > now() - $1::interval
      AND ($3::uuid[] IS NULL OR a.id = ANY($3::uuid[]))
    GROUP BY a.id, a.code, a.name, a.site_name
    ORDER BY avg_kw DESC
    LIMIT $2
    `,
    [intervalSql, lim, assetIds ?? null],
  );

  return {
    consumers: r.rows.map((row) => {
      const avgKw = Number(row.avg_kw);
      const estimatedKwh = avgKw * durationHours;
      return {
        assetId: row.id,
        code: row.code,
        name: row.name,
        siteName: row.site_name,
        avgKw: Math.round(avgKw * 100) / 100,
        estimatedKwh: Math.round(estimatedKwh * 100) / 100,
      };
    }),
  };
}

/**
 * The `start` a trailing window reaches back to, for {@link levelForRange}.
 *
 * ADR 0025 decision 1: the retention guard is a function of `start` and `now`,
 * never of the range's end. Every dashboard window is trailing and capped at
 * **720 hours** — `parseEnergyWindow` allows `1-168h` or `1-30d`, and 30 days is
 * the larger of the two, so quoting 168 understates it — which is still far
 * inside every horizon, so no call here can escalate. The guard exists for the
 * reads that come later, and this keeps every site expressing its range the same
 * way.
 */
export function trailingStart(durationHours: number): Date {
  return new Date(Date.now() - durationHours * 3_600_000);
}
