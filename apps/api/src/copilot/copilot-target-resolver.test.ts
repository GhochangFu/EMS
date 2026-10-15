import { describe, it } from "vitest";

import {
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
