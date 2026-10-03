import { afterEach, describe, it, vi } from "vitest";

import * as spec from "./user-grants.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("F3.78 — UserGrantsService.list (ADR 0089 decision 12, plan D2)", () => {
  it("a non-manager row is 403", async () => {
    await spec.assertANonManagerIsRefusedOnGet();
  });

  it("GET for a C1 target is a 404 with the same body as a nonexistent id", async () => {
    await spec.assertGetForAC1TargetIsTheNonexistentIdBody();
  });

  it("GET for an admin target is hidden from an organization_admin", async () => {
    await spec.assertGetForAnAdminTargetIsHiddenFromAnOrganizationAdmin();
  });

  it("a stale admin token on an organization_admin row gets the organization_admin rules", async () => {
    await spec.assertAStaleAdminTokenGetsTheOrganizationAdminRules();
  });

  it("a location grant on an organization_admin is kept and not effective", async () => {
    await spec.assertALocationGrantOnAnOrganizationAdminIsNotEffective();
  });

  it("a viewer with an organization grant and a location grant has only the organization grant effective", async () => {
    await spec.assertAViewersOrganizationGrantShadowsItsLocationGrant();
  });

  it("a viewer whose only grant is a location grant reads it", async () => {
    await spec.assertAViewersOnlyLocationGrantIsEffective();
  });

  it("grant reads run on the fleet pool", async () => {
    await spec.assertGrantReadsRunOnTheFleetPool();
  });
});

describe("F3.78 — UserGrantsService.add (ADR 0089 decisions 10, 12, 14)", () => {
  it("a non-manager row is 403 and writes nothing", async () => {
    await spec.assertANonManagerIsRefusedOnAdd();
  });

  it("a bad body is 400 and writes nothing", async () => {
    await spec.assertABadBodyIs400AndWritesNothing();
  });

  it("a same-organization location grant lands under its organization's GUC", async () => {
    await spec.assertASameOrganizationLocationGrantLandsUnderItsOrganization();
  });

  it("a cross-organization location grant runs under the location's organization, not the user's", async () => {
    await spec.assertACrossOrganizationLocationGrantRunsUnderTheLocationsOrganization();
  });

  it("an asset-group grant runs under the group's organization", async () => {
    await spec.assertAnAssetGroupGrantRunsUnderTheGroupsOrganization();
  });

  it("an organization grant runs under that organization", async () => {
    await spec.assertAnOrganizationGrantRunsUnderThatOrganization();
  });

  it("an add writes one master.user_grant.add audit row on its transaction", async () => {
    await spec.assertAnAddWritesOneAuditRowOnItsTransaction();
  });

  it("organization_admin, cross-organization location target: refused, nothing written", async () => {
    await spec.assertAnOrganizationAdminCrossOrganizationLocationGrantIsRefused();
  });

  it("organization_admin, cross-organization asset_group target: refused, nothing written", async () => {
    await spec.assertAnOrganizationAdminCrossOrganizationAssetGroupGrantIsRefused();
  });

  it("organization_admin, cross-organization organization target: refused, nothing written", async () => {
    await spec.assertAnOrganizationAdminCrossOrganizationOrganizationGrantIsRefused();
  });

  it("a location outside the caller's scope is the missing-target 404", async () => {
    await spec.assertATargetOutsideTheCallersScopeIsTheMissingTargetBody();
  });

  it("a group whose location is outside the caller's scope is refused", async () => {
    await spec.assertAGroupOutsideTheCallersScopeIsRefused();
  });

  it("an organization outside the caller's scope is refused", async () => {
    await spec.assertAnOrganizationOutsideTheCallersScopeIsRefused();
  });

  it("an add on a C1 target is a 404 that does not name it", async () => {
    await spec.assertAddOnAC1TargetIsRefused();
  });

  it("an add on an admin target is refused for an organization_admin", async () => {
    await spec.assertAddOnAnAdminTargetIsRefusedForAnOrganizationAdmin();
  });

  it("a duplicate grant is 409 with no audit row", async () => {
    await spec.assertADuplicateGrantIs409WithNoAudit();
  });

  it("a row-level-security refusal (42501) is a non-naming 409 with no audit row", async () => {
    await spec.assertARowLevelSecurityRefusalIsNonNamingWithNoAudit();
  });

  it("an add works in local auth mode", async () => {
    await spec.assertAddWorksInLocalAuthMode();
  });

  it("an add works on an unlinked user", async () => {
    await spec.assertAddWorksOnAnUnlinkedUser();
  });
});

describe("F3.78 — UserGrantsService.remove (ADR 0089 decisions 10, 12, 14)", () => {
  it("a remove lands under the target's organization with one audit row", async () => {
    await spec.assertARemoveLandsUnderTheTargetsOrganizationWithOneAuditRow();
  });

  it("another user's grantId is a 404 that does not name it", async () => {
    await spec.assertAnotherUsersGrantIdIs404WithoutNamingIt();
  });

  it("an empty DELETE … RETURNING is a 404 with no audit row", async () => {
    await spec.assertAnEmptyDeleteIs404WithNoAudit();
  });

  it("an organization_admin cannot remove a cross-organization grant", async () => {
    await spec.assertAnOrganizationAdminCannotRemoveACrossOrganizationGrant();
  });

  it("an unknown kind is 400", async () => {
    await spec.assertAnUnknownKindIs400();
  });
});
