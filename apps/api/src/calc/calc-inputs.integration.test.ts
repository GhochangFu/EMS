import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertDistinctOnReturnsNewestPerKey,
  assertEmptyPairsReturnsEmptyMapWithoutQuerying,
  assertEmptyPointKeysReturnsEmptyMap,
  assertOldButWithinBoundSampleIsReturned,
  assertPairsReadOmitsAPairOlderThanTheBound,
  assertPairsReadReturnsExactlyOneRowPerPair,
  assertPairsReadReturnsTheLatestPerPair,
  assertUnreportedKeyIsAbsent,
  cleanup,
} from "./calc-inputs.integration.spec";

/**
 * `F2.4` — Vitest entry point for `CalcInputsService`. Assertions live in
 * the sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 */

const connectionString = requireIntegrationDb({
  item: "F2.4",
  label: "calc input reader tests",
  because:
    "the DISTINCT ON latest-sample read and the generous time bound that keeps missing " +
    "and stale distinguishable are database behaviours a pure test cannot check.",
});

describe.skipIf(!connectionString)("F2.4 — calc input reader", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F2.4");
    await cleanup(pool);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      await pool.end();
    }
  });

  it("returns the newest sample per key via DISTINCT ON, not an older one", async () => {
    if (!pool) throw new Error("pool required");
    await assertDistinctOnReturnsNewestPerKey(pool);
  });

  it("leaves a never-reported key absent from the result, not present with a stale value", async () => {
    if (!pool) throw new Error("pool required");
    await assertUnreportedKeyIsAbsent(pool);
  });

  it("still returns a sample older than any legal staleness limit, within the 7-day bound", async () => {
    if (!pool) throw new Error("pool required");
    await assertOldButWithinBoundSampleIsReturned(pool);
  });

  it("returns an empty map for an empty pointKeys list without querying", async () => {
    if (!pool) throw new Error("pool required");
    await assertEmptyPointKeysReturnsEmptyMap(pool);
  });

  // `F2.9` — the paired read behind `bms-calc-v2` aggregates.

  it("pairs read: returns the latest sample per (asset, key) pair, not per key", async () => {
    if (!pool) throw new Error("pool required");
    await assertPairsReadReturnsTheLatestPerPair(pool);
  });

  it("pairs read: returns exactly one row per pair, and it is the newest sample", async () => {
    if (!pool) throw new Error("pool required");
    await assertPairsReadReturnsExactlyOneRowPerPair(pool);
  });

  it("pairs read: omits a pair older than the 7-day bound and keeps one inside it", async () => {
    if (!pool) throw new Error("pool required");
    await assertPairsReadOmitsAPairOlderThanTheBound(pool);
  });

  it("pairs read: returns an empty map for an empty pairs list without querying", async () => {
    await assertEmptyPairsReturnsEmptyMapWithoutQuerying();
  });
});
