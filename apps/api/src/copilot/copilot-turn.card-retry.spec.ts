import { expect } from "vitest";

import { calls, FakeLlmProvider, toolCall } from "../admin/onboarding/onboarding-agent-loop.spec";
import { textOfContent } from "../llm/llm-port";
import { COPILOT_CARD_RETRY_MESSAGE, COPILOT_NO_CHANGE_PROPOSED_NOTE } from "./copilot-card-claim";
import { turnLogField } from "./copilot-turn.card-claim.spec";
import { APPLIED, CHANGE_ID, GLOBAL_ADMIN, harness, JWT, turn } from "./copilot-turn.service.spec";

/**
 * `F4.295` — a copilot reply that describes a card it never proposed gets one
 * correction in the same turn. The replies below are the AWS demo's, verbatim
 * (conversation `e39203b8`, 2026-10-29, PHE Bilsi): after three real rule
 * cards the model wrote the next two as text and called no `propose_` tool.
 * Vitest entry point: the sibling `.test.ts`.
 */

/** 02:32:05 UTC: the first Bilsi reply, `proposed: 0`. */
export const AWS_BILSI_CARD_REPLY =
  "Here's the first card, for **Bilsi 1**: **Create rule \"Bilsi 1 main breaker off\"** on **PHE-PUMP-M-000000004** (RTU Bilsi I) - Condition: `breaker_main` equals **0** (latest value, clear hold 120 s). Confirm this card, and I'll propose the Bilsi 2 rule next.";
/** 02:32:40 UTC: the second, after the user pasted the card back; no tool at all. */
export const AWS_BILSI_AGAIN_REPLY =
  "Proposing the card now — here it is: **Create rule \"Bilsi 1 main breaker off\"** on **DEVICE - PHEWB - PUMP-M-000000004**. Confirm the card to create it.";
const TEMPLATE_T = "55555555-5555-4555-8555-555555555555";
const AFTER_RETRY = "The card for Bilsi 1 is ready: confirm it to create the rule.";

function assistantRows(h: ReturnType<typeof harness>): string[] {
  return h.history.filter((m) => m.role === "assistant").map((m) => m.content);
}

/** The text of the last message of the provider's `call`-th request (1-based). */
function lastSent(llm: FakeLlmProvider, call: number): string {
  const sent = llm.seen[call - 1] ?? [];
  const last = sent[sent.length - 1];
  return last === undefined ? "" : typeof last.content === "string" ? last.content : textOfContent(last.content ?? "");
}

/** A text-only card, then a real proposal on the correction: the card is returned, the first text never reaches the user. */
export async function theCorrectionTurnsATextCardIntoACard(): Promise<void> {
  const llm = new FakeLlmProvider([
    { kind: "final", text: AWS_BILSI_CARD_REPLY },
    calls(toolCall("propose_dashboardTemplate_publish", { id: TEMPLATE_T })),
    { kind: "final", text: AFTER_RETRY },
  ]);
  const h = harness(llm);
  const response = await turn(h, "Move to the Bilsi site. I need to create an alarm for the main pump for Bilsi 1 and Bilsi 2.");
  expect([response.reply, response.pendingChanges.length, assistantRows(h)]).toEqual([AFTER_RETRY, 1, [AFTER_RETRY]]);
}

/** The correction the model is sent is the server check, after its own first text. */
export async function theModelIsSentItsTextAndTheCheck(): Promise<void> {
  const llm = new FakeLlmProvider([{ kind: "final", text: AWS_BILSI_AGAIN_REPLY }, { kind: "final", text: AWS_BILSI_AGAIN_REPLY }]);
  await turn(harness(llm), "Create rule \"Bilsi 1 main breaker off\" on PHE-PUMP-M-000000004");
  const sent = llm.seen[1] ?? [];
  expect([llm.calls, sent[sent.length - 2]?.role, lastSent(llm, 2)]).toEqual([2, "assistant", COPILOT_CARD_RETRY_MESSAGE]);
}

