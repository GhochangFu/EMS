import { expect } from "vitest";

import { ACKNOWLEDGE_WORDS, CLOSE_WORDS, OPERATIONAL_WORDS, operationalIntentOf } from "./copilot-operations-intent";

/**
 * `F4.284` (ADR 0106 decision 3; owner ruling DC3) — the own-message words that
 * allow an alarm acknowledge or a work-order close. Vitest entry point: the
 * sibling `.test.ts` (ADR 0014).
 */

/** Each ack word, alone and in a sentence, in any case, asks for the acknowledge alone. */
export function eachAckWordAsksForTheAcknowledge(): void {
  for (const word of ACKNOWLEDGE_WORDS) {
    expect(operationalIntentOf(`please ${word} the main breaker alarm`), word).toEqual(["alarm.acknowledge"]);
    expect(operationalIntentOf(word.toUpperCase()), word.toUpperCase()).toEqual(["alarm.acknowledge"]);
  }
}

/** Each close word, alone and in a sentence, in any case, asks for the close alone. */
export function eachCloseWordAsksForTheClose(): void {
  for (const word of CLOSE_WORDS) {
    expect(operationalIntentOf(`please ${word} the breaker work order`), word).toEqual(["workOrder.close"]);
    expect(operationalIntentOf(word.toUpperCase()), word.toUpperCase()).toEqual(["workOrder.close"]);
  }
}

/** A message with both kinds of word asks for both. */
export function bothKindsAskForBoth(): void {
  expect(operationalIntentOf("ack the alarm and close its work order")).toEqual(["alarm.acknowledge", "workOrder.close"]);
}

/** The ruled list, exactly. */
export function theWordsAreTheRuledList(): void {
  expect([...OPERATIONAL_WORDS]).toEqual(["acknowledge", "acknowledged", "ack", "acked", "close", "closed", "closing"]);
}

/** Whole words only: "disclose" and "enclosed" hold "close" inside them. */
export function aWordInsideAnotherDoesNotAsk(): void {
  for (const message of ["disclose the cause", "the enclosed report", "closer to the panel", "acknowledgement letter"]) {
    expect(operationalIntentOf(message), message).toEqual([]);
  }
}

/** A hyphen joins a word to its neighbour, so "ack-" prefixed tokens are not the word. */
export function aHyphenatedTokenDoesNotAsk(): void {
  for (const message of ["ack-free mode", "the pre-close checklist"]) expect(operationalIntentOf(message), message).toEqual([]);
}

/** A message with none of the words does not ask. */
export function anOrdinaryMessageDoesNotAsk(): void {
  expect(operationalIntentOf("what is the kW on MCC-1 now?")).toEqual([]);
}
