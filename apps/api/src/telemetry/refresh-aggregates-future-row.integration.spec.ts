import type pg from "pg";
import { expect } from "vitest";

import { refreshAggregatesFrom } from "@bms/db";

import { retryOnConcurrentRefresh } from "../testing/cagg-materialize";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

/**
 * `F4.166` — a row 60 s ahead of the clock is the input `calc-write`'s second
 * value writes, and `TelemetryWriteService` accepts the same (`FUTURE_SKEW_MS`
 * is 60 s). Before the fix the `_1m` window widened to `[now - 60 s, now]`,
 * which holds no complete minute, and TimescaleDB raised
 * `22023 refresh window too small` on every full CI run. The callers caught
 * it as a warning, so no test failed.
 *
 * This asserts on the real `CALL`, not a fake: the error is TimescaleDB's own
 * inscription rule, so only the database can say the window is now accepted.
 * The unit cases in `packages/db/src/refresh-aggregates.spec.ts` pin which
 * levels are refreshed and over which bounds. The wrapper is the fixture-layer
 * retry `F4.71` requires of every integration call site.
 */
export async function assertAFutureRowRefreshDoesNotRaise(pool: pg.Pool): Promise<void> {
  const row = new Date(Date.now() + 60_000);
  await expect(retryOnConcurrentRefresh(() => refreshAggregatesFrom(pool, row, row))).resolves.toBeUndefined();
}
