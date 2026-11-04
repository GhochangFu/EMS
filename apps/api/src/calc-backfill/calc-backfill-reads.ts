import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";

import { refreshAggregatesFrom } from "@bms/db";

import { inputKey } from "../calc/calc-batch";
import type { CalcInputSample } from "../calc/calc-inputs";
import { TENANT_POOL } from "../database/database.tokens";
import { BACKFILL_MAX_SAMPLE_ROWS } from "./calc-backfill-plan";

/**
 * A chunk's input read came back larger than `BACKFILL_MAX_SAMPLE_ROWS` —
 * reachable only when one instant's input pairs alone exceed the cap. The
 * walk fails the run by this name rather than load the rows.
 */
export class CalcBackfillReadCapError extends Error {
  override readonly name = "CalcBackfillReadCapError";
  constructor() {
    super(`calc backfill: one chunk's input read exceeds ${BACKFILL_MAX_SAMPLE_ROWS} rows`);
  }
}

/** One `(asset, point key)` a backfill reads history for. */
export type BackfillPair = { readonly assetId: string; readonly pointKey: string };

/**
 * `F4.311` PR 5a (ADR 0109 decision 7) — the backfill's three statements on
 * `telemetry.point_values`, which is unpolicied, so they run on `TENANT_POOL`
 * exactly as `CalcInputsService`'s and `CalcWindowsService`'s reads do.
 *
 * **Bounded by instants, not by time** (`F4.311` PR 5 review). The live
 * engine's "latest" read, asked once per `(pair, instant)`: one lateral
 * `ORDER BY time DESC LIMIT 1` probe each (the shape
 * `getLatestSamplesForPairs` measured against `IN (unnest…)`), so a chunk
 * returns at most `pairs × instants` rows however dense the input or long
 * its `max_input_age_seconds` — the walk keeps that product within
 * `BACKFILL_MAX_SAMPLE_ROWS` (`bucketsPerChunk`), and the statement's own
 * `LIMIT` refuses anything past it by name ({@link CalcBackfillReadCapError}).
 * A range read of the whole span instead held every sample of 31 dense days
 * in one statement and one heap.
 *
 * Values only ever reach `assembleInputs`; nothing here logs a sample.
 */
@Injectable()
export class CalcBackfillReads {
  constructor(@Inject(TENANT_POOL) private readonly pool: Pool) {}

  /**
   * For each pair and each instant `t`, the newest sample with `t −
   * maxInputAgeSeconds ≤ time ≤ t`, keyed by `inputKey` (distinct, ascending)
   * — exactly what `asOfIndex` needs to answer "as of `t`" at every instant.
   *
   * The upper bound is `time < t + 1 ms`, not `time ≤ t`: `readInputTimes`
   * truncates a stored time to the millisecond, so an input stored at
   * `10.000500` yields the instant `10.000`, and `≤ 10.000` would drop the
   * very sample that produced it. Its JS `timeMs` is `10.000` again, so
   * `asOfIndex` serves it at that instant.
   */
  async readSamples(
    pairs: readonly BackfillPair[],
    instants: readonly number[],
    maxInputAgeSeconds: number,
  ): Promise<Map<string, CalcInputSample[]>> {
    const out = new Map<string, CalcInputSample[]>();
    const distinct = new Map<string, BackfillPair>();
    for (const pair of pairs) {
      distinct.set(inputKey(pair.assetId, pair.pointKey), pair);
    }
    if (distinct.size === 0 || instants.length === 0) {
      return out;
    }
    const wanted = [...distinct.values()];
    const { rows } = await this.pool.query<{ asset_id: string; point_key: string; value: number; time: Date }>(
      `SELECT DISTINCT p.asset_id, p.point_key, s.value, s.time
         FROM unnest($1::uuid[], $2::varchar[]) AS p(asset_id, point_key)
         CROSS JOIN unnest($3::timestamptz[]) AS i(t)
         CROSS JOIN LATERAL (
           SELECT v.value, v.time
             FROM telemetry.point_values v
            WHERE v.asset_id = p.asset_id
              AND v.point_key = p.point_key
              AND v.time >= i.t - make_interval(secs => $4::double precision)
              AND v.time < i.t + interval '1 millisecond'
            ORDER BY v.time DESC
            LIMIT 1
         ) s
        ORDER BY s.time
        LIMIT $5`,
      [
        wanted.map((p) => p.assetId),
        wanted.map((p) => p.pointKey),
        instants.map((t) => new Date(t)),
        maxInputAgeSeconds,
        BACKFILL_MAX_SAMPLE_ROWS + 1,
      ],
    );
    if (rows.length > BACKFILL_MAX_SAMPLE_ROWS) {
      throw new CalcBackfillReadCapError();
    }
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
