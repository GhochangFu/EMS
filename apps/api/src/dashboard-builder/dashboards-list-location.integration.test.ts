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
import type { LocationListFixtures } from "./dashboards-list-location.integration.spec";
import {
  assertLocationFilterExcludesOtherLocationsAndOrgWideRows,
  assertLocationFilterIsAndedWithTheOrganizationScope,
  assertMisStampedGroupDoesNotAdmitAnotherOrganizationsDashboard,
  assertLocationFilterReturnsSiteAndGroupScopedRows,
  assertUnfilteredListIsUnchanged,
  assertUnknownLocationAnswersEmpty,
} from "./dashboards-list-location.integration.spec";
import { DashboardsService } from "./dashboards.service";
import { primeSeededSubjects } from "../testing/seeded-subjects";

/**
 * `F3.72` U0 — Vitest entry point for `GET /dashboards?locationId=`. Owns the
 * fixtures and cleanup; the assertions live in the sibling `.spec` (ADR 0014).
 *
 * The actor is `wc-admin@bms.local`, a single-organization caller, so the read
 * takes the TENANT branch: the new subquery on `bms.asset_groups` runs as
 * `bms_tenant` under FORCE RLS. The global admin covers the FLEET branch.
 * Cleanup is by id, and only the ids this suite created.
 */
const connectionString = requireIntegrationDb({
  item: "F3.72",
  label: "GET /dashboards?locationId= — site-scoped and group-scoped rows",
  because:
    "whether `bms_tenant` may read `bms.asset_groups` inside the list query, and whether the " +
    "group-of-location predicate matches real rows, are facts about real grants and real data.",
});

const RUN = randomUUID().replace(/-/g, "").slice(0, 8);

