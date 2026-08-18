import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertFiniteValueStillAccepted,
  assertNonFiniteValuesAreRejected,
  assertPrescribedIdiomWouldNotHaveWorked,
  cleanup,
} from "./finite-value-check.integration.spec";

/**
 * `F4.32` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle.
 *
 * It has to be an integration suite: the guarantee being moved is a **database
 * constraint**, and the whole point of `F4.32` is that the previous guarantee
 * was enforced by application code. A unit test would re-assert the thing that
 * was never in doubt.
 */
const connectionString = requireIntegrationDb({
  item: "F4.32",
  label: "non-finite telemetry value tests",
  because:
    "they are the only check that point_values_value_finite_check exists and is " +
    "the range form rather than the no-op `CHECK (value = value)` the row " +
    "prescribed. Without a database, a green run proves the constraint is absent " +
    "exactly as well as it proves it is present.",
});

describe.skipIf(!connectionString)("F4.32 finite telemetry values", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.32");
    await cleanup(pool);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      await pool.end();
    }
  });

  it("refuses NaN and both infinities from a direct writer", async () => {
    await assertNonFiniteValuesAreRejected(pool);
  });

  it("still accepts an ordinary reading", async () => {
    await assertFiniteValueStillAccepted(pool);
  });

  it("records why `CHECK (value = value)` was not used", async () => {
    await assertPrescribedIdiomWouldNotHaveWorked(pool);
  });
});
