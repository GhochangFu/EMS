import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { AccessControlService } from "../../auth/access-control.service";
import { openIntegrationPool, requireIntegrationDb } from "../../testing/integration-db-gate";
import { asRole } from "../../testing/role-urls";
import { jwtFor, primeSeededSubjects, SEEDED } from "../../testing/seeded-subjects";
import { MasterDataAuditService } from "../master-data-audit.service";
import { OrganizationsAdminService } from "../organizations/organizations.service";
import {
  aUserSetsTheirOwnAndMeResolves,
  everyOtherRoleIs403OnThePortal,
  theGlobalAdminSetsThePortal,
  theOldRouteIsAnAlias,
  theOrganizationRouteSetsAndClears,
  thePublicReadIsTwoKeys,
  theTableHoldsOneValidRow,
  theUserCheckRefusesAnUnknownName,
  thePrivilegesAreTheMigrations,
  type AppearanceCtx,
} from "./appearance.integration.spec";
import { PortalSettingsService } from "./portal-settings.service";

/**
 * `F4.341` — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); this file owns
 * the pools and the audit-row cleanup. Each claim restores the shared rows it writes.
 */
const connectionString = requireIntegrationDb({
  item: "F4.341",
  label: "the appearance storage, its three write routes, the public read and /auth/me's precedence",
  because:
    "the CHECKs, the one-row table, the column grants on bms.users and the precedence across three tables are Postgres's.",
});

const ACTIONS = ["master.portal.appearance.update", "master.organization.appearance.update", "master.organization.colour_profile.update", "user.appearance.update"];

describe.skipIf(!connectionString)("F4.341 — selectable appearance (ADR 0118)", () => {
  let fleetPool: pg.Pool;
  let authPool: pg.Pool;
  let tenantPool: pg.Pool;
  let ctx: AppearanceCtx;
  let auditIdsBefore = new Set<string>();

  beforeAll(async () => {
    const url = connectionString as string;
    fleetPool = await openIntegrationPool(process.env.DATABASE_URL_FLEET ?? asRole(url, "bms_fleet", "bms_fleet_dev"), "F4.341");
    await primeSeededSubjects(fleetPool);
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "F4.341");
    tenantPool = await openIntegrationPool(process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"), "F4.341");

    const access = new AccessControlService(createDb(authPool), createDb(fleetPool));
    const audit = new MasterDataAuditService(createDb(tenantPool), createDb(fleetPool));
    const { rows } = await fleetPool.query<{ id: string; organization_id: string | null }>(
      "SELECT id, organization_id FROM bms.users WHERE email = $1",
      [SEEDED.assetGroupAdmin],
    );
    const member = rows[0];
    if (!member?.organization_id) throw new Error(`F4.341: ${SEEDED.assetGroupAdmin} has no home organization — run pnpm db:seed.`);

    const before = await fleetPool.query<{ id: string }>("SELECT id FROM bms.audit_log WHERE action = ANY($1)", [ACTIONS]);
    auditIdsBefore = new Set(before.rows.map((r) => r.id));

    ctx = {
      portal: new PortalSettingsService(createDb(fleetPool), access, audit),
      orgs: new OrganizationsAdminService(createDb(fleetPool), createDb(tenantPool), access, audit),
      access,
      fleetPool,
      globalAdmin: jwtFor(SEEDED.globalAdmin, "admin"),
      organizationAdmin: jwtFor(SEEDED.organizationAdmin, "organization_admin"),
      locationAdmin: jwtFor(SEEDED.locationAdmin, "location_admin"),
      member: jwtFor(SEEDED.assetGroupAdmin, "asset_group_admin"),
      memberId: member.id,
      memberOrgId: member.organization_id,
    };
  });

  afterAll(async () => {
    if (fleetPool) {
      const after = await fleetPool.query<{ id: string }>("SELECT id FROM bms.audit_log WHERE action = ANY($1)", [ACTIONS]);
      const added = after.rows.map((r) => r.id).filter((id) => !auditIdsBefore.has(id));
      if (added.length > 0) await fleetPool.query("DELETE FROM bms.audit_log WHERE id = ANY($1)", [added]);
    }
    await Promise.all([fleetPool?.end(), authPool?.end(), tenantPool?.end()]);
  });

  it("A1 the public read answers the one portal row's two values and nothing else", async () => {
    await thePublicReadIsTwoKeys(ctx);
  });

  it("A2 the global admin reads and writes the portal default, audited with from/to", async () => {
    await theGlobalAdminSetsThePortal(ctx);
  });

  it("A3 every other role is a 403 on the portal route", async () => {
    await everyOtherRoleIs403OnThePortal(ctx);
  });

  it("A4 Postgres holds one valid portal row", async () => {
    await theTableHoldsOneValidRow(ctx);
  });

  it("A5 the organization route sets and clears, audited; a location admin is a 403", async () => {
    await theOrganizationRouteSetsAndClears(ctx);
  });

  it("A6 the old colour-profile route is an alias", async () => {
    await theOldRouteIsAnAlias(ctx);
  });

  it("A7 a user sets their own appearance and /auth/me resolves user > organization > portal", async () => {
    await aUserSetsTheirOwnAndMeResolves(ctx);
  });

  it("A8 the user CHECK refuses an unknown name", async () => {
    await theUserCheckRefusesAnUnknownName(ctx);
  });

  it("A9 the privileges as installed are the migration's", async () => {
    await thePrivilegesAreTheMigrations(ctx);
  });
});
