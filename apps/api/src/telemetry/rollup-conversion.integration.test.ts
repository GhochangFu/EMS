import type pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { DashboardService } from "../dashboard/dashboard.service";
import { ReportsService } from "../reports/reports.service";
import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../testing/integration-db-gate";
import {
  assertEnergySourceMixMatchesRaw,
  assertFixtureIsOnlyOnTheLiveBranch,
  assertLoadTrendMatchesRaw,
  assertReportPreviewMatchesRaw,
  assertReportTopConsumersMatchRaw,
  assertSuiteLeftNoOrphans,
  assertTopConsumersMatchRaw,
  cleanupProbes,
  createProbes,
  type Probes,
} from "./rollup-conversion.integration.spec";

/**
 * `F4.28` / ADR 0025 — Vitest entry point for the six converted rollup reads.
 * Assertions live in the sibling `.spec` (§4.6); this file owns the lifecycle.
 *
 * **Ordering is load-bearing.** `assertSuiteLeftNoOrphans` must run last and only
 * after the raw fixture is deleted — it is the check that this suite did not do to
 * the shared database what `F4.1`'s did (`eb8a55b`). Vitest runs `it` blocks in
 * declaration order within a file, so the orphan check is declared last and the
 * `DELETE` it depends on happens in `afterAll`... which runs *after* every test.
 * So the orphan check cannot live in an `it` at all: it is called from `afterAll`,
 * after the delete, where a throw still fails the suite.
 *
 * **It really does fail the suite, and the output is misleading about it** —
 * verified by forcing the throw. Vitest still prints `Tests 5 passed`, because that
 * line counts `it` blocks and all five did pass; what changes is
 * `Test Files 1 failed` and a non-zero exit. Do not read the passing test count as
 * evidence that this guard is decorative.
 *
 * Every read here is scoped to the two probe assets, so the simulator and the MQTT
 * ingest writing concurrently cannot make the comparison flaky.
 */

const connectionString = requireIntegrationDb({
  item: "F4.28",
  label: "rollup conversion tests",
  because:
    "each of the six converted sites is compared against the raw query it replaced, and the " +
    "two that can detect an avg-of-averages regression only do so against real aggregate rows. " +
    "The real-time branch, the sum/count composition and the bucket-vs-time predicate are all " +
    "TimescaleDB behaviours, so a green run without a database asserts nothing.",
});

describe.skipIf(!connectionString)("F4.28 — rollup reads on the aggregates", () => {
  let pool: pg.Pool | undefined;
  let probes: Probes;
  let dashboard: DashboardService;
  let reports: ReportsService;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F4.28");
    pool = created;
    await cleanupProbes(created);
    probes = await createProbes(created);
    // Prove the two premises the whole design rests on before asserting anything
    // that depends on them: the fixture is visible only through the real-time
    // branch, and no refresh policy's window can ever reach it.
    await assertFixtureIsOnlyOnTheLiveBranch(created, probes);
    dashboard = new DashboardService(created);
    reports = new ReportsService(created);
  }, 120_000);

  afterAll(async () => {
    if (!pool) {
      return;
    }
    try {
      await cleanupProbes(pool);
      // After the delete, and only here: nothing may remain in any of the four
      // views for these assets. See the note above on why this is not an `it`.
      await assertSuiteLeftNoOrphans(pool, probes);
    } finally {
      await pool.end();
    }
  }, 120_000);

  // ---- dashboard --------------------------------------------------------------

  /** Site 1. Fold 1 — proves translation, not the mean. */
  it("loadTrend matches the raw minute-bucket query", async () => {
    await assertLoadTrendMatchesRaw(pool as pg.Pool, probes, (window, assetIds) =>
      dashboard.loadTrend(window, assetIds),
    );
  }, 60_000);

  /** Site 2, both branches. Fold 1 — proves translation and the solar split. */
  it("energySourceMix matches raw at minute and hour granularity", async () => {
    await assertEnergySourceMixMatchesRaw(pool as pg.Pool, probes, (window, assetIds) =>
      dashboard.energySourceMix(window, assetIds),
    );
  }, 60_000);

  /**
   * Site 3. **Discriminating** — many `_1m` rows fold into one mean, so this fails
   * if `avgExpr` regresses to an average of averages. Verified by mutation.
   */
  it("energyTopConsumers matches raw, and the naive avg form would not", async () => {
    await assertTopConsumersMatchRaw(pool as pg.Pool, probes, (window, limit, assetIds) =>
      dashboard.energyTopConsumers(window, limit, assetIds),
    );
  }, 60_000);

  // ---- reports ----------------------------------------------------------------

  /**
   * Sites 4 and 5, and the first coverage `apps/api/src/reports/` has ever had
   * (ADR 0025 fact 7). Both fold 1.
   */
  it("the report preview's summary and source totals match raw", async () => {
    await assertReportPreviewMatchesRaw(pool as pg.Pool, probes, (query, assetIds) =>
      reports.energyPreview(query, assetIds),
    );
  }, 60_000);

  /**
   * Site 6. **Discriminating**, and the sharper of the two: at `_1h` the naive
   * form's error reaches 11.19 kW against `_1m`'s 0.046 (ADR 0025 fact 4).
   */
  it("the report's top consumers match raw, and the naive avg form would not", async () => {
    await assertReportTopConsumersMatchRaw(pool as pg.Pool, probes, (query, assetIds) =>
      reports.energyPreview(query, assetIds),
    );
  }, 60_000);
});
