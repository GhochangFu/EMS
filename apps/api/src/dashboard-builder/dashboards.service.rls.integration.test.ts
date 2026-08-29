import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";
import type { BmsDb } from "@bms/db";

import { AccessControlService } from "../auth/access-control.service";
import { jwtFor, SEEDED } from "../auth/access-control.integration.spec";
import { MasterDataAuditService } from "../admin/master-data-audit.service";
import {
  openIntegrationPool,
  requireIntegrationDb,
  resolveIntegrationRoleUrl,
} from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import { countingDb, countingDbMethod } from "../testing/counting-db";
import { DashboardsService } from "./dashboards.service";
import {
  assertCreateAuditRowStamped,
  assertCreateRoutesOnTenantPoolOnly,
  assertCrossOrgLocationScopeRefusedByRls,
  assertCrossTenantSlugReadIs404,
  assertFleetBranchExcludesAForeignOrganization,
  assertForeignOrgIdUpdateIs404SameAsNonexistent,
  assertLocationAdminCannotRehomeOrganizationWideDashboard,
  assertLocationAdminMayStillUpdateItsOwnLocationDashboard,
  assertPutWidgetsDtoReflectsTheWrite,
  assertUnauthorizedUpdateWithScopeConflictIs404,
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
const LEAK_ORG_CODE = `F31B-LEAK-${RUN}`;
const LEAK_SLUG = `f31b-leak-${RUN}`;
const MULTI_ORG_EMAIL = `f31b-multiorg-${RUN}@integration.invalid`;
const SCOPE_CONFLICT_SLUG = `f31b-conflict-${RUN}`;
const ORG_WIDE_REHOME_SLUG = `f31d-orgwide-rehome-${RUN}`;
const OWN_LOCATION_SLUG = `f31d-own-location-${RUN}`;

describe.skipIf(!connectionString)(
  "F3.1b — DashboardsService pool routing, audit stamping, cross-tenant read/write",
  () => {
    let ownerPool: pg.Pool;
    let superuserPool: pg.Pool;
    let tenantPool: pg.Pool;
    let authPool: pg.Pool;
    let fleetDb: BmsDb;
    let dashboardIds: string[] = [];

    let eskomOrgId: string;
    let phewbOrgId: string;
    let phewbLocationId: string;
    let phewbAssetGroupId: string;
    let eskomPointId: string;
    let eskomLocationAdminLocationId: string;
    let leakOrgIdForCleanup: string | undefined;
    let multiOrgUserIdForCleanup: string | undefined;
    /** Set only when the seed supplied no PHEWB asset group and this suite made one. */
    let createdAssetGroupIdForCleanup: string | undefined;

    beforeAll(async () => {
      const url = connectionString as string;
      ownerPool = await openIntegrationPool(url, "F3.1b");
      // bms_fleet (the "fleet" role requireIntegrationDb's connectionString above already
      // names) has no INSERT grant on bms.users — its mutation is reserved to bms_auth/the
      // provisioning superuser (ADR 0044/0045). Only the fleet-branch multi-organization test
      // fixture below needs this pool, for the one INSERT that would otherwise be refused.
      superuserPool = await openIntegrationPool(
        resolveIntegrationRoleUrl(url, "superuser", process.env),
        "F3.1b",
      );
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

      const phewbAssetGroup = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.asset_groups WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
        [phewbOrgId],
      );
      phewbAssetGroupId = phewbAssetGroup.rows[0]?.id ?? "";
      if (!phewbAssetGroupId) {
        // **A fresh `pnpm db:seed` gives PHEWB locations but no asset groups.** This threw
        // `run pnpm db:seed` until CI proved the advice wrong: a developer database
        // accumulates PHEWB groups from the pilot seed and from other suites' fixtures, so the
        // requirement held locally and failed on the only database that is actually clean.
        // A seeded row is still preferred (`F4.53`) — this is the fallback when the seed has
        // none, not a replacement for reading one.
        const created = await ownerPool.query<{ id: string }>(
          `INSERT INTO bms.asset_groups (organization_id, location_id, code, name)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [phewbOrgId, phewbLocationId, `f31b-fixture-${Date.now()}`, "F3.1b fixture group"],
        );
        phewbAssetGroupId = created.rows[0]?.id ?? "";
        createdAssetGroupIdForCleanup = phewbAssetGroupId;
      }
      if (!phewbAssetGroupId) {
        throw new Error("F3.1b: could not read or create a PHEWB asset group");
      }

      // Finding 7 (review): ESKOM has exactly one seeded asset_points row while other suites
      // create and delete transient ESKOM points in the same parallel run — an unordered
      // LIMIT 1 can adopt a transient one and find it gone under ON DELETE CASCADE.
      const eskomPoint = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.asset_points WHERE organization_id = $1 ORDER BY created_at, id LIMIT 1`,
        [eskomOrgId],
      );
      eskomPointId = eskomPoint.rows[0]?.id ?? "";
      if (!eskomPointId) {
        throw new Error("F3.1b: ESKOM has no asset_points — run pnpm db:seed");
      }

      // wc-admin@bms.local's own granted location — the site the F3.1d re-home exploit tries
      // to move an organization-wide dashboard onto.
      const eskomLocationAdminLocation = await ownerPool.query<{ id: string }>(
        `SELECT l.id
           FROM bms.locations l
           JOIN bms.user_location_access ula ON ula.location_id = l.id
           JOIN bms.users u ON u.id = ula.user_id
          WHERE u.email = 'wc-admin@bms.local' LIMIT 1`,
      );
      eskomLocationAdminLocationId = eskomLocationAdminLocation.rows[0]?.id ?? "";
      if (!eskomLocationAdminLocationId) {
        throw new Error("F3.1d: wc-admin@bms.local has no location grant — run pnpm db:seed");
      }
    }, 60_000);

    afterAll(async () => {
      if (dashboardIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.audit_log WHERE entity_id = ANY($1::uuid[])`, [dashboardIds]);
        await ownerPool.query(`DELETE FROM bms.dashboards WHERE id = ANY($1::uuid[])`, [dashboardIds]);
      }
      if (createdAssetGroupIdForCleanup) {
        await ownerPool.query(`DELETE FROM bms.asset_groups WHERE id = $1`, [createdAssetGroupIdForCleanup]);
      }
      if (multiOrgUserIdForCleanup) {
        // bms_fleet has no DELETE grant on bms.users either — superuserPool throughout.
        await superuserPool.query(`DELETE FROM bms.user_organization_access WHERE user_id = $1`, [
          multiOrgUserIdForCleanup,
        ]);
        await superuserPool.query(`DELETE FROM bms.users WHERE id = $1`, [multiOrgUserIdForCleanup]);
      }
      if (leakOrgIdForCleanup) {
        await ownerPool.query(`DELETE FROM bms.organizations WHERE id = $1`, [leakOrgIdForCleanup]);
      }
      await Promise.all(
        [ownerPool, superuserPool, tenantPool, authPool].filter(Boolean).map((p) => p.end()),
      );
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

    it("finding 5 (review) — an unauthorized PATCH that would conflict with a stored assetGroupId gets the same 404", async () => {
      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const audit = new MasterDataAuditService(createDb(tenantPool), fleetDb);
      const service = new DashboardsService(createDb(tenantPool), fleetDb, accessControl, audit);
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

      const phewbGroupDashboard = await service.create(globalAdmin, {
        organizationId: phewbOrgId,
        slug: SCOPE_CONFLICT_SLUG,
        name: "F3.1b scope-conflict 404 proof",
        assetGroupId: phewbAssetGroupId,
      } as Parameters<DashboardsService["create"]>[1]);
      dashboardIds.push(phewbGroupDashboard.id);

      // wc-admin@bms.local is ESKOM's location_admin — no authority over any PHEWB dashboard,
      // regardless of what the PATCH body's locationId happens to be.
      const eskomLocationAdmin = jwtFor(SEEDED.locationAdmin, "location_admin");
      await assertUnauthorizedUpdateWithScopeConflictIs404(
        service,
        eskomLocationAdmin,
        phewbGroupDashboard.id,
        phewbLocationId,
      );
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

    it("finding 1 (HIGH) — a two-organization caller's fleet-branch read excludes a third organization", async () => {
      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const audit = new MasterDataAuditService(createDb(tenantPool), fleetDb);
      const service = new DashboardsService(createDb(tenantPool), fleetDb, accessControl, audit);
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

      // A THIRD organization, unrelated to the two-org actor's grants below — the row that
      // must NOT leak. A fresh org rather than reusing ESKOM/PHEWB: this repository's seed
      // carries exactly two, and "excluded from a caller's own two" cannot be tested without a
      // third that genuinely is neither.
      const leakOrg = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.organizations (code, name) VALUES ($1, 'F3.1b fleet-leak proof org') RETURNING id`,
        [LEAK_ORG_CODE],
      );
      const leakOrgId = leakOrg.rows[0]?.id;
      if (!leakOrgId) {
        throw new Error("F3.1b: leak-proof organization did not insert");
      }
      leakOrgIdForCleanup = leakOrgId;

      const leakDashboard = await service.create(globalAdmin, {
        organizationId: leakOrgId,
        slug: LEAK_SLUG,
        name: "F3.1b fleet-leak proof dashboard",
      } as Parameters<DashboardsService["create"]>[1]);
      dashboardIds.push(leakDashboard.id);

      // A genuinely two-organization actor: ADR 0043 decision 3's documented fleet-branch
      // fallback (an organization_admin with two user_organization_access rows) — a FRESH
      // throwaway user rather than mutating a seeded fixture's grants, so this cannot race
      // another suite reading phe-admin@bms.local's identity in the same parallel run.
      const multiOrgUser = await superuserPool.query<{ id: string }>(
        `INSERT INTO bms.users (email, password_hash, display_name, role)
         VALUES ($1, 'x', 'F3.1b multi-org proof', 'organization_admin')
         RETURNING id`,
        [MULTI_ORG_EMAIL],
      );
      const multiOrgUserId = multiOrgUser.rows[0]?.id;
      if (!multiOrgUserId) {
        throw new Error("F3.1b: multi-org proof user did not insert");
      }
      multiOrgUserIdForCleanup = multiOrgUserId;
      await superuserPool.query(
        `INSERT INTO bms.user_organization_access (user_id, organization_id) VALUES ($1, $2), ($1, $3)`,
        [multiOrgUserId, eskomOrgId, phewbOrgId],
      );

      const twoOrgActor = jwtFor(MULTI_ORG_EMAIL, "organization_admin");
      await assertFleetBranchExcludesAForeignOrganization(
        service,
        twoOrgActor,
        [eskomOrgId, phewbOrgId],
        { id: leakDashboard.id, slug: LEAK_SLUG },
      );
    }, 60_000);

    it("F3.1d review (HIGH) — a location_admin cannot re-home an organization-wide dashboard onto its own site", async () => {
      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const audit = new MasterDataAuditService(createDb(tenantPool), fleetDb);
      const service = new DashboardsService(createDb(tenantPool), fleetDb, accessControl, audit);
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

      // Organization-wide (both scope columns NULL), in ESKOM — the location_admin's OWN
      // organization, which is the sharp case: read is organization-wide by design, so this
      // admin can already see the row through list()/getBySlug() before ever PATCHing it.
      const orgWideDashboard = await service.create(globalAdmin, {
        organizationId: eskomOrgId,
        slug: ORG_WIDE_REHOME_SLUG,
        name: "F3.1d org-wide re-home proof",
      } as Parameters<DashboardsService["create"]>[1]);
      dashboardIds.push(orgWideDashboard.id);

      const eskomLocationAdmin = jwtFor(SEEDED.locationAdmin, "location_admin");
      await assertLocationAdminCannotRehomeOrganizationWideDashboard(
        service,
        eskomLocationAdmin,
        orgWideDashboard.id,
        eskomLocationAdminLocationId,
      );
    }, 60_000);

    it("F3.1d review (HIGH) — the same location_admin may still PATCH a dashboard already scoped to its own location", async () => {
      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const audit = new MasterDataAuditService(createDb(tenantPool), fleetDb);
      const service = new DashboardsService(createDb(tenantPool), fleetDb, accessControl, audit);
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

      const ownLocationDashboard = await service.create(globalAdmin, {
        organizationId: eskomOrgId,
        slug: OWN_LOCATION_SLUG,
        name: "F3.1d own-location proof",
        locationId: eskomLocationAdminLocationId,
      } as Parameters<DashboardsService["create"]>[1]);
      dashboardIds.push(ownLocationDashboard.id);

      const eskomLocationAdmin = jwtFor(SEEDED.locationAdmin, "location_admin");
      await assertLocationAdminMayStillUpdateItsOwnLocationDashboard(
        service,
        eskomLocationAdmin,
        ownLocationDashboard.id,
        "F3.1d own-location proof (renamed)",
      );
    }, 60_000);
  },
);
