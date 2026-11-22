import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { inRolledBackTransaction } from "../dashboard/kpi-prior.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { assertReadSamplesEqualTheFrozenStatement } from "./calc-backfill-reads.integration.spec";

/**
 * `F4.393` — Vitest entry point for `CalcBackfillReads.readSamples` against a real database.
 * Assertions live in the sibling `.spec` (ADR 0014, AGENTS.md §4.6); every case runs in a
 * transaction the wrapper rolls back.
 */
const connectionString = requireIntegrationDb({
  item: "F4.393",
  label: "CalcBackfillReads.readSamples cases",
  because: "the probes are SQL, so a green run without a database proves nothing about which samples they return.",
});

describe.skipIf(!connectionString)("F4.393 — readSamples returns what the unbounded statement did", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.393");
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  const run = (fn: (client: pg.PoolClient) => Promise<void>) => () =>
    inRolledBackTransaction(pool as pg.Pool, fn);

  it("equals the frozen statement, with edge controls", run(assertReadSamplesEqualTheFrozenStatement));
});
