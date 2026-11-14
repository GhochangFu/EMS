import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { MasterDataAuditService } from "../master-data-audit.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { jwtFor, primeSeededSubjects, SEEDED } from "../../testing/seeded-subjects";
import { OrganizationsAdminService } from "./organizations.service";
import {
  aCreatedOrganizationReadsAuto,
  anAdminPatchSetsAndKeepsBoth,
  anOrganizationAdminIsRefused,
  theAuditRowCarriesBothKeys,
  type EnergyCtx,
} from "./organizations.energy-features.integration.spec";

/**
 * `F4.364` — Vitest entry point for the organization energy settings on the admin write path.
 * Every row this suite creates carries the per-run family, is registered the moment it exists and
 * is deleted (with its audit rows) in `afterAll`; a stale sweep reaps a run that died before.
 */
const connectionString = requireIntegrationDb({
  item: "F4.364",
  label: "organization energy settings on the OrganizationsAdminService write path",
  because:
    "what the row and the audit log hold after a PATCH, and that an organization_admin is refused, " +
    "are only answered by the real database.",
});

const FAMILY = `F4364-ORG-${Date.now()}`;
const FAMILY_PATTERN = "F4364-ORG-%";

async function sweepStaleRuns(pool: pg.Pool): Promise<void> {
  await pool.query(
    `DELETE FROM bms.audit_log WHERE entity_type = 'organization' AND entity_id IN (
       SELECT id FROM bms.organizations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes')`,
    [FAMILY_PATTERN],
  );
  await pool.query(`DELETE FROM bms.organizations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`, [
    FAMILY_PATTERN,
  ]);
}

describe.skipIf(!connectionString)("F4.364 — organization energy settings on the admin write path", () => {
  let fleetPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: EnergyCtx;
  const createdIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"), "F4.364");
    await primeSeededSubjects(fleetPool);
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "F4.364");
    tenantPool = await openIntegrationPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"), "F4.364");
    await sweepStaleRuns(fleetPool);

    const { rows } = await fleetPool.query<{ id: string }>(
      `SELECT o.id FROM bms.organizations o WHERE o.code = 'PHEWB' LIMIT 1`,
    );
    const granted = rows[0]?.id;
    if (!granted) throw new Error("F4.364: the seeded PHEWB organization is missing — run pnpm db:seed.");

    ctx = {
      svc: new OrganizationsAdminService(
        createDb(fleetPool),
        createDb(tenantPool),
        new AccessControlService(createDb(authPool), createDb(fleetPool)),
        new MasterDataAuditService(createDb(tenantPool), createDb(fleetPool)),
      ),
      fleetPool,
      adminJwt: jwtFor(SEEDED.globalAdmin, "admin"),
      organizationAdminJwt: jwtFor(SEEDED.organizationAdmin, "organization_admin"),
      grantedOrganizationId: granted,
      register: (id) => createdIds.push(id),
      family: FAMILY,
    };
  }, 60_000);

  afterAll(async () => {
    if (createdIds.length > 0) {
      await fleetPool.query("DELETE FROM bms.audit_log WHERE entity_type = 'organization' AND entity_id = ANY($1)", [createdIds]);
      await fleetPool.query("DELETE FROM bms.organizations WHERE id = ANY($1)", [createdIds]);
    }
    await Promise.all([fleetPool?.end(), authPool?.end(), tenantPool?.end()]);
  }, 60_000);

  it("I1 a created organization reads auto / auto", async () => {
    await aCreatedOrganizationReadsAuto(ctx);
  }, 60_000);

  it("I2 the admin's PATCH sets both and a PATCH without them keeps them", async () => {
    await anAdminPatchSetsAndKeepsBoth(ctx);
  }, 60_000);

  it("I3 the audit row is master.organization.update, organization_id NULL, both keys in the payload", async () => {
    await theAuditRowCarriesBothKeys(ctx);
  }, 60_000);

  it("I4 an organization_admin is refused and the row is unchanged (Q2)", async () => {
    await anOrganizationAdminIsRefused(ctx);
  }, 60_000);
});
