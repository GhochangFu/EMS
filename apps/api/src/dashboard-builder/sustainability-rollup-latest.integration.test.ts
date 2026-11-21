import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { inRolledBackTransaction } from "../dashboard/kpi-prior.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertTheNewReadEqualsTheOldReadAt,
  assertTheNewReadEqualsTheOldReadLive,
} from "./sustainability-rollup-latest.integration.spec";

/**
 * `F4.393` — Vitest entry point for the roll-up's latest read against a real database.
 * Assertions live in the sibling `.spec` (ADR 0014, AGENTS.md §4.6); every case runs in a
 * transaction the wrapper rolls back.
 */
const connectionString = requireIntegrationDb({
  item: "F4.393",
  label: "sustainability roll-up latest read cases",
  because:
    "the envelope bound is SQL, and only a real read shows it answers the same rows as the " +
    "per-asset bound alone.",
});

describe.skipIf(!connectionString)("F4.393 — the roll-up's latest read answers the same rows", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.393");
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  const run = (fn: (client: pg.PoolClient) => Promise<void>) => () =>
    inRolledBackTransaction(pool as pg.Pool, fn);

  it("live: equals the frozen statement (A and B read, C stale, D none)", run(assertTheNewReadEqualsTheOldReadLive));

  it("at: equals the frozen statement (the sample after at unread)", run(assertTheNewReadEqualsTheOldReadAt));
});