describe.skipIf(!connectionString)("F3.72 — GET /dashboards?locationId=", () => {
  let ownerPool: pg.Pool;
  let tenantPool: pg.Pool;
  let authPool: pg.Pool;
  let fleetPool: pg.Pool;
  let fleetDb: BmsDb;
  let service: DashboardsService;
  let fixtures: LocationListFixtures;

  const dashboardIds: string[] = [];
  const groupIds: string[] = [];
  const locationIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    ownerPool = await openIntegrationPool(
      resolveIntegrationRoleUrl(url, "superuser", process.env),
      "F3.72",
    );
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.72",
    );
    authPool = await openIntegrationPool(
      process.env.DATABASE_URL_AUTH ?? asRole(url, "bms_auth", "bms_auth_dev"),
      "F3.72",
    );
    fleetPool = await openIntegrationPool(url, "F3.72");
    // F3.78: jwtFor carries the real bms.users.id as sub (ADR 0089 decision 4).
    await primeSeededSubjects(fleetPool);
    fleetDb = createDb(fleetPool);

    const tenantDb = createDb(tenantPool);
    service = new DashboardsService(
      tenantDb,
      fleetDb,
      new AccessControlService(createDb(authPool), fleetDb),
      new MasterDataAuditService(tenantDb, fleetDb),
    );

    const orgs = await ownerPool.query<{ id: string; code: string }>(
      `SELECT id, code FROM bms.organizations WHERE code IN ('ESKOM','PHEWB')`,
    );
    const eskom = orgs.rows.find((r) => r.code === "ESKOM")?.id;
    const other = orgs.rows.find((r) => r.code === "PHEWB")?.id;
    if (!eskom || !other) {
      throw new Error("F3.72: the ESKOM/PHEWB organizations are not there — run pnpm db:seed");
    }

    // Fresh locations and groups owned by this suite — no seeded row is shared or mutated.
    const location = async (tag: string): Promise<string> => {
      const code = `f372-${tag}-${RUN}`;
      const row = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude)
         VALUES ($1, $2, $2, $3, 'smoc_campus', 0, 0) RETURNING id`,
        [eskom, code, `F3.72 ${tag}`],
      );
      const id = row.rows[0]?.id ?? "";
      locationIds.push(id);
      return id;
    };
    const group = async (
      locationId: string,
      tag: string,
      groupOrganizationId: string = eskom,
    ): Promise<string> => {
      const row = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.asset_groups (organization_id, location_id, code, name)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [groupOrganizationId, locationId, `f372-g${tag}-${RUN}`, `F3.72 group ${tag}`],
      );
      const id = row.rows[0]?.id ?? "";
      groupIds.push(id);
      return id;
    };
    const dashboard = async (
      tag: string,
      scopeLocationId: string | null,
      scopeGroupId: string | null,
    ): Promise<string> => {
      const row = await ownerPool.query<{ id: string }>(
        `INSERT INTO bms.dashboards (organization_id, slug, name, location_id, asset_group_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [eskom, `f372-${tag}-${RUN}`, `F3.72 ${tag}`, scopeLocationId, scopeGroupId],
      );
      const id = row.rows[0]?.id ?? "";
      dashboardIds.push(id);
      return id;
    };

    const locationAId = await location("a");
    const locationBId = await location("b");
    const groupA = await group(locationAId, "a");
    const groupB = await group(locationBId, "b");
    // A MIS-STAMPED group: PHEWB's, hung on ESKOM's location A. Nothing in the database forbids
    // it (a plain FK on `asset_group_id`), so only the service's organization predicate stops
    // the ESKOM dashboard pointing at it from being admitted on the fleet branch.
    const groupMisStamped = await group(locationAId, "x", other);

    fixtures = {
      locationAId,
      locationBId,
      eskomOrganizationId: eskom,
      otherOrganizationId: other,
      siteScopedADashboardId: await dashboard("site-a", locationAId, null),
      groupScopedADashboardId: await dashboard("group-a", null, groupA),
      siteScopedBDashboardId: await dashboard("site-b", locationBId, null),
      groupScopedBDashboardId: await dashboard("group-b", null, groupB),
      organizationWideDashboardId: await dashboard("org-wide", null, null),
      misStampedGroupDashboardId: await dashboard("mis-stamped", null, groupMisStamped),
    };
  }, 60_000);

  afterAll(async () => {
    try {
      if (dashboardIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.dashboards WHERE id = ANY($1::uuid[])`, [
          dashboardIds,
        ]);
      }
      if (groupIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.asset_groups WHERE id = ANY($1::uuid[])`, [
          groupIds,
        ]);
      }
      if (locationIds.length > 0) {
        await ownerPool.query(`DELETE FROM bms.locations WHERE id = ANY($1::uuid[])`, [
          locationIds,
        ]);
      }
    } finally {
      await Promise.all(
        [ownerPool, tenantPool, authPool, fleetPool].filter(Boolean).map((p) => p.end()),
      );
    }
  }, 60_000);

  const tenantActor = () => jwtFor(SEEDED.locationAdmin, "location_admin");
  const fleetActor = () => jwtFor(SEEDED.globalAdmin, "admin");

  it("returns a site-scoped and a group-scoped dashboard of the location (tenant branch)", async () => {
    await assertLocationFilterReturnsSiteAndGroupScopedRows(service, tenantActor(), fixtures);
  }, 60_000);

  it("excludes another location's rows and the organization-wide row (tenant branch)", async () => {
    await assertLocationFilterExcludesOtherLocationsAndOrgWideRows(
      service,
      tenantActor(),
      fixtures,
    );
  }, 60_000);

  it("returns both kinds and excludes the others on the fleet branch", async () => {
    await assertLocationFilterReturnsSiteAndGroupScopedRows(service, fleetActor(), fixtures);
    await assertLocationFilterExcludesOtherLocationsAndOrgWideRows(
      service,
      fleetActor(),
      fixtures,
    );
  }, 60_000);

  it("does not admit a dashboard through a group of another organization (fleet branch)", async () => {
    await assertMisStampedGroupDoesNotAdmitAnotherOrganizationsDashboard(
      service,
      fleetActor(),
      fixtures,
    );
  }, 60_000);

  it("leaves the unfiltered list unchanged", async () => {
    await assertUnfilteredListIsUnchanged(service, tenantActor(), fixtures);
  }, 60_000);

  it("is ANDed with the organization scope", async () => {
    await assertLocationFilterIsAndedWithTheOrganizationScope(service, fleetActor(), fixtures);
  }, 60_000);

  it("answers [] for an unknown location", async () => {
    await assertUnknownLocationAnswersEmpty(service, tenantActor());
  }, 60_000);
});
