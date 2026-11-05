import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { UserRole } from "@bms/shared";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { AccessControlService } from "../auth/access-control.service";
import { MimicNodesService } from "../dashboard-builder/mimic-nodes.service";
import { openIntegrationPool, requireIntegrationDb, resolveIntegrationRoleUrl } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { jwtFor, primeSeededSubjects, rememberSubject, SEEDED } from "../testing/seeded-subjects";
import * as spec from "./mimic-layout-preview.integration.spec";
import type { PreviewCtx, PreviewFixture } from "./mimic-layout-preview.integration.spec";
import { MimicLayoutPreviewService } from "./mimic-layout-preview.service";
import { MimicLayoutsService } from "./mimic-layouts.service";

/**
 * `F4.308` (plan T3) — Vitest entry point for the layout preview's checks against a real
 * database (ADR 0081 Amendment 2 decisions 2 and 3). Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the pools, the fixtures and the cleanup.
 *
 * **Cleanup deletes only rows this suite created, by id** — never a broad `DELETE` (the `F3.37`
 * data-loss finding): the two layouts (their nodes cascade), the two groups, the three planted
 * users and their grants.
 */
const connectionString = requireIntegrationDb({
  item: "F4.308",
  label: "the mimic layout preview's 404/403 checks",
  because:
    "the layout read scope, the group's organization check under withTenant and row security, and the " +
    "writer gate all resolve from real bms.users rows and real grants, so a green run without a database " +
    "asserts nothing about the order the route answers in.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);

describe.skipIf(!connectionString)("F4.308 — MimicLayoutPreviewService against a live database", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let authPool: pg.Pool;
  let fleetPool: pg.Pool;
  const layoutIds: string[] = [];
  const groupIds: string[] = [];
  const userIds: string[] = [];
  let ctx: PreviewCtx;

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F4.308");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F4.308",
    );
    authPool = await openIntegrationPool(process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"), "F4.308");
    fleetPool = await openIntegrationPool(url, "F4.308");
    // F3.78: jwtFor carries the real bms.users.id as sub (ADR 0089 decision 4).
    await primeSeededSubjects(fleetPool);

    const one = async (sql: string, params: unknown[], what: string): Promise<string> => {
      const id = (await ownerPool.query<{ id: string }>(sql, params)).rows[0]?.id;
      if (!id) throw new Error(`F4.308: ${what} not found or not inserted — run pnpm db:seed`);
      return id;
    };
    const fleetDb = createDb(fleetPool);
    const tenantDb = createDb(tenantPool);
    const accessControl = new AccessControlService(createDb(authPool), fleetDb);
    // The preview refuses a group outside the caller's readable locations (404), so the ESKOM
    // group sits at a location the seeded location admin reads: P6 then proves its 403.
    const locationAdminLocations = await accessControl.readableLocationIds(jwtFor(SEEDED.locationAdmin, "location_admin"));
    const fixtureFor = async (code: string, within: readonly string[] | null = null): Promise<PreviewFixture> => {
      const organizationId = await one("SELECT id FROM bms.organizations WHERE code = $1 LIMIT 1", [code], `organization ${code}`);
      const locationId = await one(
        `SELECT id FROM bms.locations
          WHERE organization_id = $1 AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
          ORDER BY created_at, code LIMIT 1`,
        [organizationId, within],
        `a location of ${code}`,
      );
      const groupId = await one(
        `INSERT INTO bms.asset_groups (location_id, code, name, description, organization_id)
         VALUES ($1, $2, $3, NULL, $4) RETURNING id`,
        [locationId, `f4308-${RUN}-${code}`.toLowerCase(), `F4.308 preview group ${code}`, organizationId],
        `the ${code} group`,
      );
      groupIds.push(groupId);
      const layoutId = await one(
        `INSERT INTO bms.mimic_layouts (organization_id, name, slug, canvas_w, canvas_h)
         VALUES ($1, $2, $3, 60, 40) RETURNING id`,
        [organizationId, `F4.308 preview ${code}`, `f4308-${RUN}-${code}`.toLowerCase()],
        `the ${code} layout`,
      );
      layoutIds.push(layoutId);
      await ownerPool.query(
        `INSERT INTO bms.mimic_layout_nodes
           (organization_id, layout_id, key, kind, symbol, label, role_code, tone, x, y, w, h, z)
         VALUES ($1, $2, 'pump', 'unit', 'pump', 'Pump', 'pump', NULL, 5, 5, 8, 8, 1)`,
        [organizationId, layoutId],
      );
      return { organizationId, layoutId, groupId };
    };
    const eskom = await fixtureFor("ESKOM", locationAdminLocations);
    const phewb = await fixtureFor("PHEWB");

    const plantUser = async (suffix: string, role: UserRole, organizationId: string) => {
      const email = `f4308-${RUN}-${suffix}@bms.local`;
      const id = await one(
        `INSERT INTO bms.users (email, password_hash, display_name, role, organization_id)
         VALUES ($1, 'x', $2, $3, $4) RETURNING id`,
        // ADR 0089 decision 2 (0098): every non-admin role carries a home organization.
        [email, `F4.308 ${suffix}`, role, organizationId],
        `planted user ${suffix}`,
      );
      userIds.push(id);
      await ownerPool.query("INSERT INTO bms.user_organization_access (user_id, organization_id) VALUES ($1, $2)", [
        id,
        organizationId,
      ]);
      rememberSubject(email, id);
      return jwtFor(email, role);
    };

    const layouts = new MimicLayoutsService(fleetDb, tenantDb, accessControl, new MasterDataAuditService(tenantDb, fleetDb));
    ctx = {
      service: new MimicLayoutPreviewService(
        tenantDb,
        layouts,
        new MimicNodesService(fleetDb, fleetPool, accessControl),
        accessControl,
      ),
      ownerPool,
      eskom,
      phewb,
      globalAdmin: jwtFor(SEEDED.globalAdmin, "admin"),
      phewbOrgAdmin: jwtFor(SEEDED.organizationAdmin, "organization_admin"),
      eskomLocationAdmin: jwtFor(SEEDED.locationAdmin, "location_admin"),
      eskomOperator: await plantUser("operator", "operator", eskom.organizationId),
      eskomViewer: await plantUser("viewer", "viewer", eskom.organizationId),
      phewbOperator: await plantUser("phewb-operator", "operator", phewb.organizationId),
    };
  }, 60_000);

  afterAll(async () => {
    if (ownerPool) {
      if (userIds.length > 0) {
        await ownerPool.query("DELETE FROM bms.user_organization_access WHERE user_id = ANY($1::uuid[])", [userIds]);
        await ownerPool.query("DELETE FROM bms.users WHERE id = ANY($1::uuid[])", [userIds]);
      }
      if (layoutIds.length > 0) {
        await ownerPool.query("DELETE FROM bms.mimic_layouts WHERE id = ANY($1::uuid[])", [layoutIds]);
      }
      if (groupIds.length > 0) {
        await ownerPool.query("DELETE FROM bms.asset_groups WHERE id = ANY($1::uuid[])", [groupIds]);
      }
    }
    await Promise.all([ownerPool, tenantPool, authPool, fleetPool].filter(Boolean).map((p) => p.end()));
  }, 60_000);

  it("P1 the global admin previews: 200, and the body parses the shared schema", async () => {
    await spec.assertAdminPreviews(ctx);
  }, 60_000);

  it("P2 an organization_admin previews in its own organization", async () => {
    await spec.assertOrganizationAdminPreviewsInItsOrganization(ctx);
  }, 60_000);

  it("P3 a layout outside the caller's organizations is 404", async () => {
    await spec.assertLayoutOutsideTheCallersOrganizationsIs404(ctx);
  }, 60_000);

  it("P4 a group of another organization is 404", async () => {
    await spec.assertGroupOfAnotherOrganizationIs404(ctx);
  }, 60_000);

  it("P5 an unknown group is 404", async () => {
    await spec.assertUnknownGroupIs404(ctx);
  }, 60_000);

  it("P6 operator, viewer and location_admin are 403", async () => {
    await spec.assertNonWritersAre403(ctx);
  }, 60_000);

  it("P7 an operator who cannot see the layout is 404, not 403", async () => {
    await spec.assertOperatorWhoCannotSeeTheLayoutIs404(ctx);
  }, 60_000);

  it("P8 a preview writes no audit row", async () => {
    await spec.assertPreviewWritesNoAuditRow(ctx);
  }, 60_000);
});
