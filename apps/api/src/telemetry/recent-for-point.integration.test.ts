import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { inRolledBackTransaction } from "../dashboard/kpi-prior.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertFifteenMinutesReadsTheTwoNewest,
  assertOneHourReadsFour,
  assertTwoHoursReadsAllFive,
} from "./recent-for-point.integration.spec";

/**
 * `F4.393` — Vitest entry point for `recentForPoint` against a real database. Assertions live in
 * the sibling `.spec` (ADR 0014, AGENTS.md §4.6); every case runs in a transaction the wrapper
 * rolls back.
 */
const connectionString = requireIntegrationDb({
  item: "F4.393",
  label: "recentForPoint cases",
  because: "the window bound is SQL, so a green run without a database proves nothing about which rows it keeps.",
});

describe.skipIf(!connectionString)("F4.393 — recentForPoint reads its window, newest first", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.393");
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  const run = (fn: (client: pg.PoolClient) => Promise<void>) => () =>
    inRolledBackTransaction(pool as pg.Pool, fn);

  it("15m reads the samples 5 and 14 minutes old", run(assertFifteenMinutesReadsTheTwoNewest));

  it("1h reads the four samples inside the hour", run(assertOneHourReadsFour));

  it("2h reads all five samples", run(assertTwoHoursReadsAllFive));
});
