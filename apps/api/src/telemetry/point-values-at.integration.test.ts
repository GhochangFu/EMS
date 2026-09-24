import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { inRolledBackTransaction } from "../dashboard/kpi-prior.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertADuplicateRefAnswersOncePerRequest,
  assertANoSampleRefIsNullsInItsPosition,
  assertASampleAfterAtIsIgnored,
  assertReadsTheLatestSampleAtOrBeforeAt,
} from "./point-values-at.integration.spec";

/**
 * `F3.28` — Vitest entry point for the batched at-instant read against a real
 * database. Assertions live in the sibling `.spec` (ADR 0014, AGENTS.md §4.6);
 * this file owns the pool, and every case runs in a transaction that is rolled
 * back in a `finally`.
 *
 * The default `connection: "fleet"`: its `BYPASSRLS` lets the fixture write the
 * FORCE-RLS `bms.*` rows the asset needs without an `app.current_organization`
 * bracket. `telemetry.point_values` carries no RLS, so the read itself is the
 * same on the tenant pool production uses.
 */
const connectionString = requireIntegrationDb({
  item: "F3.28",
  label: "point values at an instant",
  because:
    "the `time <= at` LATERAL read, its ordering and the request-order ordinal are all SQL, " +
    "so a green run without a database proves only the controller's guards.",
});

describe.skipIf(!connectionString)("F3.28 — point values at an instant against Postgres", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.28");
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  const run = (fn: (client: pg.PoolClient) => Promise<void>) => () =>
    inRolledBackTransaction(pool as pg.Pool, fn);

  it("reads the T−2h sample for at = T−90m", run(assertReadsTheLatestSampleAtOrBeforeAt));

  it("answers nulls in the position of a ref with no sample at or before at", run(assertANoSampleRefIsNullsInItsPosition));

  it("ignores a sample stamped after at", run(assertASampleAfterAtIsIgnored));

  it("answers a duplicated ref once per request", run(assertADuplicateRefAnswersOncePerRequest));
});
