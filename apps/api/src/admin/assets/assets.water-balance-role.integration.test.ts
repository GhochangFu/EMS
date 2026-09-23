import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetsAdminService } from "./assets.service";
import {
  assertARenameLeavesTheRoleAlone,
  assertARenameResendingARetiredStoredRoleSucceeds,
  assertChangingARetiredRoleToAnUnknownOneIs400,
  assertCreateRefusesAnUnknownRoleWith400,
  assertCreateReturnsTheRole,
  assertCreateStoresTheRole,
  assertCreateWithAnUnknownRoleWritesNoRow,
  assertCreateWithoutTheFieldStoresNull,
  assertTheCreateAuditRecordsTheRole,
  assertUpdateRefusesAnUnknownRoleWith400,
  assertUpdateSetsARole,
  assertUpdateWithNullClearsTheRole,
  type AssetsWaterBalanceRoleCtx,
} from "./assets.water-balance-role.integration.spec";

/**
 * `E4.3` U3 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); this file
 * owns the pools and the cleanup. The service graph is the one
 * `assets.telemetry-source.integration.test.ts` builds.
 */
const connectionString = requireIntegrationDb({
  item: "E4.3",
  label: "AssetsAdminService writing bms.assets.water_balance_role",
  because:
    "the role is checked against bms.water_balance_roles and closed by an FK; a fake db " +
    "cannot say whether an unknown code is a 400 or a 500, or whether a null PATCH clears it.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000005";
// Review C1 — a per-run retired role; the prefix names its author if it leaks.
const RETIRED_ROLE = `e43_u3_retired_${Date.now()}`;

function jwtFor(email: string, role: JwtPayload["role"]): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role };
}

describe.skipIf(!connectionString)("E4.3 U3 — the water balance role on the asset write path", () => {
  let fixturePool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let superuserPool: pg.Pool;
  let ctx: AssetsWaterBalanceRoleCtx;

  const jwt = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");
  const createdAssetIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    fixturePool = await openIntegrationPool(url, "E4.3 U3");
    superuserPool = await openIntegrationPool(
      resolveIntegrationRoleUrl(url, "superuser", process.env),
      "E4.3 U3",
    );
    await superuserPool.query(
      "INSERT INTO bms.water_balance_roles (code, label, active) VALUES ($1, 'E4.3 U3 retired', false)",
      [RETIRED_ROLE],
    );
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "E4.3 U3",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E4.3 U3",
    );

    const org = await fixturePool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) {
      throw new Error(`E4.3 U3: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`);
    }
    const loc = await fixturePool.query<{ id: string }>(
      `SELECT id FROM bms.locations
         WHERE organization_id = $1 AND active = true ORDER BY created_at, code LIMIT 1`,
      [org.rows[0].id],
    );
    if (!loc.rows[0]) {
      throw new Error(`E4.3 U3: ${ORGANIZATION_ADMIN_EMAIL}'s organization has no active location.`);
    }
    const dom = await fixturePool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true ORDER BY code LIMIT 1",
    );
    if (!dom.rows[0]) {
      throw new Error("E4.3 U3: no active asset_domain — run pnpm db:seed.");
    }

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fixturePool);
    ctx = {
      svc: new AssetsAdminService(
        fleetDb,
        tenantDb,
        new AccessControlService(createDb(authPool), fleetDb),
        new MasterDataAuditService(tenantDb, fleetDb),
        new VocabulariesService(fleetDb),
      ),
      fixturePool,
      superuserPool,
      retiredRole: RETIRED_ROLE,
      locationId: loc.rows[0].id,
      domain: dom.rows[0].code,
      createdAssetIds,
    };
  }, 60_000);

  afterAll(async () => {
    // Every fixture row carries an `e4-3-u3-` code so a leak names its author.
    if (createdAssetIds.length > 0) {
      await fixturePool.query("DELETE FROM bms.audit_log WHERE entity_id = ANY($1)", [createdAssetIds]);
      await fixturePool.query("DELETE FROM bms.assets WHERE id = ANY($1)", [createdAssetIds]);
    }
    // After the assets: `assets_water_balance_role_fkey` references the row.
    await superuserPool?.query("DELETE FROM bms.water_balance_roles WHERE code = $1", [RETIRED_ROLE]);
    await Promise.all([
      fixturePool?.end(),
      authPool?.end(),
      tenantPool?.end(),
      superuserPool?.end(),
    ]);
  }, 60_000);

  // One claim per `it`: `expect` throws, so a second claim would never run on the first's failure.
  it("returns the role on create", async () => {
    await assertCreateReturnsTheRole(ctx, jwt);
  }, 30_000);

  it("stores the role on create", async () => {
    await assertCreateStoresTheRole(ctx, jwt);
  }, 30_000);

  it("stores NULL when create omits the role", async () => {
    await assertCreateWithoutTheFieldStoresNull(ctx, jwt);
  }, 30_000);

  it("refuses an unknown role on create with a 400 naming the four codes", async () => {
    await assertCreateRefusesAnUnknownRoleWith400(ctx, jwt);
  }, 30_000);

  it("writes no row when create refuses an unknown role", async () => {
    await assertCreateWithAnUnknownRoleWritesNoRow(ctx, jwt);
  }, 30_000);

  it("clears the role when update sends null", async () => {
    await assertUpdateWithNullClearsTheRole(ctx, jwt);
  }, 30_000);

  it("leaves the role alone when update omits it", async () => {
    await assertARenameLeavesTheRoleAlone(ctx, jwt);
  }, 30_000);

  it("sets a role on update", async () => {
    await assertUpdateSetsARole(ctx, jwt);
  }, 30_000);

  it("refuses an unknown role on update with the same 400", async () => {
    await assertUpdateRefusesAnUnknownRoleWith400(ctx, jwt);
  }, 30_000);

  it("records the role in the create audit payload", async () => {
    await assertTheCreateAuditRecordsTheRole(ctx, jwt);
  }, 30_000);

  it("renames an asset whose stored role was retired when the form re-sends that role", async () => {
    await assertARenameResendingARetiredStoredRoleSucceeds(ctx, jwt);
  }, 30_000);

  it("still refuses moving a retired-role asset to an unknown role", async () => {
    await assertChangingARetiredRoleToAnUnknownOneIs400(ctx, jwt);
  }, 30_000);
});
