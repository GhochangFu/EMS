import { afterAll, beforeAll, describe, it } from "vitest";
import type pg from "pg";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { runClearedRefusalRowTests } from "./cleared-refusal-rows.integration.spec";

/**
 * `F3.54` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "F3.54",
  label: "cleared-message refusal rows",
  because:
    "whether a refused CLEARED message's row reaches bms.notification_deliveries is the whole of " +
    "ADR 0057 Amendment 4, and it is decided by the real status CHECK, the real organization_id " +
    "NOT NULL and the real alarm_id foreign key — a fake has none of them, so a green run without " +
    "a database proves only that an insert was attempted.",
});

describe.skipIf(!connectionString)("F3.54 cleared-message refusal rows", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.54");
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  it("writes the refusal row for a cleared message at both failed reads, and writes none for an escalation step", async () => {
    if (!pool) throw new Error("pool not initialised");
    await runClearedRefusalRowTests(pool, createDb(pool));
  }, 120_000);
});
