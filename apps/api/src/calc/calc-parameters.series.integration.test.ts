import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { loadFixtures } from "../admin/asset-templates/asset-templates.instantiate.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { cleanup, seedParametersFixture, type ParametersFixture } from "./calc-parameters.integration.spec";
import {
  assertARangeAfterAnEndedRowDoesNotReturnIt,
  assertTheSeriesMatchesThePointReadOnTheGrid,
} from "./calc-parameters.series.integration.spec";

/**
 * `F4.311` task 5.4 — Vitest entry point for `resolveSeriesForAssets`.
 * Assertions live in the sibling `.spec` (ADR 0014); this file owns the
 * database lifecycle and seeds the `E4.1a` fixture once.
 */
const connectionString = requireIntegrationDb({
  item: "F4.311",
  label: "calc parameter series tests",
  because:
    "a backfill's $parameter value at each bucket is a database answer — the series read must equal " +
    "the point read on every instant, and only a database can run both.",
});

describe.skipIf(!connectionString)("F4.311 — the parameter series read (task 5.4)", () => {
  let pool: pg.Pool | undefined;
  let fixture: ParametersFixture;

  const run = (claim: (pool: pg.Pool, fixture: ParametersFixture) => Promise<void>) => async () => {
    if (!pool) throw new Error("pool required");
    await claim(pool, fixture);
  };

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F4.311");
    pool = created;
    const fx = await loadFixtures(created);
    await cleanup(created);
    fixture = await seedParametersFixture(created, fx);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      await pool.end();
    }
  });

  it("answers what the point read answers at every grid instant", run(assertTheSeriesMatchesThePointReadOnTheGrid));
  it("returns no row that ended before the range starts", run(assertARangeAfterAnEndedRowDoesNotReturnIt));
});
