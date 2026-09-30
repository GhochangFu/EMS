import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { jwtFor, SEEDED } from "../auth/access-control.integration.spec";
import { AccessControlService } from "../auth/access-control.service";
import { MimicNodesService } from "../dashboard-builder/mimic-nodes.service";
import { MimicLayoutsService } from "../mimic-layouts/mimic-layouts.service";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import * as spec from "./mimic-symbol-libraries.service.integration.spec";
import type { Ctx } from "./mimic-symbol-libraries.service.integration.spec";
import { MimicSymbolLibrariesService } from "./mimic-symbol-libraries.service";

/**
 * `F3.32f` slice 3 U2 — Vitest entry point for the organization symbol libraries against a real
 * database. Assertions live in the sibling `.spec` (ADR 0014); this file owns the pools, the
 * fixtures and the cleanup.
 *
 * **Cleanup deletes only rows this suite created** — by id, or by this run's code and slug
 * prefix — never a broad `DELETE` (the `F3.37` data-loss finding). Order: dashboards (widgets
 * cascade), layouts (nodes and pipes cascade; they reference the symbols), audit rows, symbols,
 * libraries. A switch row is removed by the case that set it.
 */
const connectionString = requireIntegrationDb({
  item: "F3.32f",
  label: "MimicSymbolLibrariesService and the organization-aware layout checks",
  because:
    "the cross-organization refusals, the per-organization switch, the retired-library and " +
    "retired-symbol exemptions and the composite keys are facts about real row security.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);

describe.skipIf(!connectionString)("F3.32f — organization symbol libraries against a live database", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let authPool: pg.Pool;
  let fleetPool: pg.Pool;
  const libraryIds = new Set<string>();
  const layoutIds = new Set<string>();
  const dashboardIds: string[] = [];
  let switchOrgId: string | undefined;
  let ctx: Ctx;

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(resolveIntegrationRoleUrl(url, "superuser", process.env), "F3.32f");
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.32f",
    );
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F3.32f",
    );
    fleetPool = await openIntegrationPool(url, "F3.32f");
    const fleetDb = createDb(fleetPool);

    const org = async (code: string): Promise<string> => {
      const row = await ownerPool.query<{ id: string }>(`SELECT id FROM bms.organizations WHERE code = $1 LIMIT 1`, [code]);
      const id = row.rows[0]?.id;
      if (!id) throw new Error(`F3.32f: organization ${code} not found — run pnpm db:seed`);
      return id;
    };
    const eskomOrgId = await org("ESKOM");
    const phewbOrgId = await org("PHEWB");
    // The switch cases turn a global library off for an organization. Every static code is
    // chosen by some other suite, and the DB suites run in parallel, so they switch it off for
    // a throwaway organization no other suite reads — never for ESKOM or PHEWB.
    const planted = await ownerPool.query<{ id: string }>(
      "INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'ZAR') RETURNING id",
      [`F332F-${RUN}-ORG`, "F3.32f switch fixture organization"],
    );
    switchOrgId = planted.rows[0]?.id as string;
    if (!switchOrgId) throw new Error("F3.32f: the switch fixture organization was not planted");

    const tenantDb = createDb(tenantPool);
    // Counts the layouts service's transactions: each write opens one (`withTenant`), so an
    // unchanged count proves a refusal came from the service's checks, not the insert.
    let layoutTransactions = 0;
    const countingTenantDb = new Proxy(tenantDb, {
      get(target, prop, receiver) {
        if (prop === "transaction") {
          return (...args: Parameters<BmsDb["transaction"]>) => {
            layoutTransactions += 1;
            return target.transaction(...args);
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    const accessControl = new AccessControlService(createDb(authPool), fleetDb);
    const audit = new MasterDataAuditService(tenantDb, fleetDb);

    ctx = {
      libraries: new MimicSymbolLibrariesService(fleetDb, tenantDb, accessControl, audit),
      layouts: new MimicLayoutsService(fleetDb, countingTenantDb, accessControl, audit),
      nodes: new MimicNodesService(fleetDb, fleetPool, accessControl),
      ownerPool,
      eskomOrgId,
      phewbOrgId,
      switchOrgId: switchOrgId as string,
      globalAdmin: jwtFor(SEEDED.globalAdmin, "admin"),
      phewbOrgAdmin: jwtFor(SEEDED.organizationAdmin, "organization_admin"),
      eskomLocationAdmin: jwtFor(SEEDED.locationAdmin, "location_admin"),
      code: (suffix) => `f${RUN}${suffix}`,
      slug: (suffix) => `f332f-${RUN}-${suffix}`,
      trackLibrary: (id) => {
        libraryIds.add(id);
      },
      trackLayout: (id) => {
        layoutIds.add(id);
      },
      plantDashboard: async (organizationId, layoutId) => {
        const dashboard = await ownerPool.query<{ id: string }>(
          `INSERT INTO bms.dashboards (organization_id, slug, name) VALUES ($1, $2, $3) RETURNING id`,
          [organizationId, `f332f-${RUN}-dash-${dashboardIds.length}`, "F3.32f resolver proof"],
        );
        const dashboardId = dashboard.rows[0]?.id as string;
        dashboardIds.push(dashboardId);
        await ownerPool.query(
          `INSERT INTO bms.dashboard_widgets
             (organization_id, dashboard_id, widget_type, grid_x, grid_y, grid_w, grid_h, config)
           VALUES ($1, $2, 'mimic', 0, 0, 6, 6, $3::jsonb)`,
          [organizationId, dashboardId, JSON.stringify({ source: "layout", layoutId })],
        );
        return dashboardId;
      },
      layoutWrites: () => layoutTransactions,
      resetSetting: async (organizationId, libraryCode) => {
        await ownerPool.query(`DELETE FROM bms.mimic_library_settings WHERE organization_id = $1 AND library_code = $2`, [
          organizationId,
          libraryCode,
        ]);
      },
    };
  }, 60_000);

  afterAll(async () => {
    if (ownerPool) {
      if (dashboardIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.dashboards WHERE id = ANY($1::uuid[])`, [dashboardIds]);
      }
      // Also every layout carrying this run's slug prefix: a refusal whose guard is broken
      // creates a row it never got the id of.
      const byRun = await ownerPool.query<{ id: string }>(`SELECT id FROM bms.mimic_layouts WHERE slug LIKE $1`, [
        `f332f-${RUN}-%`,
      ]);
      const layouts = [...new Set([...layoutIds, ...byRun.rows.map((row) => row.id)])];
      if (layouts.length > 0) {
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])`, [layouts]);
        await ownerPool.query(`DELETE FROM bms.mimic_layouts WHERE id = ANY($1::uuid[])`, [layouts]);
      }
      const libraries = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.mimic_org_symbol_libraries WHERE id = ANY($1::uuid[]) OR code LIKE $2`,
        [[...libraryIds], `f${RUN}%`],
      );
      const ids = libraries.rows.map((row) => row.id);
      if (ids.length > 0) {
        const symbols = await ownerPool.query<{ id: string }>(
          `SELECT id FROM bms.mimic_org_symbols WHERE library_id = ANY($1::uuid[])`,
          [ids],
        );
        const audited = [...ids, ...symbols.rows.map((row) => row.id)];
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])`, [audited]);
        await ownerPool.query(`DELETE FROM bms.mimic_org_symbols WHERE library_id = ANY($1::uuid[])`, [ids]);
        await ownerPool.query(`DELETE FROM bms.mimic_org_symbol_libraries WHERE id = ANY($1::uuid[])`, [ids]);
      }
      if (switchOrgId) {
        // Its layouts went with the slug prefix above; its switch rows and audit rows are its own.
        await ownerPool.query(`DELETE FROM bms.mimic_library_settings WHERE organization_id = $1`, [switchOrgId]);
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE organization_id = $1`, [switchOrgId]);
        await ownerPool.query(`DELETE FROM bms.organizations WHERE id = $1`, [switchOrgId]);
      }
    }
    await Promise.all([ownerPool, tenantPool, authPool, fleetPool].filter(Boolean).map((p) => p.end()));
  }, 60_000);

  it("L1 create answers org.<code> and audits", async () => {
    await spec.assertCreateAnswersTheOrgKeyAndAudits(ctx);
  }, 60_000);
  it("L2 an organization admin creating in another organization is a 403", async () => {
    await spec.assertOrgAdminCreatingInAnotherOrganizationIs403(ctx);
  }, 60_000);
  it("L3 a location admin's create is a 403 by role", async () => {
    await spec.assertLocationAdminCreateIs403(ctx);
  }, 60_000);
  it("L4 a duplicate code in the organization is a 409", async () => {
    await spec.assertDuplicateCodeIs409(ctx);
  }, 60_000);

  it("U1 an upload stores geometry only, the buffer's hash, and audits the hash", async () => {
    await spec.assertUploadStoresGeometryAndTheHash(ctx);
  }, 60_000);
  it("U2 a second upload of the same name is a 409", async () => {
    await spec.assertASecondUploadOfTheSameNameIs409(ctx);
  }, 60_000);
  it("U3 a parser refusal is a 400 naming the element, and stores nothing", async () => {
    await spec.assertAParserRefusalIs400AndStoresNothing(ctx);
  }, 60_000);
  it("U4 a declared type other than image/svg+xml is a 400", async () => {
    await spec.assertAWrongDeclaredTypeIs400(ctx);
  }, 60_000);
  it("U5 a buffer over the byte cap is a 413", async () => {
    await spec.assertABufferOverTheCapIs413(ctx);
  }, 60_000);
  it("U6 the name and label default from the filename", async () => {
    await spec.assertTheNameDefaultsFromTheFilename(ctx);
  }, 60_000);
  it("U7 an upload into another organization's library is a 404", async () => {
    await spec.assertUploadIntoAnotherOrganizationsLibraryIs404(ctx);
  }, 60_000);

  it("R1 the catalog is scoped to the caller's organizations", async () => {
    await spec.assertTheCatalogIsScopedToTheCallersOrganizations(ctx);
  }, 60_000);
  it("R2 the catalog lists symbols, retired ones included with the flag", async () => {
    await spec.assertTheCatalogListsSymbolsRetiredOnesIncluded(ctx);
  }, 60_000);
  it("R3 a stored symbol outside the contract is omitted, never a 400", async () => {
    await spec.assertAStoredSymbolOutsideTheContractIsOmitted(ctx);
  }, 60_000);

  it("Y1 a layout draws an organization symbol through org_symbol_key", async () => {
    await spec.assertALayoutDrawsAnOrgSymbol(ctx);
  }, 60_000);
  it("Y2 another organization's symbol is refused by the service before any write", async () => {
    await spec.assertACrossOrganizationSymbolIsRefusedBeforeAnyWrite(ctx);
  }, 60_000);
  it("Y3 an unknown organization symbol is a 400 that echoes no key", async () => {
    await spec.assertAnUnknownOrgSymbolIs400WithoutTheKey(ctx);
  }, 60_000);
  it("Y4 another organization's library is a 400", async () => {
    await spec.assertAnotherOrganizationsLibraryIs400(ctx);
  }, 60_000);

  it("S1 a disabled global library refuses a new layout", async () => {
    await spec.assertADisabledLibraryRefusesANewLayout(ctx);
  }, 60_000);
  it("S2 the switch binds only its own organization", async () => {
    await spec.assertTheSwitchBindsOnlyItsOrganization(ctx);
  }, 60_000);
  it("S3 a stored layout on a disabled library re-saves", async () => {
    await spec.assertAStoredDisabledLibraryReSaves(ctx);
  }, 60_000);
  it("S4 core cannot be disabled", async () => {
    await spec.assertCoreCannotBeDisabled(ctx);
  }, 60_000);
  it("S5 an unknown library code is a 400", async () => {
    await spec.assertAnUnknownLibraryCodeIs400(ctx);
  }, 60_000);
  it("S6 the switch is audited with no entity id", async () => {
    await spec.assertTheSwitchIsAudited(ctx);
  }, 60_000);
  it("S7 a stored layout on a disabled library refuses a new unit from it", async () => {
    await spec.assertAStoredDisabledLibraryRefusesANewUnit(ctx);
  }, 60_000);

  it("T1 a retired library refuses a new layout", async () => {
    await spec.assertARetiredLibraryRefusesANewLayout(ctx);
  }, 60_000);
  it("T2 a stored layout on a retired library re-saves and still draws", async () => {
    await spec.assertAStoredRetiredLibraryReSavesAndStillDraws(ctx);
  }, 60_000);
  it("T3 a retired symbol refuses a new layout", async () => {
    await spec.assertARetiredSymbolRefusesANewLayout(ctx);
  }, 60_000);
  it("T4 a stored layout drawing a retired symbol re-saves", async () => {
    await spec.assertAStoredRetiredSymbolReSaves(ctx);
  }, 60_000);

  it("V1 the resolver embeds layout.orgSymbols", async () => {
    await spec.assertTheResolverEmbedsOrgSymbols(ctx);
  }, 60_000);
});
