import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { AccessControlService } from "../auth/access-control.service";
import { jwtFor, SEEDED } from "../auth/access-control.integration.spec";
import { MasterDataAuditService } from "../admin/master-data-audit.service";
import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { countingDb, countingDbMethod } from "../testing/counting-db";
import { DashboardsService } from "./dashboards.service";
import {
  assertCreateAuditRowStamped,
  assertCreateRoutesOnTenantPoolOnly,
  assertCrossOrgLocationScopeRefusedByRls,
  assertCrossTenantSlugReadIs404,
  assertForeignOrgIdUpdateIs404SameAsNonexistent,
  assertPutWidgetsDtoReflectsTheWrite,
} from "./dashboards.service.rls.integration.spec";

/**
 * `F3.1b` Task 4 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014); this
 * file owns the database lifecycle, per-run fixture slugs, and cleanup.
 */
const connectionString = requireIntegrationDb({
  item: "F3.1b",
  label: "DashboardsService pool routing, audit stamping, and cross-tenant read/write",
  because:
    "whether create() opens exactly one tenant transaction, whether the audit row is stamped " +
    "with a real organizationId, and whether a cross-tenant read/write is actually refused are " +
    "all facts about a real connection and real RLS — countingDb and a safeParse cannot prove " +
    "any of them against a fake db.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
const CREATE_SLUG = `f31b-create-${RUN}`;
const WIDGETS_SLUG = `f31b-widgets-${RUN}`;
const FOREIGN_UPDATE_SLUG = `f31b-foreign-${RUN}`;
const CROSS_ORG_SCOPE_SLUG = `f31b-scope-${RUN}`;

describe.skipIf(!connectionString)(
  "F3.1b — DashboardsService pool routing, audit stamping, cross-tenant read/write",
  () => {
    let ownerPool: pg.Pool;
    let tenantPool: pg.Pool;
    let authPool: pg.Pool;
    let fleetDb: BmsDb;
    let dashboardIds: string[] = [];

    let eskomOrgId: string;
    let phewbOrgId: string;
    let phewbLocationId: string;
    let eskomPointId: string;

    beforeAll(async () => {
      const url = connectionString as string;
      ownerPool = await openIntegrationPool(url, "F3.1b");
      tenantPool = await openIntegrationPool(
        process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
        "F3.1b",
      );
      authPool = await openIntegrationPool(
        process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
        "F3.1b",
      );
      fleetDb = createDb(ownerPool);

      const eskom = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.organizations WHERE code = 'ESKOM' LIMIT 1`,
      );
      const phewb = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.organizations WHERE code = 'PHEWB' LIMIT 1`,
      );
      eskomOrgId = eskom.rows[0]?.id ?? "";
      phewbOrgId = phewb.rows[0]?.id ?? "";
      if (!eskomOrgId || !phewbOrgId) {
        throw new Error("F3.1b: ESKOM/PHEWB organizations not found — run pnpm db:seed");
      }

      // F4.53: ORDER BY created_at (id as a tiebreaker) resolves the OLDEST row — a seeded one,
      // which predates every suite in the run and so is the only row no concurrent suite can
      // delete out from under this fixture setup.
      const phewbLocation = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.locations WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
        [phewbOrgId],
      );
      phewbLocationId = phewbLocation.rows[0]?.id ?? "";
      if (!phewbLocationId) {
        throw new Error("F3.1b: PHEWB has no location — run pnpm db:seed");
      }

      const eskomPoint = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.asset_points WHERE organization_id = $1 LIMIT 1`,
        [eskomOrgId],
      );
      eskomPointId = eskomPoint.rows[0]?.id ?? "";
      if (!eskomPointId) {
        throw new Error("F3.1b: ESKOM has no asset_points — run pnpm db:seed");
      }
    }, 60_000);

    afterAll(async () => {
      if (dashboardIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])`, [dashboardIds]);
        await ownerPool.query(`DELETE FROM bms.dashboards WHERE id = ANY($1::uuid[])`, [dashboardIds]);
      }
      await Promise.all([ownerPool, tenantPool, authPool].filter(Boolean).map((p) => p.end()));
    }, 60_000);

    it("routes create() onto the tenant pool only, and stamps the audit row correctly", async () => {
      const countedTenant = countingDb(createDb(tenantPool));
      const countedFleetInsert = countingDbMethod(fleetDb, "insert");
      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const audit = new MasterDataAuditService(countedTenant.db, fleetDb);
      const service = new DashboardsService(countedTenant.db, fleetDb, accessControl, audit);

      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");
      const { id } = await assertCreateRoutesOnTenantPoolOnly(
        service,
        countedTenant,
        countedFleetInsert,
        globalAdmin,
        eskomOrgId,
        CREATE_SLUG,
      );
      dashboardIds.push(id);
      await assertCreateAuditRowStamped(fleetDb, id, eskomOrgId);
    }, 60_000);

    it("PUT :id/widgets — the returned DTO reflects the write, proven on a separate connection", async () => {
      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const audit = new MasterDataAuditService(createDb(tenantPool), fleetDb);
      const service = new DashboardsService(createDb(tenantPool), fleetDb, accessControl, audit);
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

      const created = await service.create(globalAdmin, {
        organizationId: eskomOrgId,
        slug: WIDGETS_SLUG,
        name: "F3.1b widgets RLS proof",
      } as Parameters<DashboardsService["create"]>[1]);
      dashboardIds.push(created.id);

      await assertPutWidgetsDtoReflectsTheWrite(service, fleetDb, globalAdmin, created.id, eskomPointId);
    }, 60_000);

    it("a foreign-org dashboard id and a nonexistent id refuse update() with the SAME 404 body", async () => {
      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const audit = new MasterDataAuditService(createDb(tenantPool), fleetDb);
      const service = new DashboardsService(createDb(tenantPool), fleetDb, accessControl, audit);
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

      const eskomDashboard = await service.create(globalAdmin, {
        organizationId: eskomOrgId,
        slug: FOREIGN_UPDATE_SLUG,
        name: "F3.1b foreign-id proof",
      } as Parameters<DashboardsService["create"]>[1]);
      dashboardIds.push(eskomDashboard.id);

      // phe-admin@bms.local is PHEWB's organization_admin — its own org does not match the
      // ESKOM dashboard above, so canManageDashboard must refuse it.
      const phewbOrgAdmin = jwtFor(SEEDED.organizationAdmin, "organization_admin");
      await assertForeignOrgIdUpdateIs404SameAsNonexistent(service, phewbOrgAdmin, eskomDashboard.id);
    }, 60_000);

    it("a PHEWB dashboard's slug is invisible to an ESKOM-scoped reader — 404, not a row", async () => {
      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const audit = new MasterDataAuditService(createDb(tenantPool), fleetDb);
      const service = new DashboardsService(createDb(tenantPool), fleetDb, accessControl, audit);
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

      const phewbSlug = `f31b-phewb-${RUN}`;
      const phewbDashboard = await service.create(globalAdmin, {
        organizationId: phewbOrgId,
        slug: phewbSlug,
        name: "F3.1b PHEWB cross-tenant proof",
      } as Parameters<DashboardsService["create"]>[1]);
      dashboardIds.push(phewbDashboard.id);

      // wc-admin@bms.local is ESKOM's location_admin — a genuinely scoped, single-organization
      // reader, which is what routes getBySlug onto the TENANT pool (withReadScope) rather than
      // the fleet one.
      const eskomLocationAdmin = jwtFor(SEEDED.locationAdmin, "location_admin");
      await assertCrossTenantSlugReadIs404(service, eskomLocationAdmin, phewbSlug);
    }, 60_000);

    it("an ESKOM dashboard scoped to a PHEWB location is refused by RLS, not by the foreign key", async () => {
      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const audit = new MasterDataAuditService(createDb(tenantPool), fleetDb);
      const service = new DashboardsService(createDb(tenantPool), fleetDb, accessControl, audit);
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

      await assertCrossOrgLocationScopeRefusedByRls(
        service,
        globalAdmin,
        eskomOrgId,
        phewbLocationId,
        CROSS_ORG_SCOPE_SLUG,
      );
      // No id to push to dashboardIds: the insert was refused, nothing landed.
    }, 60_000);
  },
);
