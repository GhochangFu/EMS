import pg from "pg";

import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { CalcParametersService } from "../../calc/calc-parameters.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { loadFixtures, type Fixtures } from "../asset-templates/asset-templates.instantiate.integration.spec";
import { MasterDataAuditService } from "../master-data-audit.service";
import {
  assertAdminCreatesAnOrganizationScopedRow,
  assertALocationAdminCannotCreateOrganizationScope,
  assertALocationAdminCannotUpdateAnOrganizationRow,
  assertALocationAdminWritesItsOwnLocationOnly,
  assertAnAbuttingCreateIs201,
  assertAnAssetInAnotherOrganizationIs400,
  assertAnOverlappingCreateIs409AndWritesNothing,
  assertCreateWritesAnAuditRowPerRow,
  assertKeysListsTheTwelveStockKeysInOrder,
  assertListIsGatedByReadableOrganizations,
  assertRemoveDeletesAndAudits,
  assertUpdateIntoTheNeighbourIs409,
  cleanup,
  seedAdminFixture,
  type AdminFixture,
  type Ctx,
} from "./calc-parameters.integration.spec";
import { CalcParametersAdminService } from "./calc-parameters.service";

/**
 * `E4.1a` U8 — Vitest entry point for `CalcParametersAdminService`. Assertions
 * live in the sibling `.spec` (ADR 0014); this file owns the database
 * lifecycle. The cases run in order and hand rows to each other through `ctx`.
 *
 * The service is built on the three real roles the API uses — `bms_auth` for
 * the actor lookup, `bms_tenant` for the writes under `withTenant`, and
 * `bms_fleet` (the pool the gate hands back) for the pre-tenant reads — so
 * the policy's `WITH CHECK` and `FORCE` are in force exactly as in production.
 */
const connectionString = requireIntegrationDb({
  item: "E4.1a",
  label: "calc parameter admin tests",
  because:
    "the overlap 409, the EXCLUDE backstop, the scope-gated authorization and the audit rows are " +
    "database behaviours a pure test cannot check.",
});

describe.skipIf(!connectionString)("E4.1a — calc parameters admin", () => {
  let fleetPool: pg.Pool | undefined;
  let authPool: pg.Pool | undefined;
  let tenantPool: pg.Pool | undefined;
  let svc: CalcParametersAdminService;
  let fx: Fixtures;
  let fixture: AdminFixture;
  const ctx: Ctx = {};

  beforeAll(async () => {
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(url, "E4.1a");
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "E4.1a");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E4.1a",
    );
    fx = await loadFixtures(fleetPool);
    await cleanup(fleetPool);
    fixture = await seedAdminFixture(fleetPool, fx);
    const fleetDb = createDb(fleetPool);
    const tenantDb = createDb(tenantPool);
    svc = new CalcParametersAdminService(
      tenantDb,
      fleetDb,
      new AccessControlService(createDb(authPool), fleetDb),
      new MasterDataAuditService(tenantDb, fleetDb),
      new CalcParametersService(fleetDb),
    );
  });

  afterAll(async () => {
    if (fleetPool) {
      await cleanup(fleetPool);
    }
    await Promise.all([fleetPool?.end(), authPool?.end(), tenantPool?.end()]);
  });

  const pool = (): pg.Pool => {
    if (!fleetPool) throw new Error("pool required");
    return fleetPool;
  };

  it("admin creates an organization-scoped row, present as bms_fleet", async () => {
    await assertAdminCreatesAnOrganizationScopedRow(svc, pool(), fx, ctx);
  });

  it("the owed guard: an overlapping create is a 409 naming the window, and count(*) is unchanged", async () => {
    await assertAnOverlappingCreateIs409AndWritesNothing(svc, pool(), fx);
  });

  it("positive control: an abutting create is admitted", async () => {
    await assertAnAbuttingCreateIs201(svc, pool(), fx, ctx);
  });

  it("a location_admin creating organization scope is a 403", async () => {
    await assertALocationAdminCannotCreateOrganizationScope(svc, pool(), fx);
  });

  it("a location_admin writes its own location and not another", async () => {
    await assertALocationAdminWritesItsOwnLocationOnly(svc, pool(), fx, ctx);
  });

  it("a location or asset in another organization is a 400; the own asset is admitted", async () => {
    await assertAnAssetInAnotherOrganizationIs400(svc, pool(), fx, fixture, ctx);
  });

  it("each create writes one audit row with the organization stamped", async () => {
    await assertCreateWritesAnAuditRowPerRow(pool(), fx, ctx);
  });

  it("update moving effectiveTo into the neighbour is a 409; a shrink is admitted and audited", async () => {
    await assertUpdateIntoTheNeighbourIs409(svc, pool(), fx, ctx);
  });

  it("update is gated by the row's scope, and an unknown id is a 404", async () => {
    await assertALocationAdminCannotUpdateAnOrganizationRow(svc, fx, ctx);
  });

  it("list is gated by readable organizations and joins the scope labels", async () => {
    await assertListIsGatedByReadableOrganizations(svc, fx, fixture, ctx);
  });

  it("remove deletes the row and writes a delete audit row", async () => {
    await assertRemoveDeletesAndAudits(svc, pool(), fx, ctx);
  });

  it("keys lists the twelve stock keys in sort_order order", async () => {
    await assertKeysListsTheTwelveStockKeysInOrder(svc, fx);
  });
});
