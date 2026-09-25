import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import {
  assertKpisTotalKwUnchanged,
  assertNonKwSampleCountsAsFresh,
  assertOutOfScopeFreshAssetIsNotCounted,
  assertRtuRowsCountNonKwFresh,
  assertSitesOnlineUsesAnyPoint,
  assertSitesOnlineWindowIs25s,
  assertTelemetryFreshnessReadsConstant,
  assertTelemetryFreshnessStaleBeyondWindow,
  assertThreeSamplesDoNotFanOutTotalKw,
  assertTotalKwSumsStaleKw,
  inRolledBackTransaction,
} from "./dashboard-freshness.integration.spec";

/**
 * `F3.30` — Vitest entry point for the dashboard's freshness counts against a
 * real database (ADR 0075 decision 2). Assertions live in the sibling
 * `.spec` (ADR 0014, AGENTS.md §4.6); this file owns the pool, and every case
 * runs in a transaction the spec rolls back.
 *
 * The default `connection: "fleet"` matches production: `DashboardService`
 * runs on `FLEET_POOL` (ADR 0043), and `bms_fleet`'s `BYPASSRLS` lets the
 * fixture write the FORCE-RLS tables without an `app.current_organization`
 * bracket. `max: 1`: the cases run one at a time on one connection.
 */
const connectionString = requireIntegrationDb({
  item: "F3.30",
  label: "dashboard freshness counts",
  because:
    "the any-point `live` CTE, its 25 s window and the unchanged `total_kw` sum are all SQL, " +
    "so a green run without a database asserts nothing about any of them.",
});

describe.skipIf(!connectionString)("F3.30 — dashboard freshness counts use the any-point rule", () => {
  let pool: pg.Pool | undefined;

  beforeAll(async () => {
    pool = await openIntegrationPool(connectionString as string, "F3.30", { max: 1 });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  }, 60_000);

  const run = (fn: (client: pg.PoolClient) => Promise<void>) => () =>
    inRolledBackTransaction(pool as pg.Pool, fn);

  it("locationKpis counts a non-kw sample 5 s old as fresh", run(assertNonKwSampleCountsAsFresh), 60_000);

  it("locationKpis still sums a stale kw into totalKw and does not count it fresh", run(assertTotalKwSumsStaleKw), 60_000);

  it("locationDashboard's RTU row counts a non-kw fresh asset and not a 60 s one", run(assertRtuRowsCountNonKwFresh), 60_000);

  it("kpis.sitesOnline counts a site whose fresh sample is not kw", run(assertSitesOnlineUsesAnyPoint), 60_000);

  it("kpis.sitesOnline counts a 21 s sample and not a 30 s one", run(assertSitesOnlineWindowIs25s), 60_000);

  it("kpis.totalKw still sums a stale kw with no site online", run(assertKpisTotalKwUnchanged), 60_000);

  it("the asset rows call a 22 s sample live", run(assertTelemetryFreshnessReadsConstant), 60_000);

  it("the asset rows call a 30 s sample stale", run(assertTelemetryFreshnessStaleBeyondWindow), 60_000);

  it("three samples of one asset do not fan out totalKw or freshAssetCount", run(assertThreeSamplesDoNotFanOutTotalKw), 60_000);

  it("a fresh asset outside assetIds stays out of freshAssetCount", run(assertOutOfScopeFreshAssetIsNotCounted), 60_000);
});
