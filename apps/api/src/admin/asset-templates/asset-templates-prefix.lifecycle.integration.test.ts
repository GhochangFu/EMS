import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { CalcParametersService } from "../../calc/calc-parameters.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetTemplatesAdminService } from "./asset-templates.service";
import {
  assertADraftEditChangesKeepsAndClearsThePrefix,
  assertCreateStoresThePrefix,
  assertThePrefixTravelsWithTheVersion,
  cleanup,
  loadFixtures,
  type Fixtures,
} from "./asset-templates-prefix.lifecycle.integration.spec";
import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";

/**
 * `E3.1` (ADR 0122 decision 2.5) — Vitest entry point for the template's work-order
 * prefix. Assertions live in the sibling `.spec` (ADR 0014); this file owns the database
 * lifecycle, with the same four role connections as the stock-stamp suite (ADR 0043).
 */
const connectionString = requireIntegrationDb({
  item: "E3.1",
  label: "asset-template work-order prefix tests",
  because:
    "the prefix column written by create and by a draft edit, the published version refusing the edit, " +
    "and createDraftFrom copying the prefix forward are database behaviours — a green run without " +
    "them asserts nothing.",
});

describe.skipIf(!connectionString)("E3.1 — asset template work-order prefix", () => {
  let pool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let fleetPool: pg.Pool | undefined;
  let svc: AssetTemplatesAdminService;
  let fx: Fixtures;

  function requirePool(): pg.Pool {
    if (!pool) {
      throw new Error("pool is required — beforeAll did not run");
    }
    return pool;
  }

  beforeAll(async () => {
    const url = connectionString as string;
    pool = await openIntegrationPool(url, "E3.1");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "E3.1",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E3.1",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "E3.1",
    );

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    svc = new AssetTemplatesAdminService(
      fleetDb,
      tenantDb,
      new AccessControlService(createDb(authPool), fleetDb),
      new MasterDataAuditService(tenantDb, fleetDb),
      new VocabulariesService(tenantDb),
      new CalcParametersService(fleetDb),
    );
    fx = await loadFixtures(pool);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
    }
    await Promise.all([pool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  });

  it("stores the prefix on create, and NULL for a create or a stock import that names none", async () => {
    await assertCreateStoresThePrefix(svc, requirePool(), fx);
  });

  it("changes, keeps and clears the prefix on a draft edit", async () => {
    await assertADraftEditChangesKeepsAndClearsThePrefix(svc, requirePool(), fx);
  });

  it("refuses the edit on a published version and copies the prefix onto the next draft (ruling R2)", async () => {
    await assertThePrefixTravelsWithTheVersion(svc, requirePool(), fx);
  });
});
