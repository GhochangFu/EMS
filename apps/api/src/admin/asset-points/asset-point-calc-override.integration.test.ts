import pg from "pg";

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { CalcDefinitionsService } from "../../calc/calc-definitions.service";
import { CalcDependencyService } from "../../calc/calc-dependency.service";
import { CalcScopeService } from "../../calc/calc-scope.service";
import { MetricsService } from "../../observability/metrics.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { registerFixturePointKeys } from "../../testing/integration-fixtures";
import { loadFixtures, type Fixtures } from "../asset-templates/asset-templates.instantiate.integration.spec";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetPointCalcOverrideService } from "./asset-point-calc-override.service";
import {
  assertAnExistingMappingRowIsNeverOverridden,
  assertClearNullsEveryColumnAndKeepsTheRow,
  assertD1IsEnforcedOnTheWritePath,
  assertOnlyDeclaredDerivedPointsAreOverridable,
  assertOutOfScopeAssetIsRefused,
  assertComputedRowCannotBeReKeyed,
  assertFormulaCannotReferenceADerivedPoint,
  assertReadReportsTheTriple,
  assertSetCreatesTheRowEagerly,
  assertSetUpdatesAnExistingRowInPlace,
  assertV2OverrideAdmitsADerivedReference,
  assertV2OverrideRefusesStreaming,
  cleanup,
} from "./asset-point-calc-override.integration.spec";

/**
 * `F2.6` U7 — Vitest entry point for per-asset calc overrides. Assertions live
 * in the sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "F2.6",
  label: "asset point calc override tests",
  because:
    "decision 7's eager create is a row shape — source_kind computed, rtu_id null, a " +
    "synthesised source_data_key — that asset_points_source_ref_check either accepts or " +
    "does not, and the refusals are guarantees about rows that must NOT exist. The one " +
    "that matters most keeps U1's estate-wide invariant true: no non-computed row ever " +
    "carries a calc override, and this endpoint is the only thing that could break it.",
});

describe.skipIf(!connectionString)("F2.6 — asset point calc overrides", () => {
  let pool: pg.Pool | undefined;
  let svc: AssetPointCalcOverrideService;
  let fx: Fixtures;
  let releasePointKeys: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const created = await openIntegrationPool(connectionString as string, "F2.6");
    pool = created;
    // `F3.39`: `asset_points.point_key` references `point_keys(code)` from
    // migration `0057`. See `registerFixturePointKeys`.
    releasePointKeys = await registerFixturePointKeys(created, [
      "F26_OVR_DERIVED",
      // `F2.9` — the derived *sibling* the `bms-calc-v2` case references.
      "F26_OVR_DERIVED_2",
      "F26_OVR_MEASURED",
    ]);
    const db = createDb(created);
    svc = new AssetPointCalcOverrideService(
      db,
      db,
      new AccessControlService(db, db),
      new MasterDataAuditService(db, db),
      // `F2.9` Task 12 — the real detector, not a stub. The two `v2` cases in
      // this suite are cycle-free by construction (`F26_OVR_DERIVED_2` is a
      // `v1` formula over a measured key, and `F26_OVR_MEASURED` is never a
      // graph node), so they now also hold that the detector admits what it
      // should. The refusals themselves live in the `.cycles` sibling.
      new CalcDependencyService(db, new CalcDefinitionsService(db, new MetricsService()), new CalcScopeService(db)),
    );
    fx = await loadFixtures(created);
    await cleanup(created);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      await releasePointKeys?.();
      await pool.end();
    }
  });

  beforeEach(async () => {
    if (pool) {
      await cleanup(pool);
    }
  });

  it("creates the asset_points row eagerly, computed and rtu-less (decision 7)", async () => {
    if (!pool) throw new Error("pool required");
    await assertSetCreatesTheRowEagerly(pool, svc, fx);
  });

  it("updates an existing row in place rather than creating a second", async () => {
    if (!pool) throw new Error("pool required");
    await assertSetUpdatesAnExistingRowInPlace(pool, svc, fx);
  });

  it("clears all five columns and keeps the row", async () => {
    if (!pool) throw new Error("pool required");
    await assertClearNullsEveryColumnAndKeepsTheRow(pool, svc, fx);
  });

  it("D-1 — refuses an unusable merge on the write path, writing nothing", async () => {
    if (!pool) throw new Error("pool required");
    await assertD1IsEnforcedOnTheWritePath(pool, svc, fx);
  });

  it("refuses a measured point and an undeclared point key", async () => {
    if (!pool) throw new Error("pool required");
    await assertOnlyDeclaredDerivedPointsAreOverridable(pool, svc, fx);
  });

  it("never attaches an override to an existing telemetry mapping row", async () => {
    if (!pool) throw new Error("pool required");
    await assertAnExistingMappingRowIsNeverOverridden(pool, svc, fx);
  });

  it("refuses an asset outside the caller's writable scope", async () => {
    if (!pool) throw new Error("pool required");
    await assertOutOfScopeAssetIsRefused(pool, svc, fx);
  });

  it("reports template, override and effective as three distinct values", async () => {
    if (!pool) throw new Error("pool required");
    await assertReadReportsTheTriple(pool, svc, fx);
  });

  it("refuses an override formula that references a derived point", async () => {
    if (!pool) throw new Error("pool required");
    await assertFormulaCannotReferenceADerivedPoint(pool, fx, svc);
  });

  it("ADR 0055 decision 7 — a bms-calc-v2 override may reference a derived sibling", async () => {
    if (!pool) throw new Error("pool required");
    await assertV2OverrideAdmitsADerivedReference(pool, fx, svc);
  });

  it("ADR 0055 decision 10 — a bms-calc-v2 override may not be streaming", async () => {
    if (!pool) throw new Error("pool required");
    await assertV2OverrideRefusesStreaming(pool, fx, svc);
  });

  it("refuses to re-key a computed row from the mapping surface", async () => {
    if (!pool) throw new Error("pool required");
    await assertComputedRowCannotBeReKeyed(pool, fx, svc);
  });
});
