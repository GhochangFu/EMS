import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  assertALateBatchSetsAndWidensTheWindow,
  assertALiveOnlyBatchLeavesTheWindowNull,
  assertARetriedBatchIsIdempotent,
  assertARevokedGatewayRollsTheBatchBack,
} from "./uplink-write.integration.spec.js";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate.js";

/**
 * `E7.2` / ADR 0123 decisions 8 and 11 — Vitest entry point. Assertions live
 * in the sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 */

const connectionString = requireIntegrationDb({
  item: "E7.2",
  label: "uplink write tests",
  because:
    "uplink-write.spec.ts reads the SQL as text against a fake client, so it is green if " +
    "LEAST/GREATEST do not ignore NULL the way the window relies on, if migration 0140's CHECKs " +
    "refuse the UPDATE, or if a retried batch writes a second row.",
});

describe.skipIf(!connectionString)("E7.2 — the uplink write on a real database", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "E7.2");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("upserts a retried batch onto the same rows", async () => {
    await assertARetriedBatchIsIdempotent(pool as pg.Pool);
  });

  it("sets the dirty window on a late batch and widens it on the next", async () => {
    await assertALateBatchSetsAndWidensTheWindow(pool as pg.Pool);
  });

  it("leaves the window NULL for a live-only batch", async () => {
    await assertALiveOnlyBatchLeavesTheWindowNull(pool as pg.Pool);
  });

  it("rolls the rows back when the gateway was revoked after the snapshot", async () => {
    await assertARevokedGatewayRollsTheBatchBack(pool as pg.Pool);
  });
});
