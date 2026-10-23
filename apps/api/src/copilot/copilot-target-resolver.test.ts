import { describe, it } from "vitest";

import {
  aRecordModeReadResolvesTheRow,
  aRoleTheConfigurationClassRefusesIsRefused,
  aRuleCreateNeedsAnAssetIdAndResolvesTheAssetsOrganization,
  aRuleTargetCarriesItsLifecycle,
  aRuleUpdateThatClearsTheAssetIsRefusedForAScopedCaller,
  aRuleUpdateThatClearsTheAssetResolvesForAGlobalAdmin,
  aRuleUpdateToAnAssetInTheReadScopeResolves,
  aRuleUpdateToAnAssetOutsideTheReadScopeIsRefused,
  aRuleWhoseAssetIsOutsideTheReadScopeIsRefused,
  everyCopilotRoleInTheConfigurationClassResolvesARule,
  aLocationAdminIsRefusedEveryMimicTarget,
  anAdminOutsideTheOrganizationIsRefused,
  anOnboardingSessionTargetIsRefusedBeforeAnyRead,
  anOrganizationAdminResolvesEveryMimicTarget,
  noProposeToolProposesTheOnboardingCommit,
} from "./copilot-target-resolver.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.86 PR 6 — the resolver's onboardingSession target (ADR 0099 decision 7)", () => {
  it("refuses the onboarding commit before any read or check", () => anOnboardingSessionTargetIsRefusedBeforeAnyRead());
  it("offers no propose tool for the onboarding commit", () => noProposeToolProposesTheOnboardingCommit());
});

describe("F3.87 PR 2 — the mimic targets (ADR 0099 Amendment 3 A1)", () => {
  it("resolves every mimic target for an organization admin who manages the organization", () =>
    anOrganizationAdminResolvesEveryMimicTarget());
  it("refuses a location admin on every mimic target", () => aLocationAdminIsRefusedEveryMimicTarget());
  it("refuses an admin outside the organization on every mimic target", () => anAdminOutsideTheOrganizationIsRefused());
});

describe("F4.278 — the rule target (ADR 0099 Amendment 8 D2)", () => {
  it("resolves a rule for every copilot role with the asset in its read scope", () =>
    everyCopilotRoleInTheConfigurationClassResolvesARule());
  it("refuses a role the configuration class refuses", () => aRoleTheConfigurationClassRefusesIsRefused());
  it("refuses a rule whose asset is outside the read scope", () => aRuleWhoseAssetIsOutsideTheReadScopeIsRefused());
  it("resolves a create by its asset's organization and refuses one without an asset", () =>
    aRuleCreateNeedsAnAssetIdAndResolvesTheAssetsOrganization());
  it("carries the rule's lifecycle", () => aRuleTargetCarriesItsLifecycle());
  it("resolves a record-mode read with the same gates", () => aRecordModeReadResolvesTheRow());
  it("refuses an update whose body names an asset outside the read scope", () =>
    aRuleUpdateToAnAssetOutsideTheReadScopeIsRefused());
  it("resolves an update whose body names an asset in the read scope", () =>
    aRuleUpdateToAnAssetInTheReadScopeResolves());
  it("refuses an update that clears the asset for a scoped caller", () =>
    aRuleUpdateThatClearsTheAssetIsRefusedForAScopedCaller());
  it("resolves an update that clears the asset for a global admin", () =>
    aRuleUpdateThatClearsTheAssetResolvesForAGlobalAdmin());
});
