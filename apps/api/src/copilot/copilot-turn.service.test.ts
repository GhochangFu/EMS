import "reflect-metadata";

import { describe, it } from "vitest";

import {
  assertABoundTurnAllowsOnlyItsOrganization,
  assertACredentialArgumentNeverReachesATool,
  assertACredentialIsRefusedBeforeAnySideEffect,
  assertACrossOrganizationTurnUsesThePlatformScope,
  assertAMissingConversationIs404,
  assertAnObeyedInjectionYieldsOnlyAPendingCard,
  assertAProposalIsReturnedAsACard,
  assertAFailedTurnDiscardsItsProposals,
  assertFillStepReachesTheResponse,
  assertAFollowUpTurnRunsOnTheChangesOutcome,
  assertAFollowUpThatFailsStoresTheOutcomeOnly,
  assertAFollowUpWithoutAFinishedChangeDoesNothing,
  assertAFollowUpOutsideTheScopeStoresTheOutcomeOnly,
  assertAFailedStoreDiscardsTheTurnsProposals,
  assertActionLinesReachTheModelAsMarkedData,
  assertAPlainMessageRunsEveryStep,
  assertAProviderFailureStoresNothing,
  assertARefusedTurnIs429BeforeTheProvider,
  assertAToolResultIsScrubbedBeforeTheProvider,
  assertAToolResultOutsideTheScopeFails,
  assertAvailabilityIsDecidedForTheConversationsOrganization,
  assertAnAnswerFromHistoryCarriesTheHistorysOrganizations,
  assertARestatedAnswerIsDroppedWhenItsOrganizationLeaves,
  assertHistoryDropsAnswersFromAnOrganizationThatLeftTheScope,
  assertHistoryIsBoundedScrubbedAndCut,
  assertIsConfiguredResolvesTheTurnsScope,
  assertTheModelIsToldItsAllowedOrganizations,
  assertTheModuleWiresTheTurnService,
  assertNavigateToCarriesOnlyAnAppRoute,
  assertNoKeyAnswersNotConfiguredAndIsNotCounted,
  assertTheReplyIsScrubbed,
  assertTheTurnLogCarriesNoText,
  assertTheTurnStoresUserThenAssistantWithProvenance,
  assertUsageIsCountedOnTheConversationsOrganization,
} from "./copilot-turn.service.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("F3.85 PR 7 — the copilot turn, in order (ADR 0099 decisions 1, 9, 10, 11)", () => {
  it("answers 404 for a conversation the caller cannot see", async () => {
    await assertAMissingConversationIs404();
  });
  it("1 · decides availability for the conversation's organization (403)", async () => {
    await assertAvailabilityIsDecidedForTheConversationsOrganization();
  });
  it("2 · refuses a credential before any key, count, model call or store", async () => {
    await assertACredentialIsRefusedBeforeAnySideEffect();
  });
  it("2 · positive: a plain message resolves, counts, calls the model and stores", async () => {
    await assertAPlainMessageRunsEveryStep();
  });
  it("3 · answers not_configured without a key, and does not count it", async () => {
    await assertNoKeyAnswersNotConfiguredAndIsNotCounted();
  });
  it("3 · a cross-organization conversation uses the platform scope", async () => {
    await assertACrossOrganizationTurnUsesThePlatformScope();
  });
  it("3 · a bound conversation allows its organization alone", async () => {
    await assertABoundTurnAllowsOnlyItsOrganization();
  });
  it("3 · the model is told the organization ids it may read", async () => {
    await assertTheModelIsToldItsAllowedOrganizations();
  });
  it("4 · a refused turn is a 429 before the provider", async () => {
    await assertARefusedTurnIs429BeforeTheProvider();
  });
  it("4 · usage is counted on the conversation's organization", async () => {
    await assertUsageIsCountedOnTheConversationsOrganization();
  });
  it("5 · history is the last 20, scrubbed and cut", async () => {
    await assertHistoryIsBoundedScrubbedAndCut();
  });
  it("5 · history drops answers from an organization that left the key scope", async () => {
    await assertHistoryDropsAnswersFromAnOrganizationThatLeftTheScope();
  });
  it("5 · an answer made from history carries the history's organizations", async () => {
    await assertAnAnswerFromHistoryCarriesTheHistorysOrganizations();
  });
  it("5 · a restated answer is dropped when its organization leaves the key scope", async () => {
    await assertARestatedAnswerIsDroppedWhenItsOrganizationLeaves();
  });
  it("6 · a tool result outside the allowed set fails closed", async () => {
    await assertAToolResultOutsideTheScopeFails();
  });
  it("6 · a tool result is scrubbed before the provider sees it", async () => {
    await assertAToolResultIsScrubbedBeforeTheProvider();
  });
  it("6 · a credential argument never reaches a tool", async () => {
    await assertACredentialArgumentNeverReachesATool();
  });
  it("6 · an obeyed injection yields one pending card and no write", async () => {
    await assertAnObeyedInjectionYieldsOnlyAPendingCard();
  });
  it("6 · the turn log carries no text", async () => {
    await assertTheTurnLogCarriesNoText();
  });
  it("6 · navigateTo carries only an app route", async () => {
    await assertNavigateToCarriesOnlyAnAppRoute();
  });
  it("6 · a provider failure stores nothing", async () => {
    await assertAProviderFailureStoresNothing();
  });
  it("7 · the reply is scrubbed in the response and the store", async () => {
    await assertTheReplyIsScrubbed();
  });
  it("8 · stores the user message, then the reply with its provenance", async () => {
    await assertTheTurnStoresUserThenAssistantWithProvenance();
  });
  it("isConfigured resolves the scope a turn would", async () => {
    await assertIsConfiguredResolvesTheTurnsScope();
  });
  it("CopilotModule wires the turn service, LlmModule and the read- and propose-tool tokens", () => {
    assertTheModuleWiresTheTurnService();
  });
});

describe("F3.85 PR 8 — proposals and the follow-up turn (ADR 0099 decisions 2, 4, 4.7)", () => {
  it("returns a proposal as a card", async () => {
    await assertAProposalIsReturnedAsACard();
  });
  it("rejects the proposals of a turn that fails", async () => {
    await assertAFailedTurnDiscardsItsProposals();
  });
  it("returns fill_step values for the open wizard", async () => {
    await assertFillStepReachesTheResponse();
  });
  it("runs a follow-up turn on the change's outcome", async () => {
    await assertAFollowUpTurnRunsOnTheChangesOutcome();
  });
  it("stores only the outcome when a follow-up fails", async () => {
    await assertAFollowUpThatFailsStoresTheOutcomeOnly();
  });
  it("does nothing without a finished change", async () => {
    await assertAFollowUpWithoutAFinishedChangeDoesNothing();
  });
  it("stores only the outcome when the change's organization left the key scope", async () => {
    await assertAFollowUpOutsideTheScopeStoresTheOutcomeOnly();
  });
  it("rejects the proposals of a turn whose store fails", async () => {
    await assertAFailedStoreDiscardsTheTurnsProposals();
  });
  it("replays action lines as marked data", async () => {
    await assertActionLinesReachTheModelAsMarkedData();
  });
});
