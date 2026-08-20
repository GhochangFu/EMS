import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "pg";

import { MAX_INPUT_AGE_SECONDS_BOUND } from "@bms/shared";

import { POOL_TOKEN } from "../database/database.tokens";
import type { CalcInputSample } from "./calc-inputs";

/**
 * A **generous** read bound (ADR 0037 decision 3) — comfortably above
 * `MAX_INPUT_AGE_SECONDS_BOUND`, the loosest staleness a formula can
 * legally configure, so every legal `max_input_age_seconds` value stays
 * inside this query's window. Bounding at exactly a formula's own staleness
 * limit would collapse "this point has never reported" (`missing`) and
 * "this point reported, but too long ago" (`stale`) into the same empty
 * result — `classifyInput` (task 6) is what tells them apart, but only if
 * the query still returns the row for it to classify.
 */
const INPUT_READ_BOUND_SECONDS = MAX_INPUT_AGE_SECONDS_BOUND * 7;

/**
 * Reads the latest stored sample per point key for one asset, batched in a
 * single query rather than one per reference (ADR 0037 decision 3). Raw SQL
 * with `DISTINCT ON`, matching `dashboard.service.ts`/`map.service.ts`'s
 * existing precedent for this exact idiom over `point_values` — Drizzle's
 * query builder has no first-class `DISTINCT ON (a, b)` this repo already
 * reaches for elsewhere.
 */
@Injectable()
export class CalcInputsService {
  constructor(@Inject(POOL_TOKEN) private readonly pool: Pool) {}

  async getLatestSamples(assetId: string, pointKeys: string[]): Promise<Map<string, CalcInputSample>> {
    const map = new Map<string, CalcInputSample>();
    if (pointKeys.length === 0) {
      return map;
    }
    const { rows } = await this.pool.query<{ point_key: string; value: number; time: Date }>(
      `SELECT DISTINCT ON (point_key) point_key, value, time
         FROM telemetry.point_values
        WHERE asset_id = $1
          AND point_key = ANY($2::varchar[])
          AND time > now() - ($3 || ' seconds')::interval
        ORDER BY point_key, time DESC`,
      [assetId, pointKeys, INPUT_READ_BOUND_SECONDS],
    );
    for (const row of rows) {
      map.set(row.point_key, { value: row.value, timeMs: new Date(row.time).getTime() });
    }
    return map;
  }
}
