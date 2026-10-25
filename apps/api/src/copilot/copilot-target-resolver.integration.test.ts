import { randomUUID } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, it } from "vitest";

import { createDb } from "@bms/db";

import { openIntegrationPool, requireIntegrationDb } from "../testing/integration-db-gate";
import { asRole } from "../testing/role-urls";
import {
  aCreateUnderAParentTakesTheParentsOrganization,
  aDashboardTargetCarriesItsUpdatedAt,
  anAssetTemplateTargetCarriesItsUpdatedAt,
  RESOLVER_STAMPS,
  aDashboardSlugIsFoundInTheAllowedSetOnly,
  anOpenGrantAddDrawerIsItsUsersRecord,
  anOpenGrantAddDrawerNeverAsksTheGrantCheck,
  anOpenInstantiateWizardAsksTheOrganizationCheckOnly,
  anOpenInstantiateWizardIsItsTemplatesRecord,
  anOpenInstantiateWizardOfAnUnmanagedOrganizationIsNotOpen,
  aFleetRowLivesInTheBoundOrganization,
  aLocationTypeCountsItsLocationsInTheAllowedOrganizations,
  aRuleOfAnotherOrganizationIsNotFound,
  aMaintenanceScheduleOfAnotherOrganizationIsNotFound,
  aFleetWideChannelIsNotFound,
  aReportScheduleResolvesWithItsStampedLocations,
  aRuleUpdateRefusesAnAssetOfAnotherOrganization,
  anUnknownVocabularyCodeIsRefusedBeforeTheGate,
  aUnitRoleResolvesItsLabel,
  aVocabularyRowNeedsABoundConversation,
  aVocabularyRowNeedsTheGlobalAdmin,
  aGrantLivesInItsTargetsOrganizationAndNeedsTheUsersHomeInScope,
  aGrantTargetUsesTheGrantsServicesChecks,
  aUserCreateRunsTheRoutesManagerChecks,
  aUserTargetUsesTheUsersServicesChecks,
  aLocationCreateRefusesALocationAdmin,
  aLocationMoveNeedsAnOrganizationLevelAdmin,
  aLocationResolvesWithItsSiteCheck,
  aMimicLayoutResolvesForAnOrgAdminInItsOrganizationOnly,
  anAssetMoveNeedsTheNewSiteToo,
  anAssetRowIsCheckedOnItsAsset,
  aSiteLayoutNeedsTheDashboardCheckToo,
  aSiteRowIsCheckedOnItsOwnSite,
  aSiteViewKeepsTheBuiltinRule,
  anInstantiateTargetAdmitsALocationAdminOnItsSite,
  anInstantiateTargetNeedsTheOrganization,
  anInstantiateTargetNeedsTheSite,
  anInstantiateTargetOfAnotherOrganizationIsRefused,
  anInstantiateUnderAnRtuChecksTheRtusSite,
  anInstantiateUnderAnRtuOfAnotherOrganizationIsRefused,
  anInstantiateWithNoTargetIsRefused,
  theAuthoringKindAsksOnlyTheAuthoringCheck,
  aTemplateTargetCarriesItsStatus,
  theDeployKindNeverAsksTheAuthoringCheck,
  refKindOfReadsTheKindField,
  RESOLVER_NAMES,
  type ResolverCtx,
  theNewRefKindsBelongToTheOrganization,
  anAssigneeIsReadUnderTheTenantAndNamed,
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
/**
 * `F4.282`: the vocabulary rows, one code per run (the tables are fleet-wide). A
 * randomUUID suffix, so a concurrent instance of this file never shares a row.
 */
const LOCATION_TYPE_CODE = `f4282_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const ASSET_ROLE_CODE = `f4282-role-${randomUUID().replace(/-/g, "").slice(0, 10)}`;
/** `F4.279`: the two channel codes, per run for the same reason. */
const CHANNEL_RUN = randomUUID().replace(/-/g, "").slice(0, 10);
/** Child tables first; each keyed by `organization_id` except the two joined through their parent. */
const CLEANUP = [
  "DELETE FROM bms.asset_group_members WHERE asset_group_id IN (SELECT id FROM bms.asset_groups WHERE organization_id = ANY($1))",
  "DELETE FROM bms.site_control_room_views WHERE organization_id = ANY($1)",
  "DELETE FROM bms.asset_points WHERE organization_id = ANY($1)",
  "DELETE FROM bms.automation_rules WHERE organization_id = ANY($1)",
  "DELETE FROM bms.report_schedules WHERE organization_id = ANY($1)",
  // `F4.281`: the schedule before its template, both before the asset.
  "DELETE FROM bms.maintenance_schedules WHERE organization_id = ANY($1)",
  "DELETE FROM bms.maintenance_task_templates WHERE organization_id = ANY($1)",
  "DELETE FROM bms.notification_channels WHERE organization_id = ANY($1)",
  "DELETE FROM bms.asset_groups WHERE organization_id = ANY($1)",
  "DELETE FROM bms.assets WHERE organization_id = ANY($1)",
  "DELETE FROM bms.rtus WHERE organization_id = ANY($1)",
  "DELETE FROM bms.dashboards WHERE organization_id = ANY($1)",
  "DELETE FROM bms.dashboard_templates WHERE organization_id = ANY($1)",
  "DELETE FROM bms.template_points WHERE organization_id = ANY($1)",
  "DELETE FROM bms.asset_templates WHERE organization_id = ANY($1)",
  "DELETE FROM bms.mimic_layouts WHERE organization_id = ANY($1)",
  "DELETE FROM bms.locations WHERE organization_id = ANY($1)",
  // `F4.284`: the assignee fixtures (`bms.users`, FORCE RLS), before their organizations.
  "DELETE FROM bms.users WHERE organization_id = ANY($1)",
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
    // `F4.282`: a killed run's vocabulary rows, once no location uses them. Bounded by
    // age, the organizations' rule: a live instance's rows are younger than 30 minutes.
    await superPool.query(
      "DELETE FROM bms.location_types t WHERE t.code LIKE 'f4282%' AND t.created_at < now() - interval '30 minutes' " +
        "AND NOT EXISTS (SELECT 1 FROM bms.locations l WHERE l.type = t.code)",
    );
    await superPool.query("DELETE FROM bms.asset_roles WHERE code LIKE $1 AND created_at < now() - interval '30 minutes'", [
      "f4282-role-%",
    ]);
    // `F4.279`: a killed run's fleet-wide channel, bounded by age the same way.
    await superPool.query(
      "DELETE FROM bms.notification_channels WHERE organization_id IS NULL AND code LIKE 'f4279-resolver-%' " +
        "AND created_at < now() - interval '30 minutes'",
    );

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
    // `F4.284` (DC1): an assignee of each organization.
    const user = (organizationId: string, suffix: string, name: string) =>
      one("INSERT INTO bms.users (organization_id, email, display_name, role) VALUES ($1, $2, $3, 'operator') RETURNING id", [
        organizationId,
        `${FAMILY.toLowerCase()}-${suffix}@example.test`,
        name,
      ]);
    const userA = await user(orgA, "assignee-a", RESOLVER_NAMES.userA);
    const userB = await user(orgB, "assignee-b", "F4.284 assignee B");
    const locationA = await location(orgA, "a", RESOLVER_NAMES.locationA);
    const locationA2 = await location(orgA, "a2", "F3.86 site A2");
    const locationB = await location(orgB, "b", "F3.86 site B");
    // `F4.282`: a location type used by two locations of A and one of B, and a unit role.
    await superPool.query("INSERT INTO bms.location_types (code, label) VALUES ($1, 'F4.282 type')", [LOCATION_TYPE_CODE]);
    await superPool.query("INSERT INTO bms.asset_roles (code, label) VALUES ($1, 'F4.282 role')", [ASSET_ROLE_CODE]);
    for (const [org, suffix] of [[orgA, "t1"], [orgA, "t2"], [orgB, "t3"]] as const) {
      await superPool.query(
        "INSERT INTO bms.locations (organization_id, code, slug, name, type, latitude, longitude) VALUES ($1, $2, $2, $3, $4, 0, 0)",
        [org, `${FAMILY}-l${suffix}`.toLowerCase(), `F4.282 site ${suffix}`, LOCATION_TYPE_CODE],
      );
    }
    const rtuA = await one(
      "INSERT INTO bms.rtus (organization_id, location_id, code, display_name, source_type) VALUES ($1, $2, $3, $4, 'simulator') RETURNING id",
      [orgA, locationA, `${FAMILY}-RTU`, RESOLVER_NAMES.rtuA],
    );
    const rtuB = await one(
      "INSERT INTO bms.rtus (organization_id, location_id, code, display_name, source_type) VALUES ($1, $2, $3, $4, 'simulator') RETURNING id",
      [orgB, locationB, `${FAMILY}-RTU-B`, "F3.86 RTU B"],
    );
    const assetA = await one(
      "INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, domain) VALUES ($1, $2, $3, $4, $5, 'electrical') RETURNING id",
      [orgA, `${FAMILY}-ASSET`, RESOLVER_NAMES.assetA, RESOLVER_NAMES.locationA, locationA],
    );
    // `F4.278`: an asset of B, a published rule on `assetA` and a rule on that asset of B.
    const assetB = await one(
      "INSERT INTO bms.assets (organization_id, code, name, site_name, location_id, domain) VALUES ($1, $2, $3, $4, $5, 'electrical') RETURNING id",
      [orgB, `${FAMILY}-ASSET-B`, "F4.278 asset B", "F3.86 site B", locationB],
    );
    const rule = (org: string, asset: string, code: string) =>
      one(
        "INSERT INTO bms.automation_rules (organization_id, code, name, rule_type, asset_id, point_key, operator, threshold_value, condition, action, lifecycle_status) " +
          "VALUES ($1, $2, $3, 'threshold', $4, 'kw', 'gt', 1, '{\"window\":\"latest\"}', '{\"type\":\"notify\",\"target\":\"Ops\"}', 'published') RETURNING id",
        [org, code, `F4.278 rule ${code}`, asset],
      );
    const ruleA = await rule(orgA, assetA, `${FAMILY}-RA`);
    const ruleB = await rule(orgB, assetB, `${FAMILY}-RB`);
    // `F4.279`: a channel of A and a fleet-wide one (the first active channel kind).
    const channel = (org: string | null, code: string, name: string) =>
      one(
        "INSERT INTO bms.notification_channels (organization_id, code, name, kind, config, enabled) " +
          "VALUES ($1, $2, $3, (SELECT code FROM bms.notification_channel_kinds WHERE active ORDER BY code LIMIT 1), '{}'::jsonb, true) RETURNING id",
        [org, code, name],
      );
    const channelA = await channel(orgA, `f4279-resolver-a-${CHANNEL_RUN}`, "F4.279 channel A");
    const fleetChannel = await channel(null, `f4279-resolver-${CHANNEL_RUN}`, "F4.279 fleet channel");
    // `F4.280`: a report schedule of A, stamped with locationA.
    const scheduleA = await one(
      "INSERT INTO bms.report_schedules (organization_id, name, template_id, formats, cadence, run_at_local, timezone, location_ids, next_run_at) " +
        "VALUES ($1, $2, 'energy_consumption', ARRAY['pdf'], 'weekly', '07:00', 'Asia/Kolkata', ARRAY[$3]::uuid[], now() + interval '1 day') RETURNING id",
      [orgA, "F4.280 schedule A", locationA],
    );
    // `F4.281`: a maintenance template on `assetA` and its schedule.
    const maintenanceTemplateA = await one(
      "INSERT INTO bms.maintenance_task_templates (organization_id, asset_id, title) VALUES ($1, $2, $3) RETURNING id",
      [orgA, assetA, "F4.281 filter check A"],
    );
    const maintenanceScheduleA = await one(
      "INSERT INTO bms.maintenance_schedules (organization_id, template_id, interval_days, next_due_at) VALUES ($1, $2, 90, now() + interval '10 days') RETURNING id",
      [orgA, maintenanceTemplateA],
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
    const assetTemplateA = await one(
      "INSERT INTO bms.asset_templates (organization_id, code, name, asset_type, domain, status) VALUES ($1, $2, $3, 'pump', 'electrical', 'published') RETURNING id",
      [orgA, "f4254-resolver-t", RESOLVER_NAMES.assetTemplateA],
    );
    const mimicLayoutA = await one(
      "INSERT INTO bms.mimic_layouts (organization_id, name, slug, canvas_w, canvas_h) VALUES ($1, $2, $3, 120, 80) RETURNING id",
      [orgA, RESOLVER_NAMES.mimicLayoutA, "f387-resolver-layout"],
    );
    // `F4.247`: a stamp apart from `created_at`, with microseconds the resolver must cut to milliseconds.
    await superPool.query("UPDATE bms.dashboards SET updated_at = $2 WHERE id = $1", [dashboardA, RESOLVER_STAMPS.dashboardA.stored]);
    await superPool.query("UPDATE bms.asset_templates SET updated_at = $2 WHERE id = $1", [
      assetTemplateA,
      RESOLVER_STAMPS.assetTemplateA.stored,
    ]);
    ctx = {
      tenantDb: createDb(tenantPool),
      orgA,
      orgB,
      channelA,
      fleetChannel,
      scheduleA,
      maintenanceScheduleA,
      maintenanceTitleA: "F4.281 filter check A",
      locationA,
      locationA2,
      locationB,
      rtuA,
      rtuB,
      assetA,
      assetCodeA: `${FAMILY}-ASSET`,
      groupA,
      memberA,
      assetPointA,
      pointKeyId: key.id,
      pointKeyCode: key.code,
      dashboardA,
      dashboardSlugA: `${FAMILY}-dash`.toLowerCase(),
      dashboardTemplateA,
      assetTemplateA,
      mimicLayoutA,
      locationTypeCode: LOCATION_TYPE_CODE,
      locationTypeLabel: "F4.282 type",
      assetRoleCode: ASSET_ROLE_CODE,
      assetRoleLabel: "F4.282 role",
      assetB,
      ruleA,
      ruleB,
      userA,
      userB,
    };
  });

  afterAll(async () => {
    if (superPool) for (const statement of CLEANUP) await superPool.query(statement, [orgIds]);
    await superPool?.query("DELETE FROM bms.location_types WHERE code = $1", [LOCATION_TYPE_CODE]);
    await superPool?.query("DELETE FROM bms.asset_roles WHERE code = $1", [ASSET_ROLE_CODE]);
    if (ctx?.fleetChannel) await superPool?.query("DELETE FROM bms.notification_channels WHERE id = $1", [ctx.fleetChannel]);
    await Promise.all([tenantPool?.end(), superPool?.end()]);
  });

  it("resolves a location with its site check", () => aLocationResolvesWithItsSiteCheck(ctx));
  it("F4.247: a dashboard target carries its updated_at as a ms ISO instant", () => aDashboardTargetCarriesItsUpdatedAt(ctx));
  it("F4.247: an asset-template target carries its updated_at as a ms ISO instant", () =>
    anAssetTemplateTargetCarriesItsUpdatedAt(ctx));
  it("asks for an organization-level admin when a location update names parentId (PR 3a)", () =>
    aLocationMoveNeedsAnOrganizationLevelAdmin(ctx));
  it("checks an RTU, a group and a member on their own site", () => aSiteRowIsCheckedOnItsOwnSite(ctx));
  it("checks an asset point on its asset, and an asset by :id", () => anAssetRowIsCheckedOnItsAsset(ctx));
  it("checks the new site too when an asset update names locationId (PR 3b)", () => anAssetMoveNeedsTheNewSiteToo(ctx));
  it("gives a create under a parent the parent's organization", () => aCreateUnderAParentTakesTheParentsOrganization(ctx));
  it("puts a fleet row in the bound organization (ruling Q1)", () => aFleetRowLivesInTheBoundOrganization(ctx));
  it("F4.282: refuses a vocabulary row in an unbound conversation", () => aVocabularyRowNeedsABoundConversation(ctx));
  it("F4.282: counts a location type's locations in the allowed organizations", () =>
    aLocationTypeCountsItsLocationsInTheAllowedOrganizations(ctx));
  it("F4.282: refuses an unknown vocabulary code before the gate", () => anUnknownVocabularyCodeIsRefusedBeforeTheGate(ctx));
  it("F4.282: refuses a vocabulary row for a caller who is no global admin", () => aVocabularyRowNeedsTheGlobalAdmin(ctx));
  it("F4.282: resolves a unit role's label with no usage count", () => aUnitRoleResolvesItsLabel(ctx));
  it("F4.278: a rule of another organization is not found; its own rule carries its lifecycle", () =>
    aRuleOfAnotherOrganizationIsNotFound(ctx));
  it("F4.278: a rule update refuses an asset of another organization, beside its allowed twin", () =>
    aRuleUpdateRefusesAnAssetOfAnotherOrganization(ctx));
  it("F4.279: a fleet-wide channel is found under no tenant; a channel of A resolves", () => aFleetWideChannelIsNotFound(ctx));
  it("F4.280: a report schedule of A resolves with its stamped locations; under B it is not found", () =>
    aReportScheduleResolvesWithItsStampedLocations(ctx));
  it("F4.281: a maintenance schedule of A resolves by its title; under B it is not found", () =>
    aMaintenanceScheduleOfAnotherOrganizationIsNotFound(ctx));
  it("keeps the built-in view rule (ruling Q7(b))", () => aSiteViewKeepsTheBuiltinRule(ctx));
  it("needs the dashboard check for a site layout (ruling Q7(b))", () => aSiteLayoutNeedsTheDashboardCheckToo(ctx));
  it("refuses a location create by a location admin", () => aLocationCreateRefusesALocationAdmin(ctx));
  it("keeps the new ref kinds inside the organization", () => theNewRefKindsBelongToTheOrganization(ctx));
  it("F4.284: reads an assignee under the tenant, names it, and refuses another organization's", () =>
    anAssigneeIsReadUnderTheTenantAndNamed(ctx));
  it("resolves a user target through the users service (PR 4)", () => aUserTargetUsesTheUsersServicesChecks(ctx));
  it("resolves a grant through the grants service (PR 4)", () => aGrantTargetUsesTheGrantsServicesChecks(ctx));
  it("runs the route's manager checks for a user create (PR 4)", () => aUserCreateRunsTheRoutesManagerChecks(ctx));
  it("puts a grant in its target's organization and needs the user's home in scope", () =>
    aGrantLivesInItsTargetsOrganizationAndNeedsTheUsersHomeInScope(ctx));
  // `F4.254` PR 3 (plan §5.4): the instantiate route's deploy authority.
  it("admits a location admin to instantiate on its own site", () => anInstantiateTargetAdmitsALocationAdminOnItsSite(ctx));
  it("refuses an instantiate on a site the caller does not manage", () => anInstantiateTargetNeedsTheSite(ctx));
  it("checks the RTU's own site for an instantiate under an RTU", () => anInstantiateUnderAnRtuChecksTheRtusSite(ctx));
  it("refuses an instantiate outside the caller's organizations", () => anInstantiateTargetNeedsTheOrganization(ctx));
  it("never asks the authoring check for an instantiate", () => theDeployKindNeverAsksTheAuthoringCheck(ctx));
  it("asks only the authoring check for an authoring entry on the same template", () =>
    theAuthoringKindAsksOnlyTheAuthoringCheck(ctx));
  it("F4.246: gives a template target its lifecycle status", () => aTemplateTargetCarriesItsStatus(ctx));
  it("refuses an instantiate whose site is of another organization", () =>
    anInstantiateTargetOfAnotherOrganizationIsRefused(ctx));
  it("refuses an instantiate that names no target", () => anInstantiateWithNoTargetIsRefused(ctx));
  it("refuses an instantiate under an RTU of another organization without asking its site", () =>
    anInstantiateUnderAnRtuOfAnotherOrganizationIsRefused(ctx));
  it("F3.87 PR 5: resolves a mimic layout for an org admin in its organization only", () =>
    aMimicLayoutResolvesForAnOrgAdminInItsOrganizationOnly(ctx));
  it("F4.245: finds a dashboard by its slug in the allowed organizations only", () => aDashboardSlugIsFoundInTheAllowedSetOnly(ctx));
  it("F4.245 C1: resolves an open grant-add drawer as its user's record", () => anOpenGrantAddDrawerIsItsUsersRecord(ctx));
  it("F4.245 C1: never asks the grant check for an open grant-add drawer", () => anOpenGrantAddDrawerNeverAsksTheGrantCheck(ctx));
  it("F4.245 C1: resolves an open instantiate wizard as its template's record", () => anOpenInstantiateWizardIsItsTemplatesRecord(ctx));
  it("F4.245 C1: asks only the organization check for an open instantiate wizard", () =>
    anOpenInstantiateWizardAsksTheOrganizationCheckOnly(ctx));
  it("F4.245 C1: names no open instantiate wizard of an organization the caller does not manage", () =>
    anOpenInstantiateWizardOfAnUnmanagedOrganizationIsNotOpen(ctx));
});
