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
  assertToolCallsAreRunAndResultsReturnedToTheModel,
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
});
