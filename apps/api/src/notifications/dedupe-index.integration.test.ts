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
  label: "notification deliveries dedupe skip index tests",
  because:
    "whether migration 0065's partial index exists with the predicate the planner actually " +
    "stored depends on the real database, not the static .sql file — a green run without one " +
    "proves nothing about what CREATE INDEX left behind.",
});

describe.skipIf(!connectionString)("F3.46 notification_deliveries dedupe skip index", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.46");
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  it("notification_deliveries_dedupe_skip_idx exists, keyed on (channel_id, dedupe_key), partial on skipped_deduped", async () => {
    if (!pool) throw new Error("pool not initialised");
    await runDedupeIndexTests(pool);
  }, 30_000);
});
