import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { anEdgeOutageLandsEveryRowOnceAtItsOriginalRx } from "./edge-roundtrip.integration.spec.js";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate.js";

/**
 * `E7.2` / ADR 0123 decisions 4 and 8, plan T5.8 — Vitest entry point.
 * Assertions live in the sibling `.spec` (ADR 0014); this file owns the
 * database lifecycle.
 */

const connectionString = requireIntegrationDb({
  item: "E7.2",
  label: "edge round-trip tests",
  because:
    "edge-roundtrip.spec.ts drives the edge against a fake receiver, so it is green if the real " +
    "receiver refuses the client's batches, if a sample's rx does not become the row's time, or if a " +
    "re-replayed segment writes a second row.",
});

describe.skipIf(!connectionString)("E7.2 — the edge round trip on a real database", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "E7.2");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("lands every sample of an outage once, at its original rx, and a re-replay adds no row", async () => {
    await anEdgeOutageLandsEveryRowOnceAtItsOriginalRx(pool as pg.Pool);
  }, 60_000);
});