/** A second text-only card after the correction gets the note, and the model is asked no third time. */
export async function aSecondTextCardGetsTheNote(): Promise<void> {
  const llm = new FakeLlmProvider([
    { kind: "final", text: AWS_BILSI_CARD_REPLY },
    { kind: "final", text: AWS_BILSI_AGAIN_REPLY },
    { kind: "final", text: "a third answer the loop never asks for" },
  ]);
  const h = harness(llm);
  const response = await turn(h, "Create rule \"Bilsi 1 main breaker off\" on PHE-PUMP-M-000000004");
  const noted = `${AWS_BILSI_AGAIN_REPLY} ${COPILOT_NO_CHANGE_PROPOSED_NOTE}`;
  expect([llm.calls, response.reply, assistantRows(h)]).toEqual([2, noted, [noted]]);
}

/** A turn that proposed a card and says so is never corrected. */
export async function aRealCardIsNotCorrected(): Promise<void> {
  const llm = new FakeLlmProvider([calls(toolCall("propose_dashboardTemplate_publish", { id: TEMPLATE_T })), { kind: "final", text: AWS_BILSI_CARD_REPLY }]);
  const response = await turn(harness(llm), "publish template T");
  expect([llm.calls, response.reply]).toEqual([2, AWS_BILSI_CARD_REPLY]);
}

/** A reply that claims no card is never corrected. */
export async function aPlainAnswerIsNotCorrected(): Promise<void> {
  const llm = new FakeLlmProvider([{ kind: "final", text: "PHE-PUMP-M-000000004 reports breaker_main." }]);
  const response = await turn(harness(llm), "what does Bilsi 1 report?");
  expect([llm.calls, response.reply]).toEqual([1, "PHE-PUMP-M-000000004 reports breaker_main."]);
}

/** A follow-up turn takes the same correction (the AWS 02:28 follow-up wrote its next card as text). */
export async function aFollowUpTextCardIsCorrected(): Promise<void> {
  const llm = new FakeLlmProvider([{ kind: "final", text: AWS_BILSI_CARD_REPLY }, { kind: "final", text: "The rule was created." }]);
  const h = harness(llm, { finished: APPLIED });
  await h.service.followUp({ identity: GLOBAL_ADMIN, user: JWT }, CHANGE_ID);
  expect([llm.calls, lastSent(llm, 2), assistantRows(h).at(-1)]).toEqual([2, COPILOT_CARD_RETRY_MESSAGE, "The rule was created."]);
}

/** A card from an earlier turn is on screen: no correction (it would say "no card"), and the note as before. */
export async function anOpenCardSkipsTheCorrection(): Promise<void> {
  const llm = new FakeLlmProvider([{ kind: "final", text: AWS_BILSI_CARD_REPLY }]);
  const response = await turn(harness(llm, { cardOpen: true }), "what will it do?");
  expect([llm.calls, response.reply]).toEqual([1, `${AWS_BILSI_CARD_REPLY} ${COPILOT_NO_CHANGE_PROPOSED_NOTE}`]);
}

/** The correction round fails: the turn answers the first text with the note, as it did before F4.295, and stores it. */
export async function aFailedCorrectionFallsBackToTheNotedFirstText(): Promise<void> {
  const h = harness(new FakeLlmProvider([{ kind: "final", text: AWS_BILSI_CARD_REPLY }, "reject"]));
  const response = await turn(h, "Bilsi 1");
  const noted = `${AWS_BILSI_CARD_REPLY} ${COPILOT_NO_CHANGE_PROPOSED_NOTE}`;
  expect([response.outcome, response.reply, assistantRows(h)]).toEqual(["answered", noted, [noted]]);
}

/** The "copilot turn" log line records that the correction ran, and only on the turn where it did. */
export async function theTurnLogRecordsTheCorrection(): Promise<void> {
  const flags = await turnLogField("corrected", async () => {
    await turn(harness(new FakeLlmProvider([{ kind: "final", text: AWS_BILSI_CARD_REPLY }, { kind: "final", text: "No card." }])), "Bilsi 1");
    await turn(harness(new FakeLlmProvider([{ kind: "final", text: "Two assets." }])), "assets?");
  });
  expect(flags).toEqual([true, undefined]);
}
