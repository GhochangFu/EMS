import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  aCreateUnderAParentTakesTheParentsOrganization,
  aFleetRowLivesInTheBoundOrganization,
  aGrantLivesInItsTargetsOrganizationAndNeedsTheUsersHomeInScope,
  aGrantTargetUsesTheGrantsServicesChecks,
  aUserCreateRunsTheRoutesManagerChecks,
  aUserTargetUsesTheUsersServicesChecks,
  aLocationCreateRefusesALocationAdmin,
  aLocationMoveNeedsAnOrganizationLevelAdmin,
  aLocationResolvesWithItsSiteCheck,
  anAssetMoveNeedsTheNewSiteToo,
  anAssetRowIsCheckedOnItsAsset,
  aSiteLayoutNeedsTheDashboardCheckToo,
  aSiteRowIsCheckedOnItsOwnSite,
  aSiteViewKeepsTheBuiltinRule,
  refKindOfReadsTheKindField,
  RESOLVER_NAMES,
  type ResolverCtx,
  theNewRefKindsBelongToTheOrganization,
} from "./copilot-target-resolver.integration.spec";

const connectionString = requireIntegrationDb({
  item: "F3.86",
  label: "the copilot target resolver's release-2 kinds",
  because:
    "a proposal must name only a row of an organization the turn may change, and run the route's own check on " +
    "that row (ADR 0099 decision 10); only a real database shows the tenant policy confining each read.",
  connection: "owner",
});

const superuserConnectionString = requireIntegrationDb({
  item: "F3.86",
  label: "the resolver fixture rows",
  because: "Only the superuser inserts and deletes the fixture rows under FORCE. Setup and teardown alone use it.",
  connection: "superuser",
});

const FAMILY = `F386-RESOLVER-${Date.now()}`;
const FAMILY_PATTERN = "F386-RESOLVER-%";
/** Child tables first; each keyed by `organization_id` except the two joined through their parent. */
const CLEANUP = [
  "DELETE FROM bms.asset_group_members WHERE asset_group_id IN (SELECT id FROM bms.asset_groups WHERE organization_id = ANY($1))",
  "DELETE FROM bms.site_control_room_views WHERE organization_id = ANY($1)",
  "DELETE FROM bms.asset_points WHERE organization_id = ANY($1)",
  "DELETE FROM bms.asset_groups WHERE organization_id = ANY($1)",
  "DELETE FROM bms.assets WHERE organization_id = ANY($1)",
  "DELETE FROM bms.rtus WHERE organization_id = ANY($1)",
  "DELETE FROM bms.dashboards WHERE organization_id = ANY($1)",
  "DELETE FROM bms.dashboard_templates WHERE organization_id = ANY($1)",
  "DELETE FROM bms.locations WHERE organization_id = ANY($1)",
  "DELETE FROM bms.organizations WHERE id = ANY($1)",
];

describe("F3.86 PR 2 — refKindOf (plan §4.2)", () => {
  it("reads a fixed kind, a mapped kind, and refuses an unmapped value", () => refKindOfReadsTheKindField());
});

