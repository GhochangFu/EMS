import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { CalcParametersService } from "../../calc/calc-parameters.service";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  aMicrosecondStampMatchesItsMilliseconds,
  anUncastableIfMatchIs412NotA500,
  aStaleIfMatchIs412AndWritesNothing,
  cleanup,
  loadFixtures,
  noIfMatchUpdatesWithoutACompare,
  type TemplatePreconditionCtx,
  theLiveIfMatchUpdates,
} from "./asset-templates.precondition.integration.spec";
import { AssetTemplatesAdminService } from "./asset-templates.service";

/**
 * `F4.247` — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); this file
 * owns the database lifecycle, mirroring `asset-templates-stamp.lifecycle.integration.test.ts`'s
 * pool setup, plus a superuser pool that stamps `updated_at`.
 */
const connectionString = requireIntegrationDb({
  item: "F4.247",
  label: "PATCH /admin/asset-templates/:id with If-Match",
  because:
    "the conditional update, its millisecond text compare and the rollback of a 412 are facts " +
    "about a real Postgres that a fake db cannot prove.",
});

describe.skipIf(!connectionString)("F4.247 — AssetTemplatesAdminService.update with If-Match (ADR 0099 Amendment 5 C3)", () => {
  let pool: pg.Pool | undefined;
  let superuserPool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let fleetPool: pg.Pool | undefined;
  let ctx: TemplatePreconditionCtx;

  beforeAll(async () => {
    const url = connectionString as string;
    pool = await openIntegrationPool(url, "F4.247");
    superuserPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.247");
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "F4.247");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.247",
    );
    fleetPool = await openIntegrationPool(process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"), "F4.247");
    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    const svc = new AssetTemplatesAdminService(
      fleetDb,
      tenantDb,
      new AccessControlService(createDb(authPool), fleetDb),
      new MasterDataAuditService(tenantDb, fleetDb),
      new VocabulariesService(tenantDb),
      new CalcParametersService(fleetDb),
    );
    ctx = { svc, fx: await loadFixtures(pool), superuserPool };
  });

  afterAll(async () => {
    if (superuserPool) await cleanup(superuserPool);
    await Promise.all([pool?.end(), superuserPool?.end(), authPool?.end(), tenantPool?.end(), fleetPool?.end()]);
  });

  it("updates on the live If-Match and moves updatedAt", async () => {
    await theLiveIfMatchUpdates(ctx);
  });

  it("refuses a stale If-Match with 412, writing no field, no audit row and no stamp", async () => {
    await aStaleIfMatchIs412AndWritesNothing(ctx);
  });

  it("matches a microsecond stamp by its milliseconds", async () => {
    await aMicrosecondStampMatchesItsMilliseconds(ctx);
  });

  it("updates with no If-Match and no compare", async () => {
    await noIfMatchUpdatesWithoutACompare(ctx);
  });

  it("answers 412, never 500, for an If-Match Postgres cannot cast", async () => {
    await anUncastableIfMatchIs412NotA500(ctx);
  });
});
