import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { DashboardService } from "../dashboard/dashboard.service";
import {
  assertBucketsExist,
  assertCoarseRollupFromFinerLevel,
  assertEnergySummaryMatchesRaw,
  assertNaiveFormWouldFail,
  assertProbeMatchesRaw,
  assertProductionShapeMatchesProbe,
  assertRealtimeEnabled,
  assertRefreshOffsetsAreSafe,
  assertRefreshPoliciesHaveNotFailed,
  cleanup,
  createProbeAggregates,
  dropProbeAggregates,
  refreshProbes,
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
 * it at the third suite and `F4.14` recorded it as overdue rather than newly due;
 * it is more overdue now. Still left in place rather than refactoring four other
 * suites inside the change that introduces this feature — see the `F4.1` row in
 * `docs/BACKLOG.md`.
 *
 * **This suite leaves the production aggregates' watermarks alone**, which the
 * first version did not. It created and refreshed against
 * `telemetry.point_values_1m/_5m/_1h/_1d` directly, and because a watermark only
 * moves forward, every run pushed all four ~3 days into the future — permanently
 * degrading any shared database it was pointed at. The equality work now runs on
 * throwaway aggregates dropped in `afterAll`; only the catalog assertions touch
 * the real four, and they are read-only.
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
    await cleanup(created);
    await createProbeAggregates(created);
    fx = await seedReadings(created);
    await assertBucketsExist(created, fx);
  }, 120_000);

  afterAll(async () => {
    if (pool) {
      await dropProbeAggregates(pool).catch(() => undefined);
      await cleanup(pool).catch(() => undefined);
      await pool.end();
    }
  }, 120_000);

  it("has all four aggregates with the real-time branch enabled", async () => {
    await assertRealtimeEnabled(pool as pg.Pool);
  });

  it("has refresh offsets that cannot materialise an incomplete source bucket", async () => {
    await assertRefreshOffsetsAreSafe(pool as pg.Pool);
  });

  it("has refresh policies that have not failed", async () => {
    await assertRefreshPoliciesHaveNotFailed(pool as pg.Pool);
  });

  it("keeps the production aggregate shape identical to the probe's", async () => {
    await assertProductionShapeMatchesProbe(pool as pg.Pool);
  });

  it("the fixture would detect an average-of-averages implementation", async () => {
    await assertNaiveFormWouldFail(pool as pg.Pool, fx);
  });

  /**
   * The only assertion here that fails when `avgExpr` regresses to an average of
   * averages — verified by mutation. The two `assertProbeMatchesRaw` cases group
   * one source row per output bucket, where both forms agree.
   */
  it("folds many minute buckets into one hour without an avg-of-avg error", async () => {
    await assertCoarseRollupFromFinerLevel(pool as pg.Pool, fx);
  });

  /**
   * Ordering matters and is the point of splitting these two.
   *
   * The probes were created moments ago and nothing has been refreshed over them,
   * so this first pair reads entirely through the **real-time branch** — the path
   * every read near the tail takes in production. ADR 0023 measured it exact
   * (7.1e-14 against raw, three levels deep) and this is what holds it there.
   */
  it("matches raw per bucket at 1m and 1h with nothing materialized", async () => {
    await assertProbeMatchesRaw(pool as pg.Pool, fx, "1m", "live 1m");
    await assertProbeMatchesRaw(pool as pg.Pool, fx, "1h", "live 1h");
  }, 60_000);

  /**
   * And now the same assertions served from stored rows. Different code inside
   * TimescaleDB, and the only branch that exists for buckets behind the
   * watermark — so passing the live case says nothing about this one.
   */
  it("matches raw per bucket at 1m and 1h once materialized", async () => {
    await refreshProbes(pool as pg.Pool);
    await assertProbeMatchesRaw(pool as pg.Pool, fx, "1m", "materialized 1m");
    await assertProbeMatchesRaw(pool as pg.Pool, fx, "1h", "materialized 1h");
  }, 120_000);

  /**
   * The converted read site, executed rather than reconstructed. Everything above
   * proves the aggregates are correct; only this proves `energySummary` reads them
   * correctly — the level/`kwhFactor` pairing and the `bucket`-vs-`time` predicate
   * are invisible to every other assertion here.
   */
  it("energySummary matches the equivalent raw query on both branches", async () => {
    const svc = new DashboardService(pool as pg.Pool);
    await assertEnergySummaryMatchesRaw(pool as pg.Pool, (window, assetIds) =>
      svc.energySummary(window, assetIds),
    );
  }, 120_000);
});
