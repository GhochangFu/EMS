import pg from "pg";

import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { registerFixturePointKeys } from "../../testing/integration-fixtures";
import { asRole } from "../../testing/role-urls";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetTemplateMigrationService } from "./asset-templates-migrate.service";
import { loadFixtures, type Fixtures } from "./asset-templates.instantiate.integration.spec";
import {
  DERIVED_KEY,
  LATER_MEASURED_KEY,
  MEASURED_KEY,
  assertARatioOnlyChangeIsReportedByPreview,
  assertAnOverrideMadeIllegalByTheTargetVersionRefusesAndPinsNothing,
  assertAnOverrideStillLegalOnTheTargetVersionMigrates,
  cleanup,
} from "./asset-templates.migrate-override.integration.spec";

/**
 * `F2.9` Task 12b — Vitest entry point for the migrate-time re-validation of an
 * asset's calc override. Assertions live in the sibling `.spec` (ADR 0014);
 * this file owns the database lifecycle.
 */
const connectionString = requireIntegrationDb({
  item: "F2.9",
  label: "migrate-time calc override re-validation",
  because:
    "the guarantee is about a row that must NOT have moved — assets.template_id still on the " +
    "source version after a refusal. A 409 with the pin already repointed passes every " +
    "assertion a pure test can make, and it is exactly the failure findings 31 and 34 " +
    "describe. The override itself is an asset_points row that only a database holds.",
});

describe.skipIf(!connectionString)("F2.9 Task 12b — migration re-validates the override", () => {
  let pool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let fleetPool: pg.Pool | undefined;
  let svc: AssetTemplateMigrationService;
  let fx: Fixtures;
  let releasePointKeys: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const url = connectionString as string;
    const created = await openIntegrationPool(url, "F2.9");
    pool = created;
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F2.9",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F2.9",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F2.9",
    );

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    svc = new AssetTemplateMigrationService(
      fleetDb,
      tenantDb,
      new AccessControlService(createDb(authPool), fleetDb),
      new MasterDataAuditService(tenantDb, fleetDb),
    );
    // `0057`/`0058` give both `asset_points.point_key` and
    // `template_points.point_key` a foreign key onto `point_keys(code)`. These
    // three codes belong to this suite alone — see the spec's note on why it
    // does not borrow the migrate suite's `KW`.
    releasePointKeys = await registerFixturePointKeys(created, [
      MEASURED_KEY,
      DERIVED_KEY,
      LATER_MEASURED_KEY,
    ]);
    fx = await loadFixtures(created);
    await cleanup(created);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
      await releasePointKeys?.();
    }
    await Promise.all([pool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  });

  // Every case seeds at (org, TEST_TEMPLATE_CODE, version), and
  // asset_templates_org_code_version_unique means the previous case's rows must
  // be gone first.
  beforeEach(async () => {
    if (pool) {
      await cleanup(pool);
    }
  });

  it("refuses a migration that would invalidate the asset's own override, and moves no pin", async () => {
    if (!pool) throw new Error("pool required");
    await assertAnOverrideMadeIllegalByTheTargetVersionRefusesAndPinsNothing(pool, svc, fx);
  });

  it("migrates when the override is still legal on the target version", async () => {
    if (!pool) throw new Error("pool required");
    await assertAnOverrideStillLegalOnTheTargetVersionMigrates(pool, svc, fx);
  });

  it("reports a min_coverage_ratio-only change in migration-preview (finding 31)", async () => {
    if (!pool) throw new Error("pool required");
    await assertARatioOnlyChangeIsReportedByPreview(pool, svc, fx);
  });
});
