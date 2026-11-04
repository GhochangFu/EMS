import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";

import { refreshAggregatesFrom } from "@bms/db";

import { inputKey } from "../calc/calc-batch";
import type { CalcInputSample } from "../calc/calc-inputs";
import { TENANT_POOL } from "../database/database.tokens";

/** One `(asset, point key)` a backfill reads history for. */
export type BackfillPair = { readonly assetId: string; readonly pointKey: string };

/**
 * `F4.311` PR 5a (ADR 0109 decision 7) — the backfill's three statements on
 * `telemetry.point_values`, which is unpolicied, so they run on `TENANT_POOL`
 * exactly as `CalcInputsService`'s and `CalcWindowsService`'s reads do.
 *
 * Range reads, not the live engine's "latest" reads: a chunk of up to 500
 * buckets needs every sample of every input inside `[first bucket −
 * max_input_age_seconds, last bucket]`, which `asOfIndex` then answers per
 * bucket. One lateral probe per pair (the shape `getLatestSamplesForPairs`
 * measured against `IN (unnest…)`), so each pair walks its own index range.
 *
 * Values only ever reach `assembleInputs`; nothing here logs a sample.
 */
@Injectable()
export class CalcBackfillReads {
  constructor(@Inject(TENANT_POOL) private readonly pool: Pool) {}

  /** Every sample of `pairs` with `fromMs ≤ time ≤ toMs`, ascending, keyed by `inputKey`. */
  async readSamples(
    pairs: readonly BackfillPair[],
    fromMs: number,
    toMs: number,
  ): Promise<Map<string, CalcInputSample[]>> {
    const out = new Map<string, CalcInputSample[]>();
    const distinct = new Map<string, BackfillPair>();
    for (const pair of pairs) {
      distinct.set(inputKey(pair.assetId, pair.pointKey), pair);
    }
    if (distinct.size === 0) {
      return out;
    }
    const wanted = [...distinct.values()];
    const { rows } = await this.pool.query<{ asset_id: string; point_key: string; value: number; time: Date }>(
      `SELECT p.asset_id, p.point_key, s.value, s.time
         FROM unnest($1::uuid[], $2::varchar[]) AS p(asset_id, point_key)
         CROSS JOIN LATERAL (
           SELECT v.value, v.time
             FROM telemetry.point_values v
            WHERE v.asset_id = p.asset_id
              AND v.point_key = p.point_key
              AND v.time >= $3::timestamptz
              AND v.time <= $4::timestamptz
            ORDER BY v.time
         ) s`,
      [wanted.map((p) => p.assetId), wanted.map((p) => p.pointKey), new Date(fromMs), new Date(toMs)],
    );
    for (const row of rows) {
      const key = inputKey(row.asset_id, row.point_key);
      const list = out.get(key) ?? [];
      list.push({ value: row.value, timeMs: new Date(row.time).getTime() });
      out.set(key, list);
    }
    return out;
  }

  /**
   * A streaming point's evaluation instants (ADR 0109 decision 7, last
   * sentence): the distinct stored times of its inputs with `fromMs ≤ time <
   * toMs`, ascending, at most `limit`. Truncated to the millisecond in SQL,
   * so the next chunk's `fromMs = last + 1` can never re-read a sample whose
   * microseconds the JS `Date` dropped.
   */
  async readInputTimes(
    assetId: string,
    pointKeys: readonly string[],
    fromMs: number,
    toMs: number,
    limit: number,
  ): Promise<number[]> {
    if (pointKeys.length === 0) {
      return [];
    }
    const { rows } = await this.pool.query<{ t: Date }>(
      `SELECT DISTINCT date_trunc('milliseconds', time) AS t
         FROM telemetry.point_values
        WHERE asset_id = $1
          AND point_key = ANY($2::varchar[])
          AND time >= $3::timestamptz
          AND time < $4::timestamptz
        ORDER BY t
        LIMIT $5`,
      [assetId, [...pointKeys], new Date(fromMs), new Date(toMs), limit],
    );
    return rows.map((row) => new Date(row.t).getTime());
  }

  /** The run's whole window, once, after the last chunk (decision 7). */
  async refreshAggregates(from: Date, to: Date): Promise<void> {
    await refreshAggregatesFrom(this.pool, from, to);
  }
}
