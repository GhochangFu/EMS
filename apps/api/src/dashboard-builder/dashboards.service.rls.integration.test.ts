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
import { resolveSeededAssetByCode } from "../testing/integration-fixtures";
import { countingDb, countingDbMethod } from "../testing/counting-db";
import { DashboardsService } from "./dashboards.service";
import {
  assertAddingALocationToAnAssetScopedDashboardIs400,
  assertAssetScopedCreateLandsTheAssetAndNoStamp,
  assertClearingTheAssetScopeAlsoClearsTheStamp,
  assertCrossOrgAssetScopeIs400NamingAssetId,
  assertMovingTheAssetClearsTheStamp,
  assertCreateAuditRowStamped,
  assertCreateRoutesOnTenantPoolOnly,
  assertCrossOrgAssetGroupScopeIs400NamingAssetGroupId,
  assertCrossOrgLocationScopeRefusedByRls,
  assertCrossTenantSlugReadIs404,
  assertFleetBranchExcludesAForeignOrganization,
  assertForeignOrgIdUpdateIs404SameAsNonexistent,
  assertLocationAdminCannotRehomeOrganizationWideDashboard,
  assertLocationAdminMayStillUpdateItsOwnLocationDashboard,
  assertLocationReaderMayReadItsSitesDashboardBySlug,
  assertListFiltersByAssetIdWithinScope,
  assertListReportsTheAssetCode,
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
const CROSS_ORG_GROUP_CREATE_SLUG = `f334-group-scope-${RUN}`;
const CROSS_ORG_GROUP_UPDATE_SLUG = `f334-group-target-${RUN}`;
const LEAK_ORG_CODE = `F31B-LEAK-${RUN}`;
const LEAK_SLUG = `f31b-leak-${RUN}`;
const MULTI_ORG_EMAIL = `f31b-multiorg-${RUN}@integration.invalid`;
const SCOPE_CONFLICT_SLUG = `f31b-conflict-${RUN}`;
const ORG_WIDE_REHOME_SLUG = `f31d-orgwide-rehome-${RUN}`;
const OWN_LOCATION_SLUG = `f31d-own-location-${RUN}`;
const SITE_READ_SLUG = `f369-site-read-${RUN}`;
const ASSET_SCOPE_SLUG = `f32-asset-scope-${RUN}`;
const ASSET_CONFLICT_SLUG = `f32-asset-conflict-${RUN}`;
const ASSET_CODE_SLUG = `f32-asset-code-${RUN}`;
const STAMP_CLEAR_SLUG = `f32-stamp-clear-${RUN}`;
const STAMP_MOVE_SLUG = `f32-stamp-move-${RUN}`;
const XORG_ASSET_SLUG = `f32-xorg-asset-${RUN}`;
const F331_A_SLUG = `f331-a-${RUN}`;
const F331_B_SLUG = `f331-b-${RUN}`;
const F331_PHEWB_SLUG = `f331-phewb-${RUN}`;

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
    /** `F3.2` — an ESKOM asset the asset-scoped dashboards below are scoped to. */
    let eskomAssetId: string;
    /** `F3.2` review — a SECOND ESKOM asset, the destination of the "move the scope" case. */
    let otherEskomAssetId: string;
    /** `F3.2` review — an ESKOM asset-template version row, the stamp those cases write. */
    let eskomAssetTemplateId: string;
    /** `F3.2` review — an asset of the OTHER organization, for the cross-tenant create. */
    let phewbAssetId: string;
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

      // `F3.2` — an ESKOM asset, resolved BY NAME. `CR-HVAC-1` is written under that exact
      // code by `packages/db/src/eskom-assets-seed.ts`, at the Western Cape control room.
      //
      // Not `ORDER BY created_at, id LIMIT 1`: `tests/integration-fixture-isolation.test.ts`
      // refuses a positional read of `bms.assets`, and refuses it for a reason this suite is
      // exposed to — seven other integration suites commit and then delete fixture assets in
      // the same parallel run, so "the row that sorts first" is one of theirs as often as it
      // is the seed's, and it disappears mid-test when it is.
      eskomAssetId = await resolveSeededAssetByCode(ownerPool, "CR-HVAC-1");
      // The dashboards below are stamped with `eskomOrgId`, and `tenant_isolation`'s WITH
      // CHECK would refuse an asset from another organization with a bare RLS error rather
      // than a sentence naming the fixture. Checked here, id-scoped, so the failure says why.
      const assetOrg = await ownerPool.query<{ organization_id: string }>(
        `SELECT organization_id FROM bms.assets WHERE id = $1`,
        [eskomAssetId],
      );
      if (assetOrg.rows[0]?.organization_id !== eskomOrgId) {
        throw new Error(
          "F3.2: the seeded asset CR-HVAC-1 is not in ESKOM — the seed moved it; name another " +
            "seeded code rather than reading one by position",
        );
      }

      // `F3.2` review — every one of these is NAMED, for the reason above. `CR-HVAC-2` is the
      // second Western Cape control-room HVAC asset; `PHE-MFM-000000001` is written by
      // `seedPheCatalog` from the committed `phe-catalog.json`.
      otherEskomAssetId = await resolveSeededAssetByCode(ownerPool, "CR-HVAC-2");
      phewbAssetId = await resolveSeededAssetByCode(ownerPool, "PHE-MFM-000000001");
      const phewbAssetOrg = await ownerPool.query<{ organization_id: string }>(
        `SELECT organization_id FROM bms.assets WHERE id = $1`,
        [phewbAssetId],
      );
      if (phewbAssetOrg.rows[0]?.organization_id !== phewbOrgId) {
        throw new Error(
          "F3.2: the seeded asset PHE-MFM-000000001 is not in PHEWB — the cross-organization " +
            "case below would assert nothing",
        );
      }

      // The stamp fixture. Named by template code, never `ORDER BY created_at LIMIT 1` over
      // `bms.asset_templates`: other suites commit template versions into ESKOM in the same
      // parallel run and delete them again.
      const eskomTemplate = await ownerPool.query<{ id: string }>(
        `SELECT id FROM bms.asset_templates
          WHERE organization_id = $1 AND code = 'BASELINE-IT'
          ORDER BY version LIMIT 1`,
        [eskomOrgId],
      );
      eskomAssetTemplateId = eskomTemplate.rows[0]?.id ?? "";
      if (!eskomAssetTemplateId) {
        throw new Error("F3.2: ESKOM has no BASELINE-IT asset template — run pnpm db:seed");
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

    it("F3.34 — an ESKOM dashboard given a PHEWB assetGroupId is refused by RLS on create and on update, naming assetGroupId", async () => {
      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const audit = new MasterDataAuditService(createDb(tenantPool), fleetDb);
      const service = new DashboardsService(createDb(tenantPool), fleetDb, accessControl, audit);
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

      // The update leg needs a row that exists: an organization-wide ESKOM dashboard the
      // global admin then tries to move onto a PHEWB group.
      const eskomTarget = await service.create(globalAdmin, {
        organizationId: eskomOrgId,
        slug: CROSS_ORG_GROUP_UPDATE_SLUG,
        name: "F3.34 cross-org group update target",
      } as Parameters<DashboardsService["create"]>[1]);
      dashboardIds.push(eskomTarget.id);

      await assertCrossOrgAssetGroupScopeIs400NamingAssetGroupId(
        service,
        globalAdmin,
        eskomOrgId,
        phewbAssetGroupId,
        CROSS_ORG_GROUP_CREATE_SLUG,
        eskomTarget.id,
      );
      // The create leg landed nothing; the update leg left eskomTarget organization-wide.
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
        `INSERT INTO bms.organizations (code, name, currency) VALUES ($1, 'F3.1b fleet-leak proof org', 'ZAR') RETURNING id`,
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

    it("F3.69 U4 A1 — a location_admin reads its own site's dashboard by slug", async () => {
      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const audit = new MasterDataAuditService(createDb(tenantPool), fleetDb);
      const service = new DashboardsService(createDb(tenantPool), fleetDb, accessControl, audit);
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

      const siteDashboard = await service.create(globalAdmin, {
        organizationId: eskomOrgId,
        slug: SITE_READ_SLUG,
        name: "F3.69 U4 site-read proof",
        locationId: eskomLocationAdminLocationId,
      } as Parameters<DashboardsService["create"]>[1]);
      dashboardIds.push(siteDashboard.id);

      const eskomLocationAdmin = jwtFor(SEEDED.locationAdmin, "location_admin");
      await assertLocationReaderMayReadItsSitesDashboardBySlug(
        service,
        eskomLocationAdmin,
        SITE_READ_SLUG,
        eskomOrgId,
        eskomLocationAdminLocationId,
      );
    }, 60_000);

    it("F3.2 — an asset-scoped create lands asset_id and leaves asset_template_id NULL", async () => {
      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const audit = new MasterDataAuditService(createDb(tenantPool), fleetDb);
      const service = new DashboardsService(createDb(tenantPool), fleetDb, accessControl, audit);
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

      await assertAssetScopedCreateLandsTheAssetAndNoStamp(
        service,
        fleetDb,
        globalAdmin,
        eskomOrgId,
        eskomAssetId,
        ASSET_SCOPE_SLUG,
        (id) => dashboardIds.push(id),
      );
    }, 60_000);

    it("F3.2 — PATCHing a locationId onto an asset-scoped dashboard is a 400 naming assetId", async () => {
      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const audit = new MasterDataAuditService(createDb(tenantPool), fleetDb);
      const service = new DashboardsService(createDb(tenantPool), fleetDb, accessControl, audit);
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

      const assetScoped = await service.create(globalAdmin, {
        organizationId: eskomOrgId,
        slug: ASSET_CONFLICT_SLUG,
        name: "F3.2 three-way scope guard proof",
        assetId: eskomAssetId,
      } as Parameters<DashboardsService["create"]>[1]);
      dashboardIds.push(assetScoped.id);

      await assertAddingALocationToAnAssetScopedDashboardIs400(
        service,
        globalAdmin,
        assetScoped.id,
        eskomLocationAdminLocationId,
      );
    }, 60_000);

    it("F3.2 review — clearing assetId also clears the asset_template_id stamp", async () => {
      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const audit = new MasterDataAuditService(createDb(tenantPool), fleetDb);
      const service = new DashboardsService(createDb(tenantPool), fleetDb, accessControl, audit);
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

      const stamped = await service.create(globalAdmin, {
        organizationId: eskomOrgId,
        slug: STAMP_CLEAR_SLUG,
        name: "F3.2 stamp-clearing proof",
        assetId: eskomAssetId,
      } as Parameters<DashboardsService["create"]>[1]);
      dashboardIds.push(stamped.id);

      await assertClearingTheAssetScopeAlsoClearsTheStamp(
        service,
        fleetDb,
        globalAdmin,
        stamped.id,
        eskomAssetTemplateId,
        eskomLocationAdminLocationId,
      );
    }, 60_000);

    it("F3.2 review — moving the scope to another asset clears the stamp too", async () => {
      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const audit = new MasterDataAuditService(createDb(tenantPool), fleetDb);
      const service = new DashboardsService(createDb(tenantPool), fleetDb, accessControl, audit);
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

      const stamped = await service.create(globalAdmin, {
        organizationId: eskomOrgId,
        slug: STAMP_MOVE_SLUG,
        name: "F3.2 stamp-move proof",
        assetId: eskomAssetId,
      } as Parameters<DashboardsService["create"]>[1]);
      dashboardIds.push(stamped.id);

      await assertMovingTheAssetClearsTheStamp(
        service,
        fleetDb,
        globalAdmin,
        stamped.id,
        eskomAssetTemplateId,
        otherEskomAssetId,
      );
    }, 60_000);

    it("F3.2 review — an ESKOM dashboard scoped to a PHEWB asset is a 400 naming assetId", async () => {
      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const audit = new MasterDataAuditService(createDb(tenantPool), fleetDb);
      const service = new DashboardsService(createDb(tenantPool), fleetDb, accessControl, audit);
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

      await assertCrossOrgAssetScopeIs400NamingAssetId(
        service,
        fleetDb,
        globalAdmin,
        eskomOrgId,
        phewbAssetId,
        XORG_ASSET_SLUG,
      );
      // No id to push: the insert was refused, nothing landed.
    }, 60_000);

    it("F3.2 — list() reports the asset's own code for an asset-scoped row, on the tenant branch", async () => {
      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const audit = new MasterDataAuditService(createDb(tenantPool), fleetDb);
      const service = new DashboardsService(createDb(tenantPool), fleetDb, accessControl, audit);
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

      const assetScoped = await service.create(globalAdmin, {
        organizationId: eskomOrgId,
        slug: ASSET_CODE_SLUG,
        name: "F3.2 assetCode join proof",
        assetId: eskomAssetId,
      } as Parameters<DashboardsService["create"]>[1]);
      dashboardIds.push(assetScoped.id);

      // wc-admin@bms.local — a single-organization, location-scoped reader, which is what
      // routes list() onto the TENANT branch (bms_tenant under FORCE RLS) rather than the
      // fleet one (bms_fleet, BYPASSRLS).
      const eskomLocationAdmin = jwtFor(SEEDED.locationAdmin, "location_admin");
      await assertListReportsTheAssetCode(
        service,
        fleetDb,
        eskomLocationAdmin,
        assetScoped.id,
        eskomAssetId,
      );
    }, 60_000);

    it("F3.31 — list(…, assetId) narrows within scope on the tenant branch; an out-of-scope id answers []", async () => {
      const accessControl = new AccessControlService(createDb(authPool), fleetDb);
      const audit = new MasterDataAuditService(createDb(tenantPool), fleetDb);
      const service = new DashboardsService(createDb(tenantPool), fleetDb, accessControl, audit);
      const globalAdmin = jwtFor(SEEDED.globalAdmin, "admin");

      const createScoped = async (organizationId: string, slug: string, assetId: string) => {
        const created = await service.create(globalAdmin, {
          organizationId,
          slug,
          name: `F3.31 assetId filter proof ${slug}`,
          assetId,
        } as Parameters<DashboardsService["create"]>[1]);
        dashboardIds.push(created.id);
        return created.id;
      };
      const dashboardAId = await createScoped(eskomOrgId, F331_A_SLUG, eskomAssetId);
      const dashboardBId = await createScoped(eskomOrgId, F331_B_SLUG, otherEskomAssetId);
      const dashboardPId = await createScoped(phewbOrgId, F331_PHEWB_SLUG, phewbAssetId);

      // wc-admin@bms.local — single-organization, so list() takes the TENANT branch.
      const eskomLocationAdmin = jwtFor(SEEDED.locationAdmin, "location_admin");
      await assertListFiltersByAssetIdWithinScope(service, fleetDb, eskomLocationAdmin, {
        eskomAssetId,
        dashboardAId,
        dashboardBId,
        phewbAssetId,
        dashboardPId,
      });
    }, 60_000);
  },
);
