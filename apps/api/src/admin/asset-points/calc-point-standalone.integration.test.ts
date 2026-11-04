import pg from "pg";

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { CalcDefinitionsService } from "../../calc/calc-definitions.service";
import { CalcDependencyService } from "../../calc/calc-dependency.service";
import { CalcParametersService } from "../../calc/calc-parameters.service";
import { CalcScopeService } from "../../calc/calc-scope.service";
import { CalcStatusRegistry } from "../../calc/calc-status.registry";
import { MetricsService } from "../../observability/metrics.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { registerFixturePointKeys } from "../../testing/integration-fixtures";
import { loadFixtures, type Fixtures } from "../asset-templates/asset-templates.instantiate.integration.spec";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  assertABatchAcrossOrganizationsWritesNothing,
  assertABatchOfSelfReadingAggregatesWritesNothing,
  assertABatchRefusesMissingAndOutOfScopeAlike,
  assertABatchRefusesOnlyTheTemplatedAsset,
  assertABatchWithOneRefusalWritesNothing,
  assertABatchWritesEveryAsset,
  assertACycleIsRefused,
  assertAMappingRowIsRefused,
  assertAMeasuredRowIsNotTurnedIntoAFormula,
  assertAnUnknownCatalogKeyIsRefused,
  assertAnUnknownParameterIsRefused,
  assertAnUnresolvedCodeIsRefused,
  assertASelfReadingAggregateIsRefusedOnCreate,
  assertAWidgetBoundPointIsNotDeleted,
  assertKindOfABareAssetIsStandalone,
  assertListServesStandaloneItems,
  assertOutOfScopeAssetIsRefused,
  assertRemoveDeletesTheRow,
  assertRemoveRefusesATelemetryRow,
  assertSetCreatesAComputedRow,
  assertSetIsAudited,
  assertSetReplacesInPlace,
  assertTheEngineRulesAreEnforced,
  CALC_KEY,
  CALC_KEY_2,
  CALC_KEY_UNIT,
  cleanup,
  MEASURED_KEY,
} from "./calc-point-standalone.integration.spec";
import { CalcPointStandaloneService } from "./calc-point-standalone.service";

/**
 * `F4.311` PR 2 — Vitest entry point for the standalone calc-point write
 * rules (ADR 0109 decision 3). Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "F4.311",
  label: "standalone calc point write tests",
  because:
    "every refusal is a guarantee about an asset_points row that must NOT exist, and the " +
    "batch's all-or-nothing is a transaction outcome — neither is visible without a database.",
});

describe.skipIf(!connectionString)("F4.311 — standalone calculated points (ADR 0109)", () => {
  let pool: pg.Pool | undefined;
  let svc: CalcPointStandaloneService;
  let fx: Fixtures;
  let releasePointKeys: (() => Promise<void>) | undefined;
  let previousCalcKeyUnit: string | null = null;

  const run = (claim: (pool: pg.Pool, svc: CalcPointStandaloneService, fx: Fixtures) => Promise<void>) => async () => {
    if (!pool) throw new Error("pool required");
    await claim(pool, svc, fx);
  };

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F4.311");
    pool = created;
    releasePointKeys = await registerFixturePointKeys(created, [MEASURED_KEY, CALC_KEY, CALC_KEY_2]);
    // A real catalog unit, so the "unit is stamped" claim is not `null === null`.
    const { rows: unitRows } = await created.query<{ unit: string | null }>(
      `SELECT unit FROM bms.point_keys WHERE code = $1`,
      [CALC_KEY],
    );
    previousCalcKeyUnit = unitRows[0]?.unit ?? null;
    await created.query(`UPDATE bms.point_keys SET unit = $2 WHERE code = $1`, [CALC_KEY, CALC_KEY_UNIT]);
    const db = createDb(created);
    const scope = new CalcScopeService(db);
    svc = new CalcPointStandaloneService(
      db,
      db,
      new AccessControlService(db, db),
      new MasterDataAuditService(db, db),
      new CalcDependencyService(db, new CalcDefinitionsService(db, new MetricsService()), scope),
      new CalcParametersService(db),
      scope,
      new CalcStatusRegistry(),
    );
    fx = await loadFixtures(created);
    await cleanup(created);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      await pool.query(`UPDATE bms.point_keys SET unit = $2 WHERE code = $1`, [CALC_KEY, previousCalcKeyUnit]);
      await releasePointKeys?.();
      await pool.end();
    }
  });

  beforeEach(async () => {
    if (pool) {
      await cleanup(pool);
    }
  });

  it("creates a computed, rtu-less row with all five columns and the catalog unit", run(assertSetCreatesAComputedRow));
  it("audits the set without the formula", run(assertSetIsAudited));
  it("replaces an existing point in place", run(assertSetReplacesInPlace));
  it("lists the point as a standalone item in standalone mode", run(assertListServesStandaloneItems));
  it("deletes the row on DELETE and audits it", run(assertRemoveDeletesTheRow));
  it("never deletes a telemetry row", run(assertRemoveRefusesATelemetryRow));
  it("refuses an asset outside the caller's scope", run(assertOutOfScopeAssetIsRefused));
  it("rule 1 — refuses a key the catalog does not hold", run(assertAnUnknownCatalogKeyIsRefused));
  it("rule 2 — refuses a key that is a telemetry row", run(assertAMappingRowIsRefused));
  it("rule 2 at the write — does not turn a measured row into a formula", run(assertAMeasuredRowIsNotTurnedIntoAFormula));
  it("rule 3 — refuses a v1 formula reading a key this asset does not declare", run(assertTheEngineRulesAreEnforced));
  it("rule 4 — refuses an unknown parameter key", run(assertAnUnknownParameterIsRefused));
  it("rule 5 — refuses a qualified code that resolves nowhere", run(assertAnUnresolvedCodeIsRefused));
  it("rule 7 — refuses a formula that closes a cycle", run(assertACycleIsRefused));
  it("dispatches a template-less asset as standalone", run(assertKindOfABareAssetIsStandalone));
  it("batch — writes every asset when none is refused", run(assertABatchWritesEveryAsset));
  it("batch — writes nothing when one asset is refused", run(assertABatchWithOneRefusalWritesNothing));
  it("batch — refuses an asset in a second organization and writes nothing", run(assertABatchAcrossOrganizationsWritesNothing));
  it("rule 7 on create — refuses a bare asset's self-reading site sum", run(assertASelfReadingAggregateIsRefusedOnCreate));
  it("batch — refuses every self-reading aggregate at one site and writes nothing", run(assertABatchOfSelfReadingAggregatesWritesNothing));
  it("refuses to delete a point a dashboard widget shows", run(assertAWidgetBoundPointIsNotDeleted));
  it("batch — refuses only the templated asset and writes neither", run(assertABatchRefusesOnlyTheTemplatedAsset));
  it("batch — refuses a missing id and an out-of-scope asset with one sentence and no code", run(assertABatchRefusesMissingAndOutOfScopeAlike));
});
