import { afterAll, beforeAll, describe, it } from "vitest";
import type pg from "pg";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { runDedupeIndexTests } from "./dedupe-index.integration.spec";

/**
 * `F3.46` — Vitest entry point for the dedupe skip index suite. Assertions
 * live in the sibling `.spec` (ADR 0014); this file owns the database
 * lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "F3.46",
  label: "notification deliveries dedupe key index tests",
  because:
    "whether migration 0066's partial index exists with the predicate the planner actually " +
    "stored, and whether 0065's subsumed one is gone, depends on the real database, not the " +
    "static .sql files — a green run without one proves nothing about what the DDL left behind.",
});

describe.skipIf(!connectionString)("F3.46 / F3.10 notification_deliveries dedupe key index", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.46");
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  it("notification_deliveries_channel_key_idx exists, keyed on (channel_id, dedupe_key), partial on dedupe_key IS NOT NULL; 0065's skip index is gone", async () => {
    if (!pool) throw new Error("pool not initialised");
    await runDedupeIndexTests(pool);
  }, 30_000);
});
