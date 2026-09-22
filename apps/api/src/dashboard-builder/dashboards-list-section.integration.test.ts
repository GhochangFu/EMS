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
import { resolveSeededAssetByCode } from "../testing/integration-fixtures";
import { asRole } from "../testing/role-urls";
import type { SectionListFixtures } from "./dashboards-list-section.integration.spec";
import {
  assertAssetIdAndSectionCompose,
  assertFleetBranchExcludesAMisStampedRowFromItsOwnOrganization,
  assertFleetBranchExcludesAMisStampedRowFromTheTemplateOwner,
  assertFleetBranchStillReturnsACorrectlyStampedDashboard,
  assertSectionFilterExcludesOtherSectionsAndHandBuiltRows,
  assertSectionFilterReturnsTheStampedDashboard,
  assertUnfilteredListStillContainsAHandBuiltDashboard,
  assertUnknownSectionAnswersEmpty,
} from "./dashboards-list-section.integration.spec";
import { DashboardsService } from "./dashboards.service";

/**
 * `E4.2` U9 — Vitest entry point. Owns the fixtures and cleanup; the assertions
 * live in the sibling `.spec` (ADR 0014).
 *
 * The actor is `wc-admin@bms.local`, a `location_admin` **of ESKOM** — a
 * single-organization caller, so `withOrganizationReadScope` takes the TENANT
 * branch and the new join actually runs as `bms_tenant` under FORCE RLS. A
 * global admin would take the fleet branch, where `bms_fleet` holds `BYPASSRLS`
 * and a missing grant on `bms.dashboard_templates` would never show. Reading a
 * dashboard list is organization-wide for every role (`list()`'s own docblock),
 * so this actor sees all four fixtures.
 *
 * **Cleanup is by id, and only the ids this suite created** — `F3.37`'s review
 * found an `afterAll` that erased every organization's real history on a
 * developer database.
 */
