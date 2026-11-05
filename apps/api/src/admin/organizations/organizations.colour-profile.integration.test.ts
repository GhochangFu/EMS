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
  aLocationAdminIs403,
  aNewOrganizationStartsOnNexus,
  anOrganizationAdminWithoutAGrantIs403,
  theCheckRefusesAnUnknownName,
  theGlobalAdminSetsAnyOrganization,
  theListCarriesTheProfile,
  theOrganizationAdminSetsItsOwnAndMeFollows,
  type ColourProfileCtx,
} from "./organizations.colour-profile.integration.spec";

/**
 * `F4.310` — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); this file owns
 * the pools, the fixture organization and its cleanup, on the `organizations.currency` harness:
 * every row is deleted in `afterAll`, and a stale sweep reaps a run that died before it.
 */
const connectionString = requireIntegrationDb({
  item: "F4.310",
  label: "bms.organizations.colour_profile on the colour-profile route and /auth/me",
  because:
    "the gate reads the caller's real organization grants, the CHECK and the default are Postgres's, " +
    "and /auth/me reads the home organization's row.",
});

const FAMILY = `F4310-CP-${Date.now()}`;
const FAMILY_PATTERN = "F4310-CP-%";

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
    process.stderr.write(`[F4.310] could not sweep stale fixture rows: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

describe.skipIf(!connectionString)("F4.310 — organization colour profile (ADR 0110)", () => {
  let fleetPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: ColourProfileCtx;
  let auditIdsBefore = new Set<string>();

  beforeAll(async () => {
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"), "F4.310");
    await primeSeededSubjects(fleetPool);
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "F4.310");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.310",
    );
    await sweepStaleRuns(fleetPool);

    const access = new AccessControlService(createDb(authPool), createDb(fleetPool));
    const svc = new OrganizationsAdminService(
      createDb(fleetPool),
      createDb(tenantPool),
      access,
      new MasterDataAuditService(createDb(tenantPool), createDb(fleetPool)),
    );
    const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");
    const fixture = await svc.create(globalAdmin, { code: `${FAMILY}-A`, name: "F4.310 colour fixture", currency: "INR" });

    const { rows } = await fleetPool.query<{ organization_id: string | null }>(
      "SELECT organization_id FROM bms.users WHERE email = $1",
      [SEEDED.organizationAdmin],
    );
    const ownOrgId = rows[0]?.organization_id;
    if (!ownOrgId) throw new Error(`F4.310: ${SEEDED.organizationAdmin} has no home organization — run pnpm db:seed.`);

    const audit = await fleetPool.query<{ id: string }>(
      "SELECT id FROM bms.audit_log WHERE action = 'master.organization.colour_profile.update' AND entity_id = $1",
      [ownOrgId],
    );
    auditIdsBefore = new Set(audit.rows.map((r) => r.id));

    ctx = {
      svc,
      access,
      fleetPool,
      globalAdmin,
      organizationAdmin: jwtFor(SEEDED.organizationAdmin, "organization_admin"),
      locationAdmin: jwtFor(SEEDED.locationAdmin, "location_admin"),
      fixtureId: fixture.id,
      ownOrgId,
    };
  });

  afterAll(async () => {
    if (ctx) {
      await fleetPool.query("DELETE FROM bms.audit_log WHERE entity_type = 'organization' AND entity_id = $1", [ctx.fixtureId]);
      const audit = await fleetPool.query<{ id: string }>(
        "SELECT id FROM bms.audit_log WHERE action = 'master.organization.colour_profile.update' AND entity_id = $1",
        [ctx.ownOrgId],
      );
      const added = audit.rows.map((r) => r.id).filter((id) => !auditIdsBefore.has(id));
      if (added.length > 0) await fleetPool.query("DELETE FROM bms.audit_log WHERE id = ANY($1)", [added]);
      await fleetPool.query("DELETE FROM bms.organizations WHERE id = $1", [ctx.fixtureId]);
    }
    await Promise.all([fleetPool?.end(), authPool?.end(), tenantPool?.end()]);
  });

  it("C0 a new organization starts on nexus", async () => {
    await aNewOrganizationStartsOnNexus(ctx);
  });

  it("C1 the global admin sets any organization, with one audit row", async () => {
    await theGlobalAdminSetsAnyOrganization(ctx);
  });

  it("C2 an organization admin without a grant on the organization is a 403", async () => {
    await anOrganizationAdminWithoutAGrantIs403(ctx);
  });

  it("C3 a location admin is a 403", async () => {
    await aLocationAdminIs403(ctx);
  });

  it("C4 the organization admin sets its own organization and /auth/me follows", async () => {
    await theOrganizationAdminSetsItsOwnAndMeFollows(ctx);
  });

  it("C5 the CHECK refuses a name outside the six", async () => {
    await theCheckRefusesAnUnknownName(ctx);
  });

  it("C6 the list DTO carries the profile", async () => {
    await theListCarriesTheProfile(ctx);
  });
});
