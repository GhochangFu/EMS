import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertAStaleIncomerDropsOutOfBothSums,
  assertAnEntirelyStaleScopeIsNull,
  assertEmptyScopeIsNull,
  assertFixtureIsVisibleInTheHourlyView,
  assertHalfPairIsExcludedFromBothSums,
  assertLatestOneIncomerIsItsOwnRatio,
  assertLatestSumsBothIncomers,
  assertNullScopeReadsEveryIncomer,
  assertWindowBoundsExcludeOutsideBuckets,
  assertWindowedEmptyScopeIsNull,
  assertWindowedExcludesTheHalfPair,
  assertWindowedSumsBothIncomers,
  assertWindowedUsesTheWeightedMean,
  cleanup,
  setupFixtures,
  type Fixtures,
} from "./pue-ratio.integration.spec";

/**
 * `F2.8` — Vitest entry point for the PUE reader against a real database.
 * Assertions live in the sibling `.spec` (ADR 0014, AGENTS.md §4.6); this file
 * owns the database lifecycle.
 *
 * The default `connection: "fleet"` is the right one and not an accident: both
 * functions under test are called by `DashboardService` and `ReportsService` on
 * their injected `FLEET_POOL` (ADR 0043 Amendments 2/3), and the fixture writes
 * to `bms.organizations`/`bms.locations`/`bms.assets`, all FORCE ROW LEVEL
 * SECURITY since migration `0047`. `bms_fleet` holds `BYPASSRLS`, so those
 * writes need no `app.current_organization` bracket — the containment this
 * reader relies on is the `uuid[]` scope, which is exactly what the cases below
 * exercise.
 */
const connectionString = requireIntegrationDb({
  item: "F2.8",
  label: "PUE ratio reader tests",
  because:
    "the pairing rule (HAVING COUNT(*) = 2), the DISTINCT ON latest read, the window mean " +
    "through the continuous aggregate's real-time branch and the uuid[] scope are all engine " +
    "behaviours, so a green run without a database proves only the arithmetic.",
});

describe.skipIf(!connectionString)("F2.8 — PUE reader against Postgres", () => {
  let pool: pg.Pool | undefined;
  let fx: Fixtures;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F2.8");
    pool = created;
    fx = await setupFixtures(created);
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await cleanup(pool).catch(() => undefined);
      await pool.end();
    }
  }, 60_000);

  it("has a fixture the hourly aggregate can actually see", async () => {
    await assertFixtureIsVisibleInTheHourlyView(pool as pg.Pool, fx);
  });

  it("sums site_kw and it_kw over every paired incomer in scope (ruling 3)", async () => {
    await assertLatestSumsBothIncomers(pool as pg.Pool, fx);
  });

  it("reduces to one incomer's own ratio, and honours a scope that excludes another", async () => {
    await assertLatestOneIncomerIsItsOwnRatio(pool as pg.Pool, fx);
  });

  /** The `HAVING COUNT(*) = 2` mutation fails here, and only here. */
  it("leaves an incomer with site_kw but no it_kw out of both sums", async () => {
    await assertHalfPairIsExcludedFromBothSums(pool as pg.Pool, fx);
  });

  it("answers null for an empty scope rather than reading the estate", async () => {
    await assertEmptyScopeIsNull(pool as pg.Pool);
  });

  /** The owner's ruling of 2026-09-06: the latest read is bounded at 15 minutes. */
  it("leaves an incomer that stopped reporting 20 minutes ago out of both sums", async () => {
    await assertAStaleIncomerDropsOutOfBothSums(pool as pg.Pool, fx);
  });

  it("answers null when every incomer in scope has gone silent", async () => {
    await assertAnEntirelyStaleScopeIsNull(pool as pg.Pool, fx);
  });

  it("reads every incomer when the scope is null", async () => {
    await assertNullScopeReadsEveryIncomer(pool as pg.Pool, fx);
  });

  it("takes the weighted window mean, never an average of averages", async () => {
    await assertWindowedUsesTheWeightedMean(pool as pg.Pool, fx);
  });

  it("sums the window means over every paired incomer in scope", async () => {
    await assertWindowedSumsBothIncomers(pool as pg.Pool, fx);
  });

  it("leaves the half pair out of a windowed read too", async () => {
    await assertWindowedExcludesTheHalfPair(pool as pg.Pool, fx);
  });

  it("counts only the buckets inside [start, end]", async () => {
    await assertWindowBoundsExcludeOutsideBuckets(pool as pg.Pool, fx);
  });

  it("answers null for an empty scope on the windowed read", async () => {
    await assertWindowedEmptyScopeIsNull(pool as pg.Pool, fx);
  });
});
