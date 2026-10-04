import { describe, it } from "vitest";

import {
  assertACommitRefusalIsAReplyNotAThrow,
  assertACoreConflictIsAReplyNotAThrow,
  assertAMatchingProposalCommitsOnce,
  assertANonProposingTurnClearsTheProposal,
  assertAProposingTurnStoresAHashOfTheStoredDraft,
  assertAStaleProposalIsClearedAndNotCommitted,
  assertActionLinesAreStoredBetweenUserAndAssistant,
  assertConfirmWithNoProposalRepliesWithoutAModelCall,
  assertPatchDraftClearsTheProposal,
  assertScrubMessagesKeepsTheActionRole,
  assertSetCredentialsClearsTheProposal,
  assertTheConfirmLineNamesTheTemplateCounts,
  assertTheCredentialRefusalStillAnswersFirst,
  assertHistoryAndActionLinesAreScrubbed,
} from "./onboarding-chat-confirm.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("OnboardingService.chat — the confirm path and action messages (F3.21, ADR 0090 decisions 5, 6)", () => {
  it("replies without a model call when no commit is proposed", async () => {
    await assertConfirmWithNoProposalRepliesWithoutAModelCall();
  });

  it("clears a stale proposal and does not commit", async () => {
    await assertAStaleProposalIsClearedAndNotCommitted();
  });

  it("commits once on a matching proposal", async () => {
    await assertAMatchingProposalCommitsOnce();
  });

  it("names the template counts in the confirm line (F3.22, ADR 0091 d4)", async () => {
    await assertTheConfirmLineNamesTheTemplateCounts();
  });

  it("answers a commit refusal as a reply", async () => {
    await assertACommitRefusalIsAReplyNotAThrow();
  });

  it("answers a template core's 409 as a reply (F3.22)", async () => {
    await assertACoreConflictIsAReplyNotAThrow();
  });

  it("still answers a credential-looking message with the refusal", async () => {
    await assertTheCredentialRefusalStillAnswersFirst();
  });

  it("binds a new proposal to the hash of the written draft", async () => {
    await assertAProposingTurnStoresAHashOfTheStoredDraft();
  });

  it("clears the proposal on a turn that does not propose", async () => {
    await assertANonProposingTurnClearsTheProposal();
  });

  it("stores action lines between the user turn and the reply", async () => {
    await assertActionLinesAreStoredBetweenUserAndAssistant();
  });

  it("clears the proposal on a draft PATCH", async () => {
    await assertPatchDraftClearsTheProposal();
  });

  it("clears the proposal when a credential is set", async () => {
    await assertSetCredentialsClearsTheProposal();
  });

  it("keeps the action role through the message scrub", () => {
    assertScrubMessagesKeepsTheActionRole();
  });

  it("scrubs the history and a credential-looking action line", async () => {
    await assertHistoryAndActionLinesAreScrubbed();
  });
});
