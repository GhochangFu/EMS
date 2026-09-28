import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { JwtPayload } from "@bms/shared";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { MasterDataAuditService } from "../master-data-audit.service";
import { RtusAdminService } from "./rtus.service";
import {
  assertARepairedRtuIsUpdated,
  assertDeactivateLeavesTheRtuActive,
  assertPathRefusesADriftedRtu,
  assertPathWritesNoAuditRow,
  assertReactivateLeavesTheRtuInactive,
  assertUpdateLeavesIngestOff,
  assertUpdateLeavesTheAssetOnCatalog,
  assertUpdateLeavesTheDisplayName,
  type TenantAgreementCtx,
} from "./rtus.tenant-agreement.integration.spec";

/**
 * `F4.138` — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the database lifecycle. Same shape as
 * `rtus.telemetry-source.integration.test.ts`.
 */
const connectionString = requireIntegrationDb({
  item: "F4.138",
  label: "RtusAdminService refusing an RTU whose organization disagrees with its location's",
  because:
    "drift cannot be produced through the API; the claim is that under the real " +
    "bms_tenant policy the write is refused before withTenant opens, and that the " +
    "RTU, its asset and the audit log are untouched. A fake transaction cannot show " +
    "that the drifted GUC would have passed the policy, which is the defect.",
});

const ORGANIZATION_ADMIN_EMAIL = "phe-admin@bms.local";
const SYNTHETIC_SUB = "00000000-0000-4000-8000-000000000004";

function jwtFor(email: string, role: JwtPayload["role"]): JwtPayload {
  return { sub: SYNTHETIC_SUB, email, name: `integration:${email}`, role };
}

describe.skipIf(!connectionString)("F4.138 — a drifted RTU is refused under real RLS", () => {
  let fixturePool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: TenantAgreementCtx;

  const createdRtuIds: string[] = [];
  const createdAssetIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    // `requireIntegrationDb` defaults to `bms_fleet`, which is `BYPASSRLS`
    // (migration 0039): the drift fixture and the read-back need to see across
    // the tenant policy, and this is the pool the service reads on.
    fixturePool = await openIntegrationPool(url, "F4.138");
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F4.138",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.138",
    );

    const own = await fixturePool.query<{ organization_id: string; location_id: string }>(
      `SELECT uoa.organization_id, l.id AS location_id
         FROM bms.user_organization_access uoa
         JOIN bms.users u ON u.id = uoa.user_id
         JOIN bms.locations l ON l.organization_id = uoa.organization_id AND l.active = true
        WHERE u.email = $1
        ORDER BY l.created_at, l.code
        LIMIT 1`,
      [ORGANIZATION_ADMIN_EMAIL],
    );
    if (!own.rows[0]) {
      throw new Error(
        `F4.138: ${ORGANIZATION_ADMIN_EMAIL} has no organization with an active location — run pnpm db:seed.`,
      );
    }

    // Oldest first, and `created_at` as the leading key: another suite commits
    // a temporary organization with an active location (`health-rollup`,
    // `pue-ratio`), and a random uuid sorting first would stamp it on this
    // suite's drifted RTU — then its teardown fails on the foreign key. The
    // oldest location outside the caller's organization is a seeded row.
    const foreign = await fixturePool.query<{ organization_id: string; location_id: string }>(
      `SELECT l.organization_id, l.id AS location_id
         FROM bms.locations l
        WHERE l.organization_id <> $1 AND l.active = true
        ORDER BY l.created_at, l.code
        LIMIT 1`,
      [own.rows[0].organization_id],
    );
    if (!foreign.rows[0]) {
      throw new Error(
        "F4.138: the database has only one organization with an active location — " +
          "a drifted RTU cannot be built. Run pnpm db:seed.",
      );
    }

    const tenantDb = createDb(tenantPool);
    const fleetDb = createDb(fixturePool);
    ctx = {
      svc: new RtusAdminService(
        fleetDb,
        tenantDb,
        new AccessControlService(createDb(authPool), fleetDb),
        new MasterDataAuditService(tenantDb, fleetDb),
      ),
      jwt: jwtFor(ORGANIZATION_ADMIN_EMAIL, "organization_admin"),
      fixturePool,
      organizationId: own.rows[0].organization_id,
      locationId: own.rows[0].location_id,
      foreignOrganizationId: foreign.rows[0].organization_id,
      foreignLocationId: foreign.rows[0].location_id,
      createdRtuIds,
      createdAssetIds,
    };
  }, 60_000);

  afterAll(async () => {
    // Assets first: `assets.rtu_id` references `rtus.id`. The audit rows go too —
    // the refusal cases say there are none, but the positive control writes one,
    // and a regression would leave more on the shared 5433 database. Every
    // fixture code starts `f4-138-` so a leak names its author; a leaked drifted
    // RTU would also make the repo's drift count non-zero.
    if (createdAssetIds.length > 0) {
      await fixturePool.query("DELETE FROM bms.assets WHERE id = ANY($1)", [createdAssetIds]);
    }
    if (createdRtuIds.length > 0) {
      await fixturePool.query("DELETE FROM bms.audit_log WHERE entity_id = ANY($1)", [
        createdRtuIds,
      ]);
      await fixturePool.query("DELETE FROM bms.rtus WHERE id = ANY($1)", [createdRtuIds]);
    }
    await Promise.all([fixturePool?.end(), authPool?.end(), tenantPool?.end()]);
  }, 60_000);

  // One claim per `it`, and one drifted RTU per `it`: no case depends on another.
  describe.each(["update", "deactivate", "reactivate"] as const)("%s", (path) => {
    it("refuses the drifted RTU with the ruled 500", async () => {
      await assertPathRefusesADriftedRtu(ctx, path);
    }, 30_000);

    it("writes no audit row for it", async () => {
      await assertPathWritesNoAuditRow(ctx, path);
    }, 30_000);
  });

  it("update leaves the drifted RTU's display name", async () => {
    await assertUpdateLeavesTheDisplayName(ctx);
  }, 30_000);

  it("update leaves the drifted RTU's ingest switch off", async () => {
    await assertUpdateLeavesIngestOff(ctx);
  }, 30_000);

  it("update leaves the drifted RTU's foreign-organization asset on catalog", async () => {
    await assertUpdateLeavesTheAssetOnCatalog(ctx);
  }, 30_000);

  it("deactivate leaves the drifted RTU active", async () => {
    await assertDeactivateLeavesTheRtuActive(ctx);
  }, 30_000);

  it("reactivate leaves the drifted RTU inactive", async () => {
    await assertReactivateLeavesTheRtuInactive(ctx);
  }, 30_000);

  it("updates the same RTU once its organization is repaired", async () => {
    await assertARepairedRtuIsUpdated(ctx);
  }, 30_000);
});
