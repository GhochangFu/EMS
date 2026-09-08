import { afterAll, beforeAll, describe, it } from "vitest";
import type pg from "pg";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { runControlCharacterErrorTests } from "./control-character-error.integration.spec";

/**
 * `F3.51` second review (Medium) — Vitest entry point. Assertions live in the
 * sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "F3.51",
  label: "control characters in a delivery error",
  because:
    "the claim is about what Postgres accepts in a text parameter — it refuses 0x00 outright — " +
    "and a fake insert accepts anything, so a green run without a database would prove only " +
    "that a string was passed along, not that the ledger row survived it.",
});

describe.skipIf(!connectionString)("F3.51 control characters in a delivery error", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.51");
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  it("records a transport error carrying a control character without losing the row", async () => {
    if (!pool) throw new Error("pool not initialised");
    await runControlCharacterErrorTests(pool, createDb(pool));
  }, 120_000);
});
