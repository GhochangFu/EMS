import pg from "pg";

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { CalcDefinitionsService } from "../../calc/calc-definitions.service";
import { CalcDependencyService } from "../../calc/calc-dependency.service";
import { CalcParametersService } from "../../calc/calc-parameters.service";
import { CalcScopeService } from "../../calc/calc-scope.service";
import { MetricsService } from "../../observability/metrics.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { registerFixturePointKeys } from "../../testing/integration-fixtures";
import { asRole } from "../../testing/role-urls";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetDashboardsInstantiateService } from "./asset-dashboards-instantiate.service";
import { AssetTemplateAdoptionService } from "./asset-templates-adopt.service";
import { AssetTemplatesAdminService } from "./asset-templates.service";
import {
  SUITE_POINT_KEYS,
  TEST_ASSET_PREFIX,
  adoptTheScenario,
  assertADomainMismatchRefuses,
  assertAPinnedAssetBlocksTheWholeBatch,
  assertARuleCodeCollisionAtTheInsertRollsBackTheTransaction,
  assertARuleCodeTakenAfterThePreviewRefusesAndWritesNothing,
  assertAUnitMismatchRefusesAndWritesNothing,
  assertAnAssetOutsideTheCallersScopeIs403,
  assertAnUndeclaredStandalonePointRefusesAndWritesNothing,
  assertAnUnpublishedVersionIs409,
  assertApplyRecomputesAfterACleanPreview,
  assertOneAuditRow,
  assertOneDashboard,
  assertOneSeededRule,
  assertTheEngineReadsTheRowAsTheOverride,
  assertTheHistoryIsKept,
  assertTheMeasuredRowIsUnchanged,
  assertTheMissingPointIsUnmappedWithNoRtu,
  assertThePinIsSet,
  assertThePreviewCouldApply,
  assertTheUndeclaredRowIsKept,
  cleanup,
  loadAdoptFixtures,
  type AdoptFixtures,
  type Scenario,
  type Services,
} from "./asset-templates.adopt.integration.spec";
import { loadFixtures } from "./asset-templates.instantiate.integration.spec";

