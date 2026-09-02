import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetTemplatesAdminService } from "./asset-templates.service";
import {
  assertPointMetaRoundTrips,
  cleanup,
  loadFixtures,
  type Fixtures,
} from "./asset-templates-point-meta.lifecycle.integration.spec";
import {
  openIntegrationPool,
  requireIntegrationDb,
} from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";

/**
 * `F2.13` — Vitest entry point for `meta.tier`'s round trip. Assertions live
 * in the sibling `.spec` (ADR 0014); this file owns the database lifecycle,
 * mirroring `asset-templates.lifecycle.integration.test.ts`'s pool setup
 * exactly (four role connections, ADR 0043).
 */
const connectionString = requireIntegrationDb({
  item: "F2.13",
  label: "template point meta round-trip test",
  because:
    "meta.tier surviving create, a GET and createDraftFrom's replacePoints re-stamp are " +
    "database behaviours — a green run without them asserts nothing.",
});

describe.skipIf(!connectionString)("F2.13 — template point meta.tier round-trips", () => {
  let pool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let fleetPool: pg.Pool | undefined;
  let svc: AssetTemplatesAdminService;
  let fx: Fixtures;

  beforeAll(async () => {
    const url = connectionString as string;
    pool = await openIntegrationPool(url, "F2.13");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F2.13",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F2.13",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "F2.13",
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
    fx = await loadFixtures(pool);
  });

  afterAll(async () => {
    if (pool) {
      await cleanup(pool);
    }
    await Promise.all([pool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  });

  it("carries meta.tier through create, GET :id and createDraftFrom", async () => {
    await assertPointMetaRoundTrips(svc, fx);
  });
});
