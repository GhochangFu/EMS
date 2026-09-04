import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetTemplatesAdminService } from "./asset-templates.service";
import {
  assertCrossRefPointKeysAreCatalogued,
  assertVersionBumpCopiesMinCoverageRatio,
} from "./asset-templates.calc-v2.integration.spec";
import { cleanup, loadFixtures, type Fixtures } from "./asset-templates.lifecycle.integration.spec";

/**
 * `F2.9` — Vitest entry point for the `bms-calc-v2` write path. Assertions live
 * in the sibling `.spec` (ADR 0014); this file owns the database lifecycle.
 *
 * The gate and the four role pools are the `F2.1`/`F2.6` shape, deliberately
 * repeated rather than shared — see the header of
 * `asset-templates.lifecycle.integration.test.ts` for why extracting it has no
 * good home yet. Fixtures, `TEST_CODE` and `cleanup` come from that suite, so
 * this file's two template codes are swept by its prefix delete.
 *
 * Unlike the lifecycle suite the two cases here are **independent**: each
 * creates its own template under its own code, so a failure in one says
 * nothing about the other.
 */
const connectionString = requireIntegrationDb({
  item: "F2.9",
  label: "bms-calc-v2 template write-path tests",
  because:
    "both rules are silences. A cross-asset aggregate names its point key inside a varchar " +
    "formula, where migration 0058's foreign key cannot see it, so only a real catalog read " +
    "can prove the save is refused; and min_coverage_ratio surviving a version bump is a " +
    "column surviving a delete-then-insert, which no pure test can observe. A green run " +
    "without a database would assert neither.",
});

describe.skipIf(!connectionString)("F2.9 — bms-calc-v2 template write path", () => {
  let pool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let fleetPool: pg.Pool | undefined;
  let svc: AssetTemplatesAdminService;
  let fx: Fixtures;

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
    svc = new AssetTemplatesAdminService(
      fleetDb,
      tenantDb,
      new AccessControlService(createDb(authPool), fleetDb),
      new MasterDataAuditService(tenantDb, fleetDb),
      new VocabulariesService(tenantDb),
    );
    fx = await loadFixtures(created);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
    }
    await Promise.all([pool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  });

  it("refuses a v2 aggregate over a point key the catalog does not know", async () => {
    await assertCrossRefPointKeysAreCatalogued(svc, fx);
  });

  it("carries min_coverage_ratio through a version bump (ADR 0055 decision 11)", async () => {
    await assertVersionBumpCopiesMinCoverageRatio(svc, fx);
  });
});
