import { describe, it } from "vitest";

import {
  anOnboardingSessionTargetIsRefusedBeforeAnyRead,
  noProposeToolProposesTheOnboardingCommit,
} from "./copilot-target-resolver.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.86 PR 6 — the resolver's onboardingSession target (ADR 0099 decision 7)", () => {
  it("refuses the onboarding commit before any read or check", () => anOnboardingSessionTargetIsRefusedBeforeAnyRead());
  it("offers no propose tool for the onboarding commit", () => noProposeToolProposesTheOnboardingCommit());
});
