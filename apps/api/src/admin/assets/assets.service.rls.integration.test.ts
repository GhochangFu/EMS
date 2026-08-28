import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { VocabulariesService } from "../../vocabularies/vocabularies.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { AssetsAdminService } from "./assets.service";
import {
  assertAssetWriteLifecycleSurvivesRealRls,
  assertRefusesCrossOrgRelocation,
} from "./assets.service.rls.integration.spec";

/**
 * `E7.1b` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. Same shape as
 * `point-keys.rls.integration.test.ts` against the other zero-coverage admin
 * write path — `AssetsAdminService` had no test file at all.
 */
const connectionString = requireIntegrationDb({
  item: "E7.1b",
  label: "AssetsAdminService against real, non-owner roles",
  because:
    "AssetsAdminService has no other test file. Constructing it with real " +
    "bms_auth/bms_tenant/bms_fleet connections is the only proof that the E7.1b " +
    "write funnel stamps organization_id from the asset's location and wraps every " +
    "write in withTenant, rather than passing only because the owner connection " +
    "bypasses row-level security regardless.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const GLOBAL_ADMIN_EMAIL = "admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000003";

function jwtFor(email: string, role: JwtPayload["role"]): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role };
}

describe.skipIf(!connectionString)("E7.1b — AssetsAdminService under real RLS", () => {
  let ownerPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let fleetPool: pg.Pool;
  let svc: AssetsAdminService;
  let organizationId: string;
  let locationId: string;
  let foreignLocationId: string;
  let domain: string;
  const createdIds: string[] = [];

  const jwt = jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin");
  const adminJwt = jwtFor(GLOBAL_ADMIN_EMAIL, "admin");

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(url, "E7.1b");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "E7.1b",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E7.1b",
    );
    fleetPool = await openIntegrationPool(
      process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"),
      "E7.1b",
    );

    const org = await ownerPool.query<{ id: string }>(
      `SELECT uoa.organization_id AS id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
        WHERE u.email = $1
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!org.rows[0]) {
      throw new Error(
        `E7.1b: ${ORGANIZATION_ADMIN_EMAIL} has no organization grant — run pnpm db:seed.`,
      );
    }
    organizationId = org.rows[0].id;

    const loc = await ownerPool.query<{ id: string }>(
      `SELECT id FROM bms.locations
         WHERE organization_id = $1 AND active = true ORDER BY created_at, code LIMIT 1`,
      [organizationId],
    );
    if (!loc.rows[0]) {
      throw new Error(
        `E7.1b: ${ORGANIZATION_ADMIN_EMAIL}'s organization has no active location — run pnpm db:seed.`,
      );
    }
    locationId = loc.rows[0].id;

    const foreign = await ownerPool.query<{ id: string }>(
      `SELECT id FROM bms.locations
         WHERE organization_id <> $1 AND active = true ORDER BY created_at, code LIMIT 1`,
      [organizationId],
    );
    if (!foreign.rows[0]) {
      throw new Error(
        "E7.1b: need a location in another organization to prove the relocation guard.",
      );
    }
    foreignLocationId = foreign.rows[0].id;

    const dom = await ownerPool.query<{ code: string }>(
      "SELECT code FROM bms.asset_domains WHERE active = true LIMIT 1",
    );
    if (!dom.rows[0]) {
      throw new Error("E7.1b: no active asset_domain — run pnpm db:seed.");
    }
    domain = dom.rows[0].code;

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fleetPool);
    svc = new AssetsAdminService(
      fleetDb,
      tenantDb,
      new AccessControlService(createDb(authPool), fleetDb),
      new MasterDataAuditService(tenantDb, fleetDb),
      new VocabulariesService(fleetDb),
    );
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await ownerPool.query("DELETE FROM bms.assets WHERE id = ANY($1)", [createdIds]);
    }
    await Promise.all([ownerPool.end(), authPool.end(), tenantPool.end(), fleetPool.end()]);
  });

  it("creates, reads, updates, deactivates and reactivates an asset with a stamped org under real RLS", async () => {
    const id = await assertAssetWriteLifecycleSurvivesRealRls(
      { svc, ownerPool, organizationId, locationId, domain },
      jwt,
    );
    createdIds.push(id);
    // Deleted here, not deferred to afterAll — it ends active=true and would
    // otherwise stay visible to concurrently-running suites for the file's
    // whole duration (see point-keys.rls.integration.test.ts).
    await ownerPool.query("DELETE FROM bms.assets WHERE id = $1", [id]);
  });

  it("refuses moving an asset to a location in another organization", async () => {
    await assertRefusesCrossOrgRelocation(
      { svc, ownerPool, organizationId, locationId, domain, foreignLocationId },
      adminJwt,
    );
  });
});
