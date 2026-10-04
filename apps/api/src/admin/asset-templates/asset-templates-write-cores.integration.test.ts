import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { CalcParametersService } from "../../calc/calc-parameters.service";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetTemplatesAdminService } from "./asset-templates.service";
import {
  assertCreateCoreSeesAPointKeyWrittenInTheSameTransaction,
  assertPublishCoreChecksThePointKeyCatalogThroughTheTransaction,
  assertPublishCoreReadsThePointsThroughTheTransaction,
  assertPublishCoreSeesTheDraftRowWrittenInTheSameTransaction,
  cleanup,
  loadFixtures,
  type Harness,
} from "./asset-templates-write-cores.integration.spec";
import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";

/**
 * `F3.22` PR 1 — Vitest entry point for the create and publish cores (ADR 0091
 * decision 1). Assertions live in the sibling `.spec` (ADR 0014); this file owns
 * the database lifecycle, in the shape of
 * `asset-templates.instantiate.integration.test.ts`: four pools, the real
 * services on the real `bms_tenant`/`bms_fleet` roles, cleanup before and after.
 */

const connectionString = requireIntegrationDb({
  item: "F3.22",
  label: "template write-core transaction tests",
  because:
    "whether a guard sees a row written earlier in the same uncommitted transaction is a " +
    "database behaviour — row visibility under the bms_tenant role and FORCE row-level " +
    "security. No fake can express it, and a skipped run would leave PR 2's one-transaction " +
    "commit resting on an unproven claim.",
});

describe.skipIf(!connectionString)("F3.22 — template create/publish cores see the transaction", () => {
  let pool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let fleetPool: pg.Pool | undefined;
  let h: Harness;

  beforeAll(async () => {
    const url = connectionString as string;
    const created = await openIntegrationPool(url, "F3.22");
    pool = created;
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F3.22",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.22",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F3.22",
    );

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const access = new AccessControlService(createDb(authPool), fleetDb);
    const audit = new MasterDataAuditService(tenantDb, fleetDb);
    const vocabularies = new VocabulariesService(tenantDb);
    const templates = new AssetTemplatesAdminService(
      fleetDb,
      tenantDb,
      access,
      audit,
      vocabularies,
      new CalcParametersService(fleetDb),
    );

    // Before as well as after: a crashed previous run must not fail this one.
    await cleanup(created);
    h = { tenantDb, pool: created, templates, fx: await loadFixtures(created) };
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
    }
    await Promise.all([pool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  });

  it("C1: the create core sees a point key written in the same transaction", async () => {
    await assertCreateCoreSeesAPointKeyWrittenInTheSameTransaction(h);
  });

  it("C2: the publish core sees a draft row written in the same transaction", async () => {
    await assertPublishCoreSeesTheDraftRowWrittenInTheSameTransaction(h);
  });

  it("C3: the publish core checks the point-key catalog through the transaction", async () => {
    await assertPublishCoreChecksThePointKeyCatalogThroughTheTransaction(h);
  });

  it("C4: the publish core reads the points through the transaction", async () => {
    await assertPublishCoreReadsThePointsThroughTheTransaction(h);
  });
});