const connectionString = requireIntegrationDb({
  item: "E4.2",
  label: "GET /dashboards?section= — the join onto bms.dashboard_templates",
  because:
    "whether `bms_tenant` may SELECT `bms.dashboard_templates` under FORCE RLS, and whether a " +
    "hand-built dashboard (template_id IS NULL) survives the join, are facts about real grants " +
    "and real rows. A fake db returns whatever it is told to.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);
const SUSTAINABILITY_TEMPLATE_CODE = `e42-sec-sust-${RUN}`;
const ELECTRICAL_TEMPLATE_CODE = `e42-sec-elec-${RUN}`;
const SUSTAINABILITY_SLUG = `e42-sec-sust-dash-${RUN}`;
const ELECTRICAL_SLUG = `e42-sec-elec-dash-${RUN}`;
const HAND_BUILT_SLUG = `e42-sec-hand-${RUN}`;
const ASSET_SCOPED_SLUG = `e42-sec-asset-${RUN}`;
// `E4.2` PR 2 security review — the fleet-branch fixture: a template owned by
// the OTHER seeded organization, and an ESKOM dashboard mis-stamped with it.
const OTHER_ORG_TEMPLATE_CODE = `e42-sec-other-${RUN}`;
const MIS_STAMPED_SLUG = `e42-sec-misstamped-${RUN}`;

const EMPTY_CONTENT = JSON.stringify({ widgets: [] });

/**
 * A seeded ESKOM asset, **named rather than resolved by position**, and one no
 * other suite claims — `tests/integration-fixture-sharing.test.ts` refuses a
 * shared code: a seeded asset has no owner, so two suites that name it have no
 * protocol about who writes to it or when. `CR-HVAC-1` was the first choice and
 * is already held by `access-control.asset-dashboard.integration.spec.ts`.
 *
 * This suite only READS the id — it scopes one dashboard to the asset and never
 * writes a point or a sample — but the rule is about the claim, not the verb.
 */
const FIXTURE_ASSET_CODE = "CR-ENV-VIDEOWALL";

describe.skipIf(!connectionString)("E4.2 — GET /dashboards?section=", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let authPool: pg.Pool;
  // Held, not discarded. `createDb(await openIntegrationPool(...))` kept no
  // reference to the pool it opened, so `afterAll` ended three of the four and
  // the fourth stayed open for the life of the worker.
  let fleetPool: pg.Pool;
  let fleetDb: BmsDb;
  let service: DashboardsService;

  const templateIds: string[] = [];
  const dashboardIds: string[] = [];
  let fixtures: SectionListFixtures;

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(
      resolveIntegrationRoleUrl(url, "superuser", process.env),
      "E4.2",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "E4.2",
    );
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "E4.2",
    );
    fleetPool = await openIntegrationPool(url, "E4.2");
    fleetDb = createDb(fleetPool);

    const tenantDb = createDb(tenantPool);
    const accessControl = new AccessControlService(createDb(authPool), fleetDb);
    service = new DashboardsService(
      tenantDb,
      fleetDb,
      accessControl,
      new MasterDataAuditService(tenantDb, fleetDb),
    );

    const orgs = await ownerPool.query<{ id: string }>(
      `SELECT id FROM bms.organizations WHERE code = 'ESKOM'`,
    );
    const eskomOrgId = orgs.rows[0]?.id;
    if (!eskomOrgId) {
      throw new Error("E4.2: the ESKOM organization is not there — run pnpm db:seed");
    }

    // The second seeded organization, named by CODE like everything else here.
    // The fleet-branch cases need two real organizations: a mis-stamped
    // `template_id` is only mis-stamped relative to another owner.
    const others = await ownerPool.query<{ id: string }>(
      `SELECT id FROM bms.organizations WHERE code = 'PHEWB'`,
    );
    const otherOrgId = others.rows[0]?.id;
    if (!otherOrgId) {
      throw new Error("E4.2: the PHEWB organization is not there — run pnpm db:seed");
    }

    // **Named, never positional.** `tests/integration-fixture-isolation.test.ts`
    // refuses a positional read of `bms.assets`: it returns whatever currently
    // sorts first, which is another suite's committed fixture as often as it is
    // the seed, and `ORDER BY` only narrows that. See `FIXTURE_ASSET_CODE` for why it is that
    // code and not another.
    const assetId = await resolveSeededAssetByCode(ownerPool, FIXTURE_ASSET_CODE);

    const template = async (
      code: string,
      section: string,
      organizationId: string = eskomOrgId,
    ): Promise<string> => {
      const row = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.dashboard_templates
           (organization_id, code, version, name, section, status, content, published_at)
         VALUES ($1, $2, 1, $3, $4, 'published', $5, now()) RETURNING id`,
        [organizationId, code, `E4.2 ${section} fixture`, section, EMPTY_CONTENT],
      );
      const id = row.rows[0]?.id ?? "";
      templateIds.push(id);
      return id;
    };

    const sustainabilityTemplateId = await template(
      SUSTAINABILITY_TEMPLATE_CODE,
      "sustainability",
    );
    const electricalTemplateId = await template(ELECTRICAL_TEMPLATE_CODE, "electrical");

    const dashboard = async (
      slug: string,
      templateId: string | null,
      scopedAssetId: string | null,
    ): Promise<string> => {
      const row = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.dashboards (organization_id, slug, name, template_id, asset_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [eskomOrgId, slug, `E4.2 ${slug}`, templateId, scopedAssetId],
      );
      const id = row.rows[0]?.id ?? "";
      dashboardIds.push(id);
      return id;
    };

    // The mis-stamped row: an ESKOM dashboard whose `template_id` names PHEWB's
    // sustainability template. Written with the superuser pool because that is
    // the only role that can put a row into this shape at all — which is also
    // why the READ side needs its own container rather than trusting the write
    // side never to produce one.
    const otherOrgSustainabilityTemplateId = await template(
      OTHER_ORG_TEMPLATE_CODE,
      "sustainability",
      otherOrgId,
    );

    fixtures = {
      sustainabilityDashboardId: await dashboard(
        SUSTAINABILITY_SLUG,
        sustainabilityTemplateId,
        null,
      ),
      electricalDashboardId: await dashboard(ELECTRICAL_SLUG, electricalTemplateId, null),
      handBuiltDashboardId: await dashboard(HAND_BUILT_SLUG, null, null),
      assetScopedSustainabilityDashboardId: await dashboard(
        ASSET_SCOPED_SLUG,
        sustainabilityTemplateId,
        assetId,
      ),
      assetId,
      misStampedDashboardId: await dashboard(
        MIS_STAMPED_SLUG,
        otherOrgSustainabilityTemplateId,
        null,
      ),
      templateOwnerOrganizationId: otherOrgId,
      dashboardOrganizationId: eskomOrgId,
    };
  }, 60_000);

  afterAll(async () => {
    if (dashboardIds.length > 0) {
      await ownerPool.query(`DELETE FROM bms.dashboards WHERE id = ANY($1::uuid[])`, [
        dashboardIds,
      ]);
    }
    if (templateIds.length > 0) {
      await ownerPool.query(`DELETE FROM bms.dashboard_templates WHERE id = ANY($1::uuid[])`, [
        templateIds,
      ]);
    }
    await Promise.all(
      [ownerPool, tenantPool, authPool, fleetPool].filter(Boolean).map((p) => p.end()),
    );
  }, 60_000);

  const actor = () => jwtFor(SEEDED.locationAdmin, "location_admin");

  it("the unfiltered list still contains a hand-built dashboard (the LEFT-join control)", async () => {
    await assertUnfilteredListStillContainsAHandBuiltDashboard(service, actor(), fixtures);
  }, 60_000);

  it("section=sustainability returns the sustainability-stamped dashboard", async () => {
    await assertSectionFilterReturnsTheStampedDashboard(service, actor(), fixtures);
  }, 60_000);

  it("section=sustainability excludes another section and the hand-built row", async () => {
    await assertSectionFilterExcludesOtherSectionsAndHandBuiltRows(service, actor(), fixtures);
  }, 60_000);

  it("an unknown section answers []", async () => {
    await assertUnknownSectionAnswersEmpty(service, actor());
  }, 60_000);

  it("assetId and section compose", async () => {
    await assertAssetIdAndSectionCompose(service, actor(), fixtures);
  }, 60_000);

  /**
   * The FLEET branch — `E4.2` PR 2 security review.
   *
   * `admin@bms.local` is a global admin, so `readableOrganizationIds` answers
   * `null` and `withOrganizationReadScope` runs the query as `bms_fleet` with
   * no `organizationIdFilter`. That is the branch where the join's own
   * organization predicate is the only container, and no case reached it.
   */
  const fleetActor = () => jwtFor(SEEDED.globalAdmin, "admin");

  it("the fleet branch still returns a correctly stamped dashboard (the positive control)", async () => {
    await assertFleetBranchStillReturnsACorrectlyStampedDashboard(service, fleetActor(), fixtures);
  }, 60_000);

  it("a mis-stamped template_id does not admit the row under its own organization's section", async () => {
    await assertFleetBranchExcludesAMisStampedRowFromItsOwnOrganization(
      service,
      fleetActor(),
      fixtures,
    );
  }, 60_000);

  it("…nor under the template owner's organization", async () => {
    await assertFleetBranchExcludesAMisStampedRowFromTheTemplateOwner(
      service,
      fleetActor(),
      fixtures,
    );
  }, 60_000);
});
