import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { inRolledBackTransaction } from "../dashboard/kpi-prior.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertDeltaProbesPlanOnlyTheirEnvelope,
  assertLatestPointValuesPlansOnlyItsWindow,
  assertLivePuePlansOnlyItsWindow,
  assertPueAtAnInstantPlansOnlyItsWindow,
  assertRecentForPointPlansOnlyItsWindow,
  assertRegisterProbesPlanOnlyTheirEnvelope,
  assertRollupLatestAtPlansOnlyItsWindow,
  assertRollupLatestLivePlansOnlyItsWindow,
  assertTheDetectorSeesStartupOnlyPruning,
  assertTheFixtureShowsAnAllChunkPlan,
} from "./point-values-plan-shape.integration.spec";

/**
 * `F4.393` — Vitest entry point for the plan-shape gate on the raw `telemetry.point_values`
 * readers. Assertions live in the sibling `.spec` (ADR 0014, AGENTS.md §4.6); every case runs in
 * a transaction that is rolled back, so the fixture's chunks leave with it.
 */
const connectionString = requireIntegrationDb({
  item: "F4.393",
  label: "point_values plan-shape cases",
  because:
    "which chunks the planner keeps is a property of the planner on a real hypertable, so a " +
    "green run without a database proves nothing about it.",
});

describe.skipIf(!connectionString)("F4.393 — point_values readers plan only their window", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.393");
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  const run = (fn: (client: pg.PoolClient) => Promise<void>) => () =>
    inRolledBackTransaction(pool as pg.Pool, fn);

  it("control: the fixture shows an all-chunk plan for an unbounded read", run(assertTheFixtureShowsAnAllChunkPlan));

  it("control: the detector sees chunks excluded only at startup", run(assertTheDetectorSeesStartupOnlyPruning));

  it("latestPointValues plans only its window (pin)", run(assertLatestPointValuesPlansOnlyItsWindow));

  it("recentForPoint plans only its window", run(assertRecentForPointPlansOnlyItsWindow));

  it("latestPueRatio live plans only its window", run(assertLivePuePlansOnlyItsWindow));

  it("latestPueRatio at an instant plans only its window (pin)", run(assertPueAtAnInstantPlansOnlyItsWindow));

  it("the roll-up's latest read, live, plans only its window", run(assertRollupLatestLivePlansOnlyItsWindow));

  it("the roll-up's latest read at an instant plans only its window", run(assertRollupLatestAtPlansOnlyItsWindow));

  it("the register probes plan only their envelope", run(assertRegisterProbesPlanOnlyTheirEnvelope));

  it("the delta probes plan only their envelope", run(assertDeltaProbesPlanOnlyTheirEnvelope));
});
