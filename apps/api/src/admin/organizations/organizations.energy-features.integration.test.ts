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
  aLocationAdminIsRefused,
  anOrganizationAdminSetsTheirOwnOrganization,
  anOrganizationAdminWithoutAGrantIsRefused,
  anUnchangedWriteWritesNothing,
  anUnknownIdIsNotAnOracle,
  aPatchLeavesBothColumns,
  theAuditRowCarriesTheOrganizationAndFromTo,
  theGlobalAdminSetsAnyOrganization,
  type EnergyCtx,
} from "./organizations.energy-features.integration.spec";

/**
 * `F4.364` / `F4.375` — Vitest entry point for the organization energy settings on their one write
 * path, `PUT …/energy-settings` (ADR 0133 Amendment 2 ruling 3).
 * Every row this suite creates carries the per-run family, is registered the moment it exists and
 * is deleted (with its audit rows) in `afterAll`; a stale sweep reaps a run that died before.
 */
const connectionString = requireIntegrationDb({
  item: "F4.364",
  label: "organization energy settings on the OrganizationsAdminService write path",
  because:
    "what the row and the audit log hold after the energy-settings write, and who may make it, " +
    "are only answered by the real database.",
});

const FAMILY = `F4364-ORG-${Date.now()}`;
const FAMILY_PATTERN = "F4364-ORG-%";

async function sweepStaleRuns(pool: pg.Pool): Promise<void> {
  try {
    await pool.query(
    `DELETE FROM bms.audit_log WHERE entity_type = 'organization' AND entity_id IN (
       SELECT id FROM bms.organizations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes')`,
    [FAMILY_PATTERN],
  );
    await pool.query(`DELETE FROM bms.organizations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'`, [
      FAMILY_PATTERN,
    ]);
  } catch (err) {
    process.stderr.write(
      `[F4.364] could not sweep stale fixture rows: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

describe.skipIf(!connectionString)("F4.364 / F4.375 — organization energy settings on their write path", () => {
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
      locationAdminJwt: jwtFor(SEEDED.locationAdmin, "location_admin"),
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

  it("I2 the global admin sets any organization", async () => {
    await theGlobalAdminSetsAnyOrganization(ctx);
  }, 60_000);

  it("I3 the audit row is energy_settings.update with the organization id and from / to", async () => {
    await theAuditRowCarriesTheOrganizationAndFromTo(ctx);
  }, 60_000);

  it("I4 an organization_admin sets their own organization (ruling 3)", async () => {
    await anOrganizationAdminSetsTheirOwnOrganization(ctx);
  }, 60_000);

  it("I5 an organization_admin without a grant is refused; no audit row", async () => {
    await anOrganizationAdminWithoutAGrantIsRefused(ctx);
  }, 60_000);

  it("I6 a location_admin is refused", async () => {
    await aLocationAdminIsRefused(ctx);
  }, 60_000);

  it("I7 an unchanged write writes no audit row", async () => {
    await anUnchangedWriteWritesNothing(ctx);
  }, 60_000);

  it("I8 a PATCH of name leaves both columns (Q6)", async () => {
    await aPatchLeavesBothColumns(ctx);
  }, 60_000);

  it("I9 an unknown id is 404 for the global admin and 403 for an organization admin", async () => {
    await anUnknownIdIsNotAnOracle(ctx);
  }, 60_000);
});
