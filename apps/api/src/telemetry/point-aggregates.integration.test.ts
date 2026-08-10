import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import {
  assertBucketsExist,
  assertCoarseRollupFromFinerLevel,
  assertLevelMatchesRaw,
  assertNaiveFormWouldFail,
  assertRealtimeEnabled,
  assertRefreshOffsetsAreSafe,
  cleanup,
  refreshWindow,
  seedReadings,
  type Fixtures,
} from "./point-aggregates.integration.spec";

/**
 * `F4.1` — Vitest entry point for the ADR 0023 continuous aggregates.
 * Assertions live in the sibling `.spec` (ADR 0014); this file owns the database
 * lifecycle.
 *
 * Skip/fail semantics match `F4.10`, `F2.1`, `F2.2` and `F4.14`: an unset
 * `DATABASE_URL` skips locally and throws under `CI`, while a *set* one is a
 * claim that a database exists, so a failed connection fails everywhere. This is
 * the **fifth** copy of the gate. `F2.1`'s file put the threshold for extracting
 * it at the third suite and `F4.14` recorded it as overdue rather than newly
 * due; it is more overdue now. Still left in place rather than refactoring four
 * other suites inside the change that introduces this feature — see the `F4.1`
 * row in `docs/BACKLOG.md`.
 *
 * **One side effect on a shared database, stated so it is not a surprise.** The
 * fixture sits past every watermark and the materialized-path case refreshes over
 * it, which advances all four watermarks past `now()`. Until each level's policy
 * next runs, its live branch covers nothing and reads come from stored rows —
 * recovery is one policy interval (1 min for `_1m`, 5 for `_5m`, 30 for `_1h`).
 * `_1d`'s current bucket does not self-correct, but that is inherent to its
 * `end_offset` of 2 days and is equally true after any full backfill; this suite
 * does not cause it. See ADR 0023, "`_1d` is only final for completed days".
 */

const isCi = process.env.CI === "true" || process.env.CI === "1";
const connectionString = process.env.DATABASE_URL;

if (!connectionString && isCi) {
  throw new Error(
    "F4.1 aggregate tests have no DATABASE_URL in CI. Refusing to skip — continuous aggregates, " +
      "the real-time branch, the sum/count composition and the refresh-policy offsets are all " +
      "TimescaleDB behaviours, so a green run without them asserts nothing.",
  );
}

if (!connectionString) {
  process.stderr.write(
    "\n[F4.1] Skipping continuous-aggregate tests: DATABASE_URL is not set.\n" +
      "        Coverage thresholds assume these ran — expect the gate to fail.\n" +
      "        DATABASE_URL=postgres://bms_app:bms_app_dev@localhost:5432/bms pnpm test:coverage\n" +
      "        (5432 is the committed compose port; docker-compose.override.yml may remap it)\n\n",
  );
}

describe.skipIf(!connectionString)("F4.1 — telemetry continuous aggregates", () => {
  let pool: pg.Pool | undefined;
  let fx: Fixtures;

  beforeAll(async () => {
    const created = new pg.Pool({
      connectionString,
      max: 4,
      connectionTimeoutMillis: 5_000,
    });
    try {
      await created.query("SELECT 1");
    } catch (err) {
      await created.end().catch(() => undefined);
      const detail =
        err instanceof Error
          ? [err.message, (err as NodeJS.ErrnoException).code].filter(Boolean).join(" ") ||
            err.name
          : String(err);
      throw new Error(
        `F4.1 could not reach DATABASE_URL: ${detail}. Setting DATABASE_URL is a claim ` +
          "that a database exists, so this fails rather than skipping.",
      );
    }
    pool = created;
    // No window on the first cleanup — the fixture window is derived from the
    // watermarks and is not known until `seedReadings` resolves it.
    await cleanup(created);
    fx = await seedReadings(created);
    await assertBucketsExist(created, fx);
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await cleanup(pool, fx && { start: fx.start, end: fx.end }).catch(() => undefined);
      await pool.end();
    }
  }, 60_000);

  it("has all four aggregates with the real-time branch enabled", async () => {
    await assertRealtimeEnabled(pool as pg.Pool);
  });

  it("has refresh offsets that cannot materialise an incomplete source bucket", async () => {
    await assertRefreshOffsetsAreSafe(pool as pg.Pool);
  });

  it("the fixture would detect an average-of-averages implementation", async () => {
    await assertNaiveFormWouldFail(pool as pg.Pool, fx);
  });

  /**
   * The only assertion here that fails when `avgExpr` regresses to an average of
   * averages — verified by mutation. The two `assertLevelMatchesRaw` cases group
   * one source row per output bucket, where both forms agree.
   */
  it("folds many minute buckets into one hour without an avg-of-avg error", async () => {
    await assertCoarseRollupFromFinerLevel(pool as pg.Pool, fx);
  });

  /**
   * Ordering matters and is the point of splitting these two.
   *
   * The fixture sits past every watermark (see `fixtureWindow`) and nothing has
   * been refreshed over it, so this first pair reads entirely through the
   * **real-time branch** — the path every read near the tail takes in
   * production. ADR 0023 measured it exact (7.1e-14 against raw, three levels
   * deep) and this is what holds it there.
   */
  it("matches raw per bucket at 1m and 1h with nothing materialized", async () => {
    await assertLevelMatchesRaw(pool as pg.Pool, fx, "1m", "minute", "live 1m");
    await assertLevelMatchesRaw(pool as pg.Pool, fx, "1h", "hour", "live 1h");
  }, 60_000);

  /**
   * And now the same assertions served from stored rows. Different code inside
   * TimescaleDB, and the only branch that exists for buckets behind the
   * watermark — so passing the live case says nothing about this one.
   */
  it("matches raw per bucket at 1m and 1h once materialized", async () => {
    await refreshWindow(pool as pg.Pool, { start: fx.start, end: fx.end });
    await assertLevelMatchesRaw(pool as pg.Pool, fx, "1m", "minute", "materialized 1m");
    await assertLevelMatchesRaw(pool as pg.Pool, fx, "1h", "hour", "materialized 1h");
  }, 120_000);
});
