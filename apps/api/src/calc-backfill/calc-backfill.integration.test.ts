import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { loadFixtures, type Fixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { registerFixturePointKeys } from "../testing/integration-fixtures";
import {
  assertAPreExistingValueSurvives,
  assertAStreamingPointWritesAtTheInputTimes,
  assertEveryBucketHasTheFormulasValue,
  assertOneRowPerBucket,
  assertTheHourlyAggregateHasTheBucket,
  assertTheRunEndsDone,
  cleanup,
  refreshAfterCleanup,
  runBackfill,
  SCHED_KEY,
  seed,
  STREAM_KEY,
  type BackfillFixture,
} from "./calc-backfill.integration.spec";

/**
 * `F4.311` PR 5a — Vitest entry point for the backfill processor against a
 * real database. Assertions live in the sibling `.spec` (ADR 0014); this file
 * owns the lifecycle. The scheduled run happens once in `beforeAll`; each
 * `it` reads one fact of its outcome.
 */
const connectionString = requireIntegrationDb({
  item: "F4.311",
  label: "calc backfill processor tests",
  because:
    "a backfill's guarantees — one value per bucket, a stored value never overwritten, the rollup " +
    "covering the history, the run ending done — are rows in Postgres and TimescaleDB.",
});

describe.skipIf(!connectionString)("F4.311 — the calc backfill processor (ADR 0109 decision 7)", () => {
  let pool: pg.Pool | undefined;
  let fx: Fixtures;
  let fixture: BackfillFixture | undefined;
  let runId = "";
  let releasePointKeys: (() => Promise<void>) | undefined;

  const withPool = <T>(claim: (pool: pg.Pool) => Promise<T>) => async () => {
    if (!pool) throw new Error("pool required");
    await claim(pool);
  };

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F4.311");
    pool = created;
    releasePointKeys = await registerFixturePointKeys(created, [SCHED_KEY, STREAM_KEY]);
    fx = await loadFixtures(created);
    await cleanup(created);
    fixture = await seed(created, fx);
    runId = await runBackfill(created, fx, fixture, fixture.schedPointId);
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      await refreshAfterCleanup(pool, fixture);
      await releasePointKeys?.();
      await pool.end();
    }
  }, 60_000);

  it("stores one row per bucket of the window", withPool((p) => assertOneRowPerBucket(p, fixture as BackfillFixture)));
  it("stores the formula's value at every bucket", withPool((p) => assertEveryBucketHasTheFormulasValue(p, fixture as BackfillFixture)));
  it("keeps a value stored before the run", withPool((p) => assertAPreExistingValueSurvives(p, fixture as BackfillFixture)));
  it("ends the run done with done_through = to_at", withPool((p) => assertTheRunEndsDone(p, runId)));
  it("covers the window in the hourly aggregate", withPool((p) => assertTheHourlyAggregateHasTheBucket(p, fixture as BackfillFixture)));
  it(
    "writes a streaming point at its input's stored times",
    withPool((p) => assertAStreamingPointWritesAtTheInputTimes(p, fx, fixture as BackfillFixture)),
    60_000,
  );
});
