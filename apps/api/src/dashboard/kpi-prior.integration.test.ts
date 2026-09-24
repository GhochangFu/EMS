import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertAlarmClearedAfterAtIsCounted,
  assertAlarmClearedBeforeAtIsNotCounted,
  assertAlarmRaisedAfterAtIsNotCounted,
  assertAlarmRaisedBeforeAndUnclearedIsCounted,
  assertLivePueStillReadsAFreshPair,
  assertPriorKwIsNullWithNoSampleAtOrBeforeAt,
  assertPriorKwIsTheLatestSampleAtOrBeforeAt,
  assertPriorPueIgnoresAPairAfterAt,
  assertPriorPueIgnoresAPairOlderThanTheWindow,
  assertPriorPueReadsAPairInsideTheWindow,
  inRolledBackTransaction,
} from "./kpi-prior.integration.spec";

/**
 * `F3.28` — Vitest entry point for the KPI prior reads against a real database.
 * Assertions live in the sibling `.spec` (ADR 0014, AGENTS.md §4.6); this file
 * owns the pool, and every case runs in a transaction the spec rolls back.
 *
 * The default `connection: "fleet"` matches production: `DashboardService`
 * runs these reads on its injected `FLEET_POOL` (ADR 0043 Amendments 2/3), and
 * `bms_fleet`'s `BYPASSRLS` lets the fixture write the FORCE-RLS tables without
 * an `app.current_organization` bracket.
 */
const connectionString = requireIntegrationDb({
  item: "F3.28",
  label: "KPI prior reads",
  because:
    "the `time <= at` DISTINCT ON read, the open-at-an-instant alarm predicate and the " +
    "moved PUE window are all SQL, so a green run without a database proves only the arithmetic.",
});

describe.skipIf(!connectionString)("F3.28 — KPI prior reads against Postgres", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.28");
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  const run = (fn: (client: pg.PoolClient) => Promise<void>) => () =>
    inRolledBackTransaction(pool as pg.Pool, fn);

  it("reads the latest kw at or before asOf − 24 h", run(assertPriorKwIsTheLatestSampleAtOrBeforeAt));

  it("answers null when no kw sample exists at or before asOf − 24 h", run(assertPriorKwIsNullWithNoSampleAtOrBeforeAt));

  it("counts an alarm raised before the instant and never cleared", run(assertAlarmRaisedBeforeAndUnclearedIsCounted));

  it("does not count an alarm cleared before the instant", run(assertAlarmClearedBeforeAtIsNotCounted));

  it("does not count an alarm raised after the instant", run(assertAlarmRaisedAfterAtIsNotCounted));

  it("counts an alarm cleared after the instant", run(assertAlarmClearedAfterAtIsCounted));

  it("reads a PUE pair inside (at − 900 s, at]", run(assertPriorPueReadsAPairInsideTheWindow));

  it("ignores a PUE pair stamped after at", run(assertPriorPueIgnoresAPairAfterAt));

  it("ignores a PUE pair older than at − 900 s", run(assertPriorPueIgnoresAPairOlderThanTheWindow));

  it("still reads a fresh PUE pair on the live read (no at)", run(assertLivePueStillReadsAFreshPair));
});
