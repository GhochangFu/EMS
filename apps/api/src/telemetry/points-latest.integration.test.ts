import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { inRolledBackTransaction } from "../dashboard/kpi-prior.integration.spec";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertASampleInsideTheWindowIsReturned,
  assertASampleOutsideTheWindowIsOmitted,
  assertAnUnsampledPairIsAbsent,
  assertARepeatedPairAnswersOnce,
  assertOnlyTheNamedAssetsAndKeysAreRead,
  assertTheLatestOfTwoIsChosen,
} from "./points-latest.integration.spec";

/**
 * `F4.176` — Vitest entry point for the batched latest-value read against a
 * real database. Assertions live in the sibling `.spec` (ADR 0014, AGENTS.md
 * §4.6); this file owns the pool, and every case runs in a transaction that is
 * rolled back in a `finally`.
 *
 * The default `connection: "fleet"`, for the reason the at-instant suite
 * gives: its `BYPASSRLS` lets the fixture write the FORCE-RLS `bms.*` rows,
 * and `telemetry.point_values` carries no RLS, so the read is the same on the
 * tenant pool production uses.
 */
const connectionString = requireIntegrationDb({
  item: "F4.176",
  label: "latest point values in a window",
  because:
    "the window bound, the DISTINCT ON choice of the latest sample and the two ANY filters are all SQL, " +
    "so a green run without a database proves only the controller's guards.",
});

describe.skipIf(!connectionString)("F4.176 — latest point values against Postgres", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F4.176");
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  const run = (fn: (client: pg.PoolClient) => Promise<void>) => () =>
    inRolledBackTransaction(pool as pg.Pool, fn);

  it("returns a sample inside the window whole", run(assertASampleInsideTheWindowIsReturned));

  it("omits a sample outside the window", run(assertASampleOutsideTheWindowIsOmitted));

  it("chooses the latest of two samples", run(assertTheLatestOfTwoIsChosen));

  it("leaves an unsampled pair absent beside a sampled one", run(assertAnUnsampledPairIsAbsent));

  it("reads only the named assets and keys", run(assertOnlyTheNamedAssetsAndKeysAreRead));

  it("answers a repeated pair once", run(assertARepeatedPairAnswersOnce));
});
