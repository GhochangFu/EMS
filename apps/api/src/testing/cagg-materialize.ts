import type pg from "pg";

/**
 * `E4.1b` U8 — refreshes the four continuous aggregates over COMPLETE buckets
 * only, for an integration fixture (plan design decision 16).
 *
 * A raw row inserted BEHIND a level's watermark is invisible in that level
 * until a refresh re-covers its bucket — `0027`'s header records the delete
 * side of the same fact — and every window fixture sits hours or days in the
 * past on purpose (the composition rule only shows behind the watermarks).
 * So a spec inserts its rows, calls this, asserts, deletes its rows and calls
 * this again, or its materialized rows outlive it (the `0027` standing
 * obligation).
 *
 * **Never an incomplete bucket.** `refresh_continuous_aggregate` over a
 * window that reaches past `now` materializes the current bucket half-full
 * and moves the watermark past it, and the live branch then stops serving
 * the rows that land later in that bucket until the policy's next run — on
 * the compose stack that is every tenant's live data, not only the fixture's.
 * Each level's range is therefore clipped to `floor_L(nowMs)`; a level whose
 * clipped range is empty is skipped. A spec whose "tail" rows must stay
 * UNmaterialized at `1d` (guard (c)) relies on exactly that clip.
 *
 * `SET ROLE bms_rollup` on a dedicated client — the views are owned by
 * `bms_rollup` and the API's roles hold it `WITH INHERIT FALSE, SET TRUE`
 * (`roles.ts`); the role is reset in a `finally` on the same connection,
 * the `withRollupRole` shape in `refresh-aggregates.ts`. Lives outside
 * `apps/api/src/calc/` so `tests/adr-0037`'s scan of that directory never
 * reads it.
 *
 * **`F4.149`.** Three suites (`calc-windows.integration`,
 * `calc-windows.sparse.integration`, `energy-cost.integration`) refresh
 * ranges near `now()`, which overlap the scheduled `1m`/`5m`/`1h` policies
 * (`0027_continuous_aggregates.sql:134-155`) and each other under
 * `maxWorkers: 2` — a single `CALL` with no retry then fails outright with
 * `55P03` ("due to a concurrent refresh"). `retryOnConcurrentRefresh` copies
 * (not shares — `refreshLevel` is not exported from `@bms/db`) the retry
 * precedent at `packages/db/src/refresh-aggregates.ts:143-178`. It cannot go
 * false-green: it only swallows the exact `55P03` SQLSTATE and always
 * re-throws every other code, including the exhausted-budget case, so a real
 * failure still fails the suite. It cannot deadlock: every caller here walks
 * `1m → 5m → 1h → 1d` on the single connection this function already holds,
 * so a retry only re-issues the same `CALL` on the same connection and never
 * waits on another one.
 */

const LEVELS: readonly { view: string; widthMs: number }[] = [
  { view: "point_values_1m", widthMs: 60_000 },
  { view: "point_values_5m", widthMs: 300_000 },
  { view: "point_values_1h", widthMs: 3_600_000 },
  { view: "point_values_1d", widthMs: 86_400_000 },
];

const CONCURRENT_REFRESH = "55P03";

/** The retry budget for `retryOnConcurrentRefresh`'s default — see the file
 * docblock's `F4.149` paragraph. */
export const FIXTURE_REFRESH_RETRY = { attempts: 5, delayMs: 3_000 } as const;

/** Runs `work`, retrying only SQLSTATE `55P03` (a concurrent refresh) — the
 *  `refreshLevel` loop in `packages/db/src/refresh-aggregates.ts:143-178`. */
export async function retryOnConcurrentRefresh<T>(
  work: () => Promise<T>,
  retry: { attempts: number; delayMs: number } = FIXTURE_REFRESH_RETRY,
): Promise<T> {
  const { attempts: MAX, delayMs: DELAY } = retry;
  for (let attempt = 1; attempt <= MAX; attempt += 1) {
    try {
      return await work();
    } catch (err: unknown) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== CONCURRENT_REFRESH || attempt === MAX) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, DELAY));
    }
  }
  // Unreachable: attempts >= 1 guarantees either a return or a throw above.
  throw new Error("retryOnConcurrentRefresh: unreachable");
}

/** Refreshes the four views over the complete buckets of `[fromMs, toMs)`,
 * clipped to `floor_L(nowMs)` per level — see the file docblock. Each `CALL`
 * is wrapped in `retryOnConcurrentRefresh` (`F4.149`). */
export async function materializeCompleteBuckets(
  pool: pg.Pool,
  fromMs: number,
  toMs: number,
  nowMs: number,
  retry: { attempts: number; delayMs: number } = FIXTURE_REFRESH_RETRY,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SET ROLE bms_rollup");
    for (const { view, widthMs } of LEVELS) {
      const lo = Math.floor(fromMs / widthMs) * widthMs;
      const hi = Math.min(Math.ceil(toMs / widthMs) * widthMs, Math.floor(nowMs / widthMs) * widthMs);
      if (hi <= lo) {
        continue;
      }
      await retryOnConcurrentRefresh(
        () =>
          client.query(`CALL refresh_continuous_aggregate($1::regclass, $2::timestamptz, $3::timestamptz)`, [
            `telemetry.${view}`,
            new Date(lo).toISOString(),
            new Date(hi).toISOString(),
          ]),
        retry,
      );
    }
  } finally {
    let reset = true;
    try {
      await client.query("RESET ROLE");
    } catch {
      reset = false;
    }
    client.release(reset ? undefined : new Error("RESET ROLE failed"));
  }
}