describe.skipIf(!connectionString)("F3.86 PR 2 — the copilot target resolver's release-2 kinds (ADR 0099 decision 10)", () => {
  let tenantPool: pg.Pool;
  let superPool: pg.Pool;
  let ctx: ResolverCtx;
  const orgIds: string[] = [];

  beforeAll(async () => {
    const url = connectionString as string;
    tenantPool = await openIntegrationPool(
      process.env.DATABASE_URL_TENANT ?? asRole(url, "bms_tenant", "bms_tenant_dev"),
      "F3.86",
    );
    superPool = await openIntegrationPool(superuserConnectionString as string, "F3.86");
    // A run killed before afterAll leaves its organizations behind.
    const { rows: stale } = await superPool.query<{ id: string }>(
      "SELECT id FROM bms.organizations WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'",
      [FAMILY_PATTERN],
    );
    for (const statement of CLEANUP) await superPool.query(statement, [stale.map((row) => row.id)]);

    const one = async (text: string, values: unknown[]): Promise<string> => {
      const { rows } = await superPool.query<{ id: string }>(text, values);
      const id = rows[0]?.id;
      if (!id) throw new Error(`F3.86: fixture row was not created: ${text.slice(0, 60)}`);
      return id;
    };
    const organization = async (suffix: string, name: string) => {
      const id = await one("INSERT INTO bms.organizations (code, name, currency) VALUES ($1, $2, 'INR') RETURNING id", [
        `${FAMILY}-${suffix}`,
        name,
      ]);
      orgIds.push(id);
      return id;
    };
    const location = (org: string, suffix: string, name: string) =>
      one(
        "INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude) VALUES ($1, $2, $2, $3, 'pump_station', 0, 0) RETURNING id",
        [org, `${FAMILY}-l${suffix}`.toLowerCase(), name],
      );

    const orgA = await organization("A", RESOLVER_NAMES.orgA);
    const orgB = await organization("B", "F3.86 resolver B");
    const locationA = await location(orgA, "a", RESOLVER_NAMES.locationA);
    const locationA2 = await location(orgA, "a2", "F3.86 site A2");
    const locationB = await location(orgB, "b", "F3.86 site B");
    const rtuA = await one(
      "INSERT INTO bms.rtus (organization_id, location_id, code, display_name, source_type) VALUES ($1, $2, $3, $4, 'simulator') RETURNING id",
      [orgA, locationA, `${FAMILY}-RTU`, RESOLVER_NAMES.rtuA],
    );
    const assetA = await one(
      "INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, domain) VALUES ($1, $2, $3, $4, $5, 'electrical') RETURNING id",
      [orgA, `${FAMILY}-ASSET`, RESOLVER_NAMES.assetA, RESOLVER_NAMES.locationA, locationA],
    );
    const groupA = await one(
      "INSERT INTO bms.asset_groups (organization_id, location_id, code, name) VALUES ($1, $2, $3, $4) RETURNING id",
      [orgA, locationA, `${FAMILY}-GROUP`.toLowerCase(), RESOLVER_NAMES.groupA],
    );
    const memberA = await one("INSERT INTO bms.asset_group_members (asset_group_id, asset_id) VALUES ($1, $2) RETURNING id", [
      groupA,
      assetA,
    ]);
    const { rows: keys } = await superPool.query<{ id: string; code: string }>(
      "SELECT id, code FROM bms.point_keys WHERE active ORDER BY created_at, id LIMIT 1",
    );
    const key = keys[0];
    if (!key) throw new Error("F3.86: the point-key catalog is empty; run the migrations");
    const assetPointA = await one(
      "INSERT INTO bms.asset_points (organization_id, asset_id, point_key, source_data_key) VALUES ($1, $2, $3, $4) RETURNING id",
      [orgA, assetA, key.code, "F386_SRC"],
    );
    await superPool.query(
      "INSERT INTO bms.site_control_room_views (location_id, organization_id, kind, builtin_key) VALUES ($1, $2, 'builtin', 'smoc')",
      [locationA, orgA],
    );
    const dashboardA = await one("INSERT INTO bms.dashboards (organization_id, slug, name) VALUES ($1, $2, $3) RETURNING id", [
      orgA,
      `${FAMILY}-dash`.toLowerCase(),
      "F3.86 dashboard A",
    ]);
    const dashboardTemplateA = await one(
      "INSERT INTO bms.dashboard_templates (organization_id, code, name, section) VALUES ($1, $2, $3, 'electrical') RETURNING id",
      [orgA, "f386-resolver-t", "F3.86 template A"],
    );
    ctx = {
      tenantDb: createDb(tenantPool),
      orgA,
      orgB,
      locationA,
      locationA2,
      locationB,
      rtuA,
      assetA,
      assetCodeA: `${FAMILY}-ASSET`,
      groupA,
      memberA,
      assetPointA,
      pointKeyId: key.id,
      pointKeyCode: key.code,
      dashboardA,
      dashboardTemplateA,
    };
  });

  afterAll(async () => {
    if (superPool) for (const statement of CLEANUP) await superPool.query(statement, [orgIds]);
    await Promise.all([tenantPool?.end(), superPool?.end()]);
  });

  it("resolves a location with its site check", () => aLocationResolvesWithItsSiteCheck(ctx));
  it("asks for an organization-level admin when a location update names parentId (PR 3a)", () =>
    aLocationMoveNeedsAnOrganizationLevelAdmin(ctx));
  it("checks an RTU, a group and a member on their own site", () => aSiteRowIsCheckedOnItsOwnSite(ctx));
  it("checks an asset point on its asset, and an asset by :id", () => anAssetRowIsCheckedOnItsAsset(ctx));
  it("checks the new site too when an asset update names locationId (PR 3b)", () => anAssetMoveNeedsTheNewSiteToo(ctx));
  it("gives a create under a parent the parent's organization", () => aCreateUnderAParentTakesTheParentsOrganization(ctx));
  it("puts a fleet row in the bound organization (ruling Q1)", () => aFleetRowLivesInTheBoundOrganization(ctx));
  it("keeps the built-in view rule (ruling Q7(b))", () => aSiteViewKeepsTheBuiltinRule(ctx));
  it("needs the dashboard check for a site layout (ruling Q7(b))", () => aSiteLayoutNeedsTheDashboardCheckToo(ctx));
  it("refuses a location create by a location admin", () => aLocationCreateRefusesALocationAdmin(ctx));
  it("keeps the new ref kinds inside the organization", () => theNewRefKindsBelongToTheOrganization(ctx));
  it("resolves a user target through the users service (PR 4)", () => aUserTargetUsesTheUsersServicesChecks(ctx));
  it("resolves a grant through the grants service (PR 4)", () => aGrantTargetUsesTheGrantsServicesChecks(ctx));
  it("runs the route's manager checks for a user create (PR 4)", () => aUserCreateRunsTheRoutesManagerChecks(ctx));
  it("puts a grant in its target's organization and needs the user's home in scope", () =>
    aGrantLivesInItsTargetsOrganizationAndNeedsTheUsersHomeInScope(ctx));
});
