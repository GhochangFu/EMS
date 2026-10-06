import { describe, it } from "vitest";

import {
  assertAProviderErrorAtTheRtuStepAnswersTheRtuPrompt,
  assertAProviderErrorFallsBackWithTheNotice,
  assertAnIncompleteOrgRowIsGuidedModeWithTheSetupNotice,
  assertCapTimeDoesNotFallBack,
  assertMergeDraftClearsAStoredProposal,
  assertNoResolvedProviderMeansNoNotice,
  assertTheResolverIsCalledOncePerTurnWithTheSessionsOrganization,
  assertTheTurnLogsOneTextFreeLineWithTheProviderName,
  assertAStepLabelOnTheAgentPathNeverReachesTheModel,
  assertAnAgentReplysChipsAreTheFilteredOfferPlusTheStepLabel,
} from "./onboarding-chat-agent.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("OnboardingChatService — the agent branch (F3.21, ADR 0090)", () => {
  it("answers a provider error with the notice and the step prompt, and writes nothing (Amendment 2 B1)", async () => {
    await assertAProviderErrorFallsBackWithTheNotice();
  });

  it("answers a provider error at the RTU step with the RTU prompt, and writes nothing (Amendment 2 B1)", async () => {
    await assertAProviderErrorAtTheRtuStepAnswersTheRtuPrompt();
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

  it("answers a step label by code on the agent path, never calling the model (F3.25, ADR 0094 decision 8)", async () => {
    await assertAStepLabelOnTheAgentPathNeverReachesTheModel();
  });

  it("answers the model's filtered replies plus the step label and View draft (F3.25, ADR 0094 decision 9)", async () => {
    await assertAnAgentReplysChipsAreTheFilteredOfferPlusTheStepLabel();
  });
});
