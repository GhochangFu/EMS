import { describe, it } from "vitest";

import {
  assertAProviderErrorFallsBackWithTheNotice,
  assertAnIncompleteOrgRowIsGuidedModeWithTheSetupNotice,
  assertCapTimeDoesNotFallBack,
  assertMergeDraftClearsAStoredProposal,
  assertNoResolvedProviderMeansNoNotice,
  assertTheResolverIsCalledOncePerTurnWithTheSessionsOrganization,
  assertTheTurnLogsOneTextFreeLineWithTheProviderName,
} from "./onboarding-chat-agent.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("OnboardingChatService — the agent branch (F3.21, ADR 0090)", () => {
  it("falls back to the guided mode with a notice on a provider error", async () => {
    await assertAProviderErrorFallsBackWithTheNotice();
  });

  it("answers in the guided mode with no notice when no provider resolves", async () => {
    await assertNoResolvedProviderMeansNoNotice();
  });

  it("tells the user when the organization's own setting is incomplete", async () => {
    await assertAnIncompleteOrgRowIsGuidedModeWithTheSetupNotice();
  });

  it("does not fall back at the time cap", async () => {
    await assertCapTimeDoesNotFallBack();
  });

  it("clears a stored proposal on every merge", () => {
    assertMergeDraftClearsAStoredProposal();
  });

  it("logs one text-free line per agent turn", async () => {
    await assertTheTurnLogsOneTextFreeLineWithTheProviderName();
  });

  it("resolves the provider once per turn for the session's organization", async () => {
    await assertTheResolverIsCalledOncePerTurnWithTheSessionsOrganization();
  });
});
