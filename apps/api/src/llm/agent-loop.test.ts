import { describe, it } from "vitest";

import {
  assertADeadlineDuringAToolSkipsTheNextCallInTheReply,
  assertADeadlineDuringTheLastToolOfARoundMakesNoFurtherProviderCall,
  assertADeadlineInsideAProviderCallIsCapTime,
  assertAFinalReplyStopsWithFinalAndNoCalls,
  assertAMadeUpNameIsRecordedAsUnknown,
  assertAProviderErrorRecordsClassAndStatus,
  assertAProviderErrorRecordsNoMessageText,
  assertCapTimeKeepsTheCompletedActionLines,
  assertErrorFactsHoldsOnlyClassAndStatus,
  assertTheCapRecordsEightNamesAndRunsEightCalls,
  assertTheCapsArePinned,
  assertTheNinthCallStopsWithCapCalls,
} from "./agent-loop.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("the generic agent loop (F3.85, ADR 0099)", () => {
  it("stops with final and no tool calls on a final reply", async () => {
    await assertAFinalReplyStopsWithFinalAndNoCalls();
  });

  it("stops with cap_calls at the ninth call", async () => {
    await assertTheNinthCallStopsWithCapCalls();
  });

  it("records eight names and runs eight calls at the cap", async () => {
    await assertTheCapRecordsEightNamesAndRunsEightCalls();
  });

  it("answers cap_time when the deadline fires inside a provider call", async () => {
    await assertADeadlineInsideAProviderCallIsCapTime();
  });

  it("keeps the completed calls' action lines on cap_time", async () => {
    await assertCapTimeKeepsTheCompletedActionLines();
  });

  it("skips the next call in a reply when the deadline fires during a tool", async () => {
    await assertADeadlineDuringAToolSkipsTheNextCallInTheReply();
  });

  it("makes no further provider call when the deadline fires during a round's last tool", async () => {
    await assertADeadlineDuringTheLastToolOfARoundMakesNoFurtherProviderCall();
  });

  it("records a provider error's class and status", async () => {
    await assertAProviderErrorRecordsClassAndStatus();
  });

  it("records no provider error message text", async () => {
    await assertAProviderErrorRecordsNoMessageText();
  });

  it("errorFacts holds only the class and the status", () => {
    assertErrorFactsHoldsOnlyClassAndStatus();
  });

  it("records a made-up tool name as unknown", async () => {
    await assertAMadeUpNameIsRecordedAsUnknown();
  });

  it("pins the caps", () => {
    assertTheCapsArePinned();
  });
});
