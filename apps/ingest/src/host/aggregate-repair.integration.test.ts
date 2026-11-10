import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { assertCompareAndClearOnTheRealTable } from "./aggregate-repair.integration.spec.js";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate.js";

/**
 * `E7.2` / ADR 0123 decision 11 — Vitest entry point. Assertions live in the
 * sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 */

const connectionString = requireIntegrationDb({
  item: "E7.2",
  label: "aggregate repair store tests",
  because:
    "aggregate-repair.spec.ts reads CLEAR_DIRTY_WINDOW as text against a fake store, so it is " +
    "green if the compare-and-clear never matches a stored microsecond, or always matches.",
});

describe.skipIf(!connectionString)("E7.2 — the aggregate repair store on a real database", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "E7.2");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("keeps a window that moved and clears one that did not", async () => {
    await assertCompareAndClearOnTheRealTable(pool as pg.Pool);
  });
});
