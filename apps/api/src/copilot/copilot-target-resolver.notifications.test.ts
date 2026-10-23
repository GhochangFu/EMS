import { describe, it } from "vitest";

import {
  aCreateWithoutAnOrganizationIsRefused,
  aLocationAdminIsRefused,
  anAdminResolves,
  anAssetGroupAdminIsRefused,
  anOrganizationAdminInsideResolves,
  anOrganizationAdminOutsideTheOrganizationIsRefused,
  theGateAsksTheRoutesTwoChecks,
  theProfileTargetCarriesItsStamp,
  theRuleChannelSetReusesTheRuleTarget,
} from "./copilot-target-resolver.notifications.spec";

/** `F4.279` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.279 — the notification targets mirror the routes' gate (ADR 0099 Amendment 8 D2)", () => {
  it("refuses a location_admin", async () => {
    await aLocationAdminIsRefused();
  });

  it("refuses an asset_group_admin", async () => {
    await anAssetGroupAdminIsRefused();
  });

  it("refuses an organization_admin outside the organization", async () => {
    await anOrganizationAdminOutsideTheOrganizationIsRefused();
  });

  it("resolves an organization_admin inside the organization", async () => {
    await anOrganizationAdminInsideResolves();
  });

  it("resolves a global admin", async () => {
    await anAdminResolves();
  });

  it("asks the route's two checks, on the row's organization", async () => {
    await theGateAsksTheRoutesTwoChecks();
  });

  it("carries the profile's updatedAt", async () => {
    await theProfileTargetCarriesItsStamp();
  });

  it("resolves rule.notifications.set through the rule target", async () => {
    await theRuleChannelSetReusesTheRuleTarget();
  });

  it("refuses a create without an organizationId", async () => {
    await aCreateWithoutAnOrganizationIsRefused();
  });
});
