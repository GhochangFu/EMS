import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { assertAFutureRowRefreshDoesNotRaise } from "./refresh-aggregates-future-row.integration.spec";

/**
 * `F4.166` — Vitest entry point for the future-row refresh case. The assertion
 * lives in the sibling `.spec` (ADR 0014); this file owns the database
 * lifecycle.
 */

const connectionString = requireIntegrationDb({
  item: "F4.166",
  label: "future-row aggregate refresh",
  because:
    "`refresh window too small` is TimescaleDB's own check on the inscribed window, " +
    "so only a real `refresh_continuous_aggregate` call can show the window is accepted.",
});

describe.skipIf(!connectionString)("F4.166 — refreshAggregatesFrom with a future-dated row", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.166");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("does not raise 22023 for a row 60 s ahead of the clock", async () => {
    if (!pool) throw new Error("pool required");
    await assertAFutureRowRefreshDoesNotRaise(pool);
  });
});
