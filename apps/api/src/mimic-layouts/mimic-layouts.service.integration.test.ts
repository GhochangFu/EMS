import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { jwtFor, SEEDED } from "../auth/access-control.integration.spec";
import { AccessControlService } from "../auth/access-control.service";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import * as spec from "./mimic-layouts.service.integration.spec";
import type { Ctx } from "./mimic-layouts.service.integration.spec";
import { MimicLayoutsController } from "./mimic-layouts.controller";
import { MimicLayoutsService } from "./mimic-layouts.service";

/**
 * `F3.32c` U2 — Vitest entry point for `MimicLayoutsService` against a real
 * database (plan U2, C1–C11; C12–C17 from U7; C18–C23 from `F3.32e` U2). Assertions live in the sibling `.spec`
 * (ADR 0014); this file owns the pools, the fixtures and the cleanup.
 *
 * **Cleanup deletes only rows this suite created, by id** — never a broad
 * `DELETE` (the `F3.37` data-loss finding). The layouts' nodes and pipes
 * cascade; the planted dashboards' widgets cascade.
 */
const connectionString = requireIntegrationDb({
  item: "F3.32c",
  label: "MimicLayoutsService tenant isolation, optimistic version and delete guard",
  because:
    "the version check, the in-use count, the slug and role-code refusals and the " +
    "cross-organization 404/403 are facts about a real connection and real row security.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);

describe.skipIf(!connectionString)("F3.32c — MimicLayoutsService against a live database", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let authPool: pg.Pool;
  let fleetPool: pg.Pool;
  let fleetDb: BmsDb;
  const layoutIds = new Set<string>();
  const dashboardIds: string[] = [];
  const roleCodes: string[] = [];
  let ctx: Ctx;

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F3.32c");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.32c",
    );
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F3.32c",
    );
    fleetPool = await openIntegrationPool(url, "F3.32c");
    fleetDb = createDb(fleetPool);

    const org = async (code: string): Promise<string> => {
      const row = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.organizations WHERE code = $1 LIMIT 1`,
        [code],
      );
      const id = row.rows[0]?.id;
      if (!id) throw new Error(`F3.32c: organization ${code} not found — run pnpm db:seed`);
      return id;
    };
    const eskomOrgId = await org("ESKOM");
    const phewbOrgId = await org("PHEWB");

    const tenantDb = createDb(tenantPool);
    const accessControl = new AccessControlService(createDb(authPool), fleetDb);
    const audit = new MasterDataAuditService(tenantDb, fleetDb);

    const service = new MimicLayoutsService(fleetDb, tenantDb, accessControl, audit);
    ctx = {
      service,
      controller: new MimicLayoutsController(service),
      ownerPool,
      eskomOrgId,
      phewbOrgId,
      globalAdmin: jwtFor(SEEDED.globalAdmin, "admin"),
      phewbOrgAdmin: jwtFor(SEEDED.organizationAdmin, "organization_admin"),
      eskomLocationAdmin: jwtFor(SEEDED.locationAdmin, "location_admin"),
      slug: (suffix) => `f332c-${RUN}-${suffix}`,
      track: (id) => {
        layoutIds.add(id);
      },
      plantReferencingWidget: async (layoutId) => {
        const dashboard = await ownerPool.query<{ id: string }>(
          `INSERT INTO bms.dashboards (organization_id, slug, name) VALUES ($1, $2, $3) RETURNING id`,
          [eskomOrgId, `f332c-${RUN}-dash-${dashboardIds.length}`, "F3.32c in-use proof"],
        );
        const dashboardId = dashboard.rows[0]?.id as string;
        dashboardIds.push(dashboardId);
        await ownerPool.query(
          `INSERT INTO bms.dashboard_widgets
             (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h, config)
           VALUES ($1, $2, 'mimic', 0, 0, 6, 6, $3::jsonb)`,
          [eskomOrgId, dashboardId, JSON.stringify({ source: "layout", layoutId })],
        );
        return dashboardId;
      },
      plantRole: async (suffix) => {
        const code = `f332c-${RUN}-role-${suffix}`;
        await ownerPool.query(`INSERT INTO bms.asset_roles (code, label) VALUES ($1, $2)`, [
          code,
          `F3.32c ${suffix} role`,
        ]);
        roleCodes.push(code);
        return code;
      },
    };
  }, 60_000);

  afterAll(async () => {
    if (ownerPool) {
      // Also every layout carrying this run's slug prefix: a refusal case whose
      // guard is broken creates a row it never got the id of.
      const byRun = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.mimic_layouts WHERE slug LIKE $1`,
        [`f332c-${RUN}-%`],
      );
      const ids = [...new Set([...layoutIds, ...byRun.rows.map((row) => row.id)])];
      if (dashboardIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.dashboards WHERE id = ANY($1::uuid[])`, [dashboardIds]);
      }
      if (ids.length > 0) {
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])`, [ids]);
        await ownerPool.query(`DELETE FROM bms.mimic_layouts WHERE id = ANY($1::uuid[])`, [ids]);
      }
      // After the layouts: their nodes reference these codes, and the nodes cascade with them.
      if (roleCodes.length > 0) {
        await ownerPool.query(`DELETE FROM bms.asset_roles WHERE code = ANY($1::text[])`, [roleCodes]);
      }
    }
    await Promise.all([ownerPool, tenantPool, authPool, fleetPool].filter(Boolean).map((p) => p.end()));
  }, 60_000);

  it("C1 create answers nodes by (z, y, x, key), pipes by keys, and audits", async () => {
    await spec.assertCreateAnswersOrderedNodesAndPipes(ctx);
  }, 60_000);

  it("C2 a duplicate slug in the organization is a 409", async () => {
    await spec.assertDuplicateSlugIs409(ctx);
  }, 60_000);

  it("C3 a stale version is a 409 and changes nothing", async () => {
    await spec.assertStaleVersionIs409AndChangesNothing(ctx);
  }, 60_000);

  it("C4 a replace regenerates node ids, and the pipes follow the keys", async () => {
    await spec.assertReplaceRegeneratesIdsAndPipesFollowKeys(ctx);
  }, 60_000);

  it("C5 deleting a layout a widget names is a 409", async () => {
    await spec.assertDeleteOfReferencedLayoutIs409(ctx);
  }, 60_000);

  it("C6 deleting an unreferenced layout cascades", async () => {
    await spec.assertDeleteOfUnreferencedLayoutCascades(ctx);
  }, 60_000);

  it("C7 another organization's layout is a 404", async () => {
    await spec.assertCrossOrganizationGetIs404(ctx);
  }, 60_000);

  it("C8 a location admin's create is a 403", async () => {
    await spec.assertLocationAdminCreateIs403(ctx);
  }, 60_000);

  it("C9 an organization admin's create in another organization is a 403", async () => {
    await spec.assertOrgAdminCreatingInAnotherOrganizationIs403(ctx);
  }, 60_000);

  it("C10 the list excludes another organization's layouts", async () => {
    await spec.assertListExcludesAnotherOrganization(ctx);
  }, 60_000);

  it("C11 an unknown role code is a 400 that does not echo the code", async () => {
    await spec.assertUnknownRoleIs400WithoutTheCode(ctx);
  }, 60_000);

  it("C12 a delete waits for a concurrent widget save, then refuses with 409", async () => {
    await spec.assertDeleteWaitsForAConcurrentWidgetSave(ctx);
  }, 60_000);

  it("C13 deleting a referenced layout by its uppercase id is a 409", async () => {
    await spec.assertUppercaseIdDeleteOfReferencedLayoutIs409(ctx);
  }, 60_000);

  it("C14 a replace onto another layout's slug is a 409 with the slug sentence, and changes nothing", async () => {
    await spec.assertReplaceOntoATakenSlugIs409AndChangesNothing(ctx);
  }, 60_000);

  it("C15 a create naming a retired role is a 400", async () => {
    await spec.assertCreateWithARetiredRoleIs400(ctx);
  }, 60_000);

  it("C16 a replace keeping a stored role saves after the role is retired", async () => {
    await spec.assertReplaceKeepingAStoredRetiredRoleSaves(ctx);
  }, 60_000);

  it("C17 a replace adding a retired role is a 400", async () => {
    await spec.assertReplaceAddingARetiredRoleIs400(ctx);
  }, 60_000);

  it("C18 F3.32e a create stores the chosen libraries, and the DTO and the list carry them", async () => {
    await spec.assertCreateStoresTheChosenLibraries(ctx);
  }, 60_000);

  it("C19 F3.32e a POST body without symbolLibraries stores core", async () => {
    await spec.assertAnAbsentLibraryListStoresCore(ctx);
  }, 60_000);

  it("C20 F3.32e a PUT dropping a library a unit still uses is a 400", async () => {
    await spec.assertReplaceDroppingAUsedLibraryIs400(ctx);
  }, 60_000);

  it("C21 F3.32e a PUT dropping a library with its unit saves", async () => {
    await spec.assertReplaceDroppingAnUnusedLibrarySaves(ctx);
  }, 60_000);

  it("C22 F3.32e a create choosing an inactive library is a 400", async () => {
    await spec.assertAnInactiveLibraryIs400(ctx);
  }, 60_000);

  it("C23 F3.32e an unknown symbol is a 400 that does not echo the key", async () => {
    await spec.assertAnUnknownSymbolIs400WithoutTheKey(ctx);
  }, 60_000);
});
