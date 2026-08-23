import { afterAll, beforeAll, describe, it } from "vitest";
import type pg from "pg";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { runStormControlTests } from "./storm-control.integration.spec";

/**
 * `F3.8` — Vitest entry point for the storm-control suite. Assertions live in
 * the sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "F3.8",
  label: "notification storm-control tests",
  because:
    "whether re-evaluating every enabled rule against an unchanged plant sends zero notifications " +
    "depends on the seeded rule set and on rows written to bms.notification_deliveries, so a green " +
    "run without a database proves nothing about the control that keeps a client's inbox intact.",
});

describe.skipIf(!connectionString)("F3.8 storm control", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.8");
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  it("sends nothing for an unchanged plant, once for a real transition, and honours the ceiling", async () => {
    if (!pool) throw new Error("pool not initialised");
    await runStormControlTests(pool, createDb(pool));
  }, 120_000);
});
