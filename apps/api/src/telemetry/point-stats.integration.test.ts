import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertAnAssetNotPassedIsInNoRowAndNoLast,
  assertAnAssetWithNoSampleHasNoRow,
  assertLastIsTheNewestBucketPerAsset,
  assertTheFixtureIsVisible,
  assertTheStatisticsAreExactPerAsset,
  assertTheWindowPicksTheLevelAndLastStaysAtOneMinute,
  cleanup,
  setupFixtures,
  type Fixtures,
} from "./point-stats.integration.spec";

/**
 * `F4.291` PR 3 — Vitest entry point for `pointStatsByAsset` against a real
 * database. Assertions live in the sibling `.spec` (ADR 0014); this file owns
 * the database lifecycle. The default `fleet` connection writes the raw rows
 * (no `bms.*` row is written) and reads the aggregates the tenant pool reads.
 */
const connectionString = requireIntegrationDb({
  item: "F4.291",
  label: "point stats by asset tests",
  because:
    "the per-asset grouping, the last-bucket probe, the level the window reads through the " +
    "continuous aggregates' real-time branch and the ANY(ids) containment are engine behaviour.",
});

describe.skipIf(!connectionString)("F4.291 — pointStatsByAsset against Postgres", () => {
  let pool: pg.Pool | undefined;
  let fx: Fixtures | undefined;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F4.291");
    pool = created;
    fx = await setupFixtures(created);
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await cleanup(pool, fx).catch(() => undefined);
      await pool.end();
    }
  }, 60_000);

  it("has a fixture the 1-minute aggregate can see", async () => {
    await assertTheFixtureIsVisible(pool as pg.Pool, fx as Fixtures);
  });

  it("answers exact min, weighted mean, max and sample count per asset", async () => {
    await assertTheStatisticsAreExactPerAsset(pool as pg.Pool, fx as Fixtures);
  });

  it("answers last as each asset's newest bucket", async () => {
    await assertLastIsTheNewestBucketPerAsset(pool as pg.Pool, fx as Fixtures);
  });

  it("leaves an asset with no sample out of the rows", async () => {
    await assertAnAssetWithNoSampleHasNoRow(pool as pg.Pool, fx as Fixtures);
  });

  it("keeps an asset not passed out of every row and every last", async () => {
    await assertAnAssetNotPassedIsInNoRowAndNoLast(pool as pg.Pool, fx as Fixtures);
  });

  it("reads 1d for 31 days and 1h for 7, with last at the newest 1-minute bucket", async () => {
    await assertTheWindowPicksTheLevelAndLastStaysAtOneMinute(pool as pg.Pool, fx as Fixtures);
  });
});
