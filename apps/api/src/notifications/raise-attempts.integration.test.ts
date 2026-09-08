import { afterAll, beforeAll, describe, it } from "vitest";
import type pg from "pg";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { runRaiseAttemptsTests } from "./raise-attempts.integration.spec";

/**
 * `F3.51` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle.
 *
 * A new suite rather than four more blocks in
 * `storm-control.integration.spec.ts`: that file stood at 910 of AGENTS.md
 * §4.5's 1000-line cap, and `F3.54` split `cleared-refusal-rows.integration.*`
 * out at exactly this boundary for the same reason.
 */
const connectionString = requireIntegrationDb({
  item: "F3.51",
  label: "raise-key ledger reads",
  because:
    "which rows come back under an alarm's raise key decides whether an undelivered raise is " +
    "ever retried, and it is decided by a real WHERE over a real ledger — the unit fakes apply " +
    "no WHERE at all, so a green run without a database cannot tell a kept row from a filtered " +
    "one, and the ceiling-refused case would silently stop being retried.",
});

describe.skipIf(!connectionString)("F3.51 raise-key ledger reads", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.51");
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  it("returns every row under an alarm's raise key, including a ceiling refusal, and nobody else's", async () => {
    if (!pool) throw new Error("pool not initialised");
    await runRaiseAttemptsTests(pool, createDb(pool));
  }, 120_000);
});
