import { describe, it } from "vitest";

import {
  assertACorrectionAsksTheModelAgain,
  assertACorrectionRunsOnceATurn,
  assertACapWithNoCorrectionStaysACap,
  assertADeadlineAfterACorrectionFallsBackToTheFirstText,
  assertAProviderErrorAfterACorrectionFallsBackToTheFirstText,
  assertACorrectionSendsTheTextAndTheMessageBack,
  assertACorrectionSharesTheCallCap,
  assertANullCorrectionAcceptsTheText,
  assertADeadlineDuringAToolSkipsTheNextCallInTheReply,
  assertADeadlineDuringTheLastToolOfARoundMakesNoFurtherProviderCall,
  assertADeadlineInsideAProviderCallIsCapTime,
  assertAFinalReplyStopsWithFinalAndNoCalls,
  assertAMadeUpNameIsRecordedAsUnknown,
  assertAProviderErrorRecordsClassAndStatus,
  assertAProviderErrorRecordsNoMessageText,
  assertTheRecordSaysTheCorrectionRan,
  assertTheSecondTextIsTheReply,
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

  it("F4.295: a correction asks the model again", async () => {
    await assertACorrectionAsksTheModelAgain();
  });

  it("F4.295: a correction sends the first text and the message back", async () => {
    await assertACorrectionSendsTheTextAndTheMessageBack();
  });

  it("F4.295: the second text is the reply", async () => {
    await assertTheSecondTextIsTheReply();
  });

  it("F4.295: the record says the correction ran", async () => {
    await assertTheRecordSaysTheCorrectionRan();
  });

  it("F4.295: a correction runs once a turn", async () => {
    await assertACorrectionRunsOnceATurn();
  });

  it("F4.295: a null correction accepts the text", async () => {
    await assertANullCorrectionAcceptsTheText();
  });

  it("F4.295: a correction shares the turn's call cap", async () => {
    await assertACorrectionSharesTheCallCap();
  });

  it("F4.295: a deadline after a correction falls back to the first text", async () => {
    await assertADeadlineAfterACorrectionFallsBackToTheFirstText();
  });

  it("F4.295: a provider error after a correction falls back to the first text", async () => {
    await assertAProviderErrorAfterACorrectionFallsBackToTheFirstText();
  });

  it("F4.295: a failure with no correction stays a failure", async () => {
    await assertACapWithNoCorrectionStaysACap();
  });

  it("pins the caps", () => {
    assertTheCapsArePinned();
  });
});