/**
 * `F4.312` — Vitest entry point for template adoption. Assertions live in the
 * sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "F4.312",
  label: "template adoption tests",
  because:
    "every claim is a row: the pin, the unmapped row with no RTU, the rows that must not have " +
    "changed, the seeded rule, the dashboard, the audit row and the calc definition the engine " +
    "reads once the pin moves — and, after a refusal, the rows that must not exist. Real " +
    "bms_tenant/bms_fleet connections are also the only proof that withTenant binds the write.",
});

describe.skipIf(!connectionString)("F4.312 — adopting a template-less asset", () => {
  let pool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let fleetPool: pg.Pool | undefined;
  let svc: Services;
  let racing: AssetTemplateAdoptionService;
  let fx: AdoptFixtures;
  let releasePointKeys: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    const created = await openIntegrationPool(url, "F4.312");
    pool = created;
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.312",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.312",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F4.312",
    );

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const access = new AccessControlService(createDb(authPool), fleetDb);
    const audit = new MasterDataAuditService(tenantDb, fleetDb);
    const vocabularies = new VocabulariesService(tenantDb);
    const definitions = new CalcDefinitionsService(fleetDb, new MetricsService());
    const templates = new AssetTemplatesAdminService(
      fleetDb,
      tenantDb,
      access,
      audit,
      vocabularies,
      new CalcParametersService(fleetDb),
    );
    const build = (): AssetTemplateAdoptionService =>
      new AssetTemplateAdoptionService(
        fleetDb,
        tenantDb,
        access,
        audit,
        vocabularies,
        new CalcDependencyService(fleetDb, definitions, new CalcScopeService(fleetDb)),
        new AssetDashboardsInstantiateService(fleetDb, tenantDb, templates, audit, access),
      );
    svc = { adoption: build(), definitions };
    // The write-time net needs the plan's rule-code check out of the way, so a
    // second instance has it replaced; `svc` keeps the real one.
    // A rename of the private method would leave the stub inert and the case
    // refused at the plan instead of at the insert — refuse loudly here instead.
    if (typeof Reflect.get(AssetTemplateAdoptionService.prototype, "refuseTakenRuleCodes") !== "function") {
      throw new Error("F4.312 fixture defect: AssetTemplateAdoptionService.refuseTakenRuleCodes is gone");
    }
    racing = build();
    Reflect.set(racing, "refuseTakenRuleCodes", async () => undefined);

    releasePointKeys = await registerFixturePointKeys(created, SUITE_POINT_KEYS);
    fx = await loadAdoptFixtures(created, await loadFixtures(created));
    await cleanup(created);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      await releasePointKeys?.();
    }
    await Promise.all([pool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  });

  describe("a clean adoption", () => {
    let s: Scenario;

    beforeAll(async () => {
      if (!pool) throw new Error("pool required");
      await cleanup(pool);
      s = await adoptTheScenario(pool, svc, fx);
    });

    it("previews canApply: true", () => assertThePreviewCouldApply(s));
    it("pins the asset to the version", async () => assertThePinIsSet(pool as pg.Pool, s));
    it("adds the missing measured point as unmapped with rtu_id NULL, though the asset has an RTU (A3)", async () =>
      assertTheMissingPointIsUnmappedWithNoRtu(pool as pg.Pool, s, `${TEST_ASSET_PREFIX}CLEAN`));
    it("leaves the measured row unchanged", async () => assertTheMeasuredRowIsUnchanged(pool as pg.Pool, s));
    it("keeps the undeclared row (A2)", async () => assertTheUndeclaredRowIsKept(pool as pg.Pool, s));
    it("reads the standalone formula as the override of the template point (ruling 8)", async () =>
      assertTheEngineReadsTheRowAsTheOverride(pool as pg.Pool, svc, s));
    it("keeps the converted point's history", async () => assertTheHistoryIsKept(pool as pg.Pool, s));
    it("seeds the version's one alarm rule", async () => assertOneSeededRule(pool as pg.Pool, s));
    it("writes the version's one default dashboard", async () => assertOneDashboard(pool as pg.Pool, s));
    it("writes one audit row", async () => assertOneAuditRow(pool as pg.Pool, s));
  });

  describe("refusals", () => {
    beforeEach(async () => {
      if (pool) await cleanup(pool);
    });

    it("refuses an undeclared standalone point and writes nothing (A4)", async () =>
      assertAnUndeclaredStandalonePointRefusesAndWritesNothing(pool as pg.Pool, svc, fx));
    it("refuses a unit mismatch and writes nothing (A8)", async () =>
      assertAUnitMismatchRefusesAndWritesNothing(pool as pg.Pool, svc, fx));
    it("refuses the whole batch when one asset is pinned", async () =>
      assertAPinnedAssetBlocksTheWholeBatch(pool as pg.Pool, svc, fx));
    it("refuses an asset of another domain (A1)", async () =>
      assertADomainMismatchRefuses(pool as pg.Pool, svc, fx));
    it("recomputes at apply after a clean preview (owner ruling 1)", async () =>
      assertApplyRecomputesAfterACleanPreview(pool as pg.Pool, svc, fx));
    it("answers 403 for an asset outside the caller's scope (A10)", async () =>
      assertAnAssetOutsideTheCallersScopeIs403(pool as pg.Pool, svc, fx));
    it("answers 409 for an unpublished version", async () =>
      assertAnUnpublishedVersionIs409(pool as pg.Pool, svc, fx));
    it("refuses a rule code taken between preview and apply, writing nothing", async () =>
      assertARuleCodeTakenAfterThePreviewRefusesAndWritesNothing(pool as pg.Pool, svc, fx));
    it("rolls the whole transaction back on a rule code collision at the insert", async () =>
      assertARuleCodeCollisionAtTheInsertRollsBackTheTransaction(pool as pg.Pool, racing, fx));
  });
});
