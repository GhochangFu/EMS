import { afterAll, beforeAll, describe, it } from "vitest";

import { loadFixtures, type Fixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { registerFixturePointKeys } from "../testing/integration-fixtures";
import { asRole } from "../testing/role-urls";
import {
  assertABackfillNotifiesNothing,
  assertALiveRunningRunIsNotClaimed,
  assertAPreExistingValueSurvives,
  assertAReclaimedRunResumesAfterDoneThrough,
  assertAStaleRunningRunIsReclaimed,
  assertAStreamingPointWritesAtTheInputTimes,
  assertASubMillisecondSampleIsReadAtItsInstant,
  assertEveryBucketHasTheFormulasValue,
  assertOneRowPerBucket,
  assertTheHourlyAggregateHasTheBucket,
  assertTheRunEndsDone,
  cleanup,
  LIVE_KEY,
  reclaimAStaleRun,
  QUIET_KEY,
  refreshAfterCleanup,
  runBackfill,
  SCHED_KEY,
  seed,
  STALE_KEY,
  STREAM_KEY,
  type BackfillFixture,
  type BackfillPools,
} from "./calc-backfill.integration.spec";

/**
 * `F4.311` PR 5a — Vitest entry point for the backfill processor against a
 * real database. Assertions live in the sibling `.spec` (ADR 0014); this file
 * owns the lifecycle. The scheduled run happens once in `beforeAll`; each
 * `it` reads one fact of its outcome. Two pools: the fixture's `bms_fleet`
 * and a `bms_tenant` one, so the run store's statements meet the `0123`
 * policy as they do on the worker (PR 5 review).
 */
const connectionString = requireIntegrationDb({
  item: "F4.311",
  label: "calc backfill processor tests",
  because:
    "a backfill's guarantees — one value per bucket, a stored value never overwritten, the rollup " +
    "covering the history, the run ending done, no live NOTIFY for history, a dead run re-claimed — " +
    "are rows in Postgres and TimescaleDB, written through the tenant role's row-level security.",
});

describe.skipIf(!connectionString)("F4.311 — the calc backfill processor (ADR 0109 decision 7)", () => {
  let pools: BackfillPools | undefined;
  let fx: Fixtures;
  let fixture: BackfillFixture | undefined;
  let runId = "";
  let staleRunId = "";
  let releasePointKeys: (() => Promise<void>) | undefined;

  const withPools = (claim: (pools: BackfillPools) => Promise<void>) => async () => {
    if (!pools) throw new Error("pools required");
    await claim(pools);
  };

  beforeAll(async () => {
    const url = connectionString as string;
    const fleet = await openIntegrationPool(url, "F4.311");
    const tenant = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.311",
    );
    pools = { fleet, tenant };
    releasePointKeys = await registerFixturePointKeys(fleet, [SCHED_KEY, STREAM_KEY, QUIET_KEY, STALE_KEY, LIVE_KEY]);
    fx = await loadFixtures(fleet);
    await cleanup(fleet);
    fixture = await seed(fleet, fx);
    runId = await runBackfill(pools, fx, fixture, fixture.schedPointId);
    staleRunId = await reclaimAStaleRun(pools, fx, fixture);
  }, 120_000);

  afterAll(async () => {
    if (pools) {
      await cleanup(pools.fleet);
      await refreshAfterCleanup(pools.fleet, fixture);
      await releasePointKeys?.();
      await pools.tenant.end();
      await pools.fleet.end();
    }
  }, 60_000);

  const f = () => fixture as BackfillFixture;

  it("stores one row per bucket of the window", withPools((p) => assertOneRowPerBucket(p.fleet, f())));
  it("stores the formula's value at every bucket", withPools((p) => assertEveryBucketHasTheFormulasValue(p.fleet, f())));
  it("keeps a value stored before the run", withPools((p) => assertAPreExistingValueSurvives(p.fleet, f())));
  it("ends the run done with done_through = to_at", withPools((p) => assertTheRunEndsDone(p.fleet, runId)));
  it("covers the window in the hourly aggregate", withPools((p) => assertTheHourlyAggregateHasTheBucket(p.fleet, f())));
  it(
    "writes a streaming point at its input's stored times",
    withPools((p) => assertAStreamingPointWritesAtTheInputTimes(p, fx, f())),
    60_000,
  );
  it("issues no bms_telemetry NOTIFY for the history it writes", withPools((p) => assertABackfillNotifiesNothing(p, fx, f())), 60_000);
  it(
    "re-claims a running run whose heartbeat is past the stale bound, and finishes it",
    withPools((p) => assertAStaleRunningRunIsReclaimed(p.fleet, staleRunId)),
  );
  it("resumes the re-claimed run after done_through", withPools((p) => assertAReclaimedRunResumesAfterDoneThrough(p.fleet, f())));
  it("leaves a running run with a fresh heartbeat alone", withPools((p) => assertALiveRunningRunIsNotClaimed(p, fx, f())), 60_000);
  it("reads a sub-millisecond input at the instant it was truncated to", withPools((p) => assertASubMillisecondSampleIsReadAtItsInstant(p, f())));
});
