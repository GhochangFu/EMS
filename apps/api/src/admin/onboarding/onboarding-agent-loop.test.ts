import { describe, it } from "vitest";

import {
  assertAFinalReplyWithNoToolsEndsTheTurn,
  assertALaterWriteDropsThePendingProposal,
  assertAProviderRejectionDiscardsTheTurn,
  assertAToolErrorGoesBackAsAResultNotAThrow,
  assertActionMessagesReachTheModelAsAssistantText,
  assertCapsArePinned,
  assertHistoryCarriesNoProviderContent,
  assertHistoryIsTheLastTwentyCutToTwoThousand,
  assertProviderContentIsKeptOnTheInTurnAssistantMessage,
  assertTheCallCapStopsWithItsReplyAndKeepsTheEdits,
  assertTheDeadlineKeepsCompletedEdits,
  assertTheNinthToolCallIsNotMade,
  assertTheTurnRecordIsTextFree,
  assertW4TheTurnPatchCarriesTemplates,
  assertToolCallsAreRunAndResultsReturnedToTheModel,
  assertAnUnknownToolNameIsRecordedAsUnknown,
  assertAProviderErrorRecordsItsClassAndStatus,
  assertAProviderErrorDiscardsTheSuggestedReplies,
  assertSuggestedRepliesReachTheResult,
  assertThePromptNamesSuggestReplies,
  assertThePromptCarriesTheMappingQuestionLoop,
  assertTheMappingChipsSurviveAndAreNotStepLabels,
  assertThePromptTellsTheModelToReadExistingCodesFirst,
} from "./onboarding-agent-loop.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("onboarding agent loop (F3.21, ADR 0090 decisions 2, 3, 7, 9)", () => {
  it("ends the turn on a final reply", async () => {
    await assertAFinalReplyWithNoToolsEndsTheTurn();
  });

  it("runs tool calls and returns their results to the model", async () => {
    await assertToolCallsAreRunAndResultsReturnedToTheModel();
  });

  it("returns a tool error as a result, not a throw", async () => {
    await assertAToolErrorGoesBackAsAResultNotAThrow();
  });

  it("does not make the ninth tool call", async () => {
    await assertTheNinthToolCallIsNotMade();
  });

  it("stops at the call cap with its reply and keeps the edits", async () => {
    await assertTheCallCapStopsWithItsReplyAndKeepsTheEdits();
  });

  it("keeps completed edits at the deadline without falling back", async () => {
    await assertTheDeadlineKeepsCompletedEdits();
  });

  it("discards the turn on a provider rejection", async () => {
    await assertAProviderRejectionDiscardsTheTurn();
  });

  it("sends the last twenty history messages, each cut to 2,000", async () => {
    await assertHistoryIsTheLastTwentyCutToTwoThousand();
  });

  it("sends action rows as assistant text and drops system rows", async () => {
    await assertActionMessagesReachTheModelAsAssistantText();
  });

  it("sends history as plain text", async () => {
    await assertHistoryCarriesNoProviderContent();
  });

  it("keeps provider content on the in-turn assistant message", async () => {
    await assertProviderContentIsKeptOnTheInTurnAssistantMessage();
  });

  it("drops a proposal that a later write follows", async () => {
    await assertALaterWriteDropsThePendingProposal();
  });

  it("records the turn without text", async () => {
    await assertTheTurnRecordIsTextFree();
  });

  it("pins the caps", () => {
    assertCapsArePinned();
  });

  it("records an unknown tool name as unknown", async () => {
    await assertAnUnknownToolNameIsRecordedAsUnknown();
  });

  it("records a provider error class and status, never its message", async () => {
    await assertAProviderErrorRecordsItsClassAndStatus();
  });
});

describe("runAgentTurn — templates[] (F3.22, ADR 0091 decision 2)", () => {
  it("W4 the turn patch carries a changed templates section", () => {
    assertW4TheTurnPatchCarriesTemplates();
  });
});

describe("runAgentTurn — suggest_replies (F3.25, ADR 0094 decision 9)", () => {
  it("carries the offered replies to the result", async () => {
    await assertSuggestedRepliesReachTheResult();
  });

  it("drops the offered replies on a provider error", async () => {
    await assertAProviderErrorDiscardsTheSuggestedReplies();
  });

  it("tells the model to offer choices with suggest_replies", () => {
    assertThePromptNamesSuggestReplies();
  });
});

describe("the mapping question loop (F3.23, ADR 0092 decision 5)", () => {
  it("puts the write-after-agreement rule in the prompt", () => {
    assertThePromptCarriesTheMappingQuestionLoop();
  });

  it("offers chips that pass the filter and are not step labels", () => {
    assertTheMappingChipsSurviveAndAreNotStepLabels();
  });
});

describe("the organization inventory sentence (F3.26, ADR 0095 decision 5)", () => {
  it("tells the model to call find_existing before it chooses a new code", () => {
    assertThePromptTellsTheModelToReadExistingCodesFirst();
  });
});
