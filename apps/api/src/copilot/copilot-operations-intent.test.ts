import { describe, it } from "vitest";

import {
  aHyphenatedTokenDoesNotAsk,
  anOrdinaryMessageDoesNotAsk,
  aWordInsideAnotherDoesNotAsk,
  bothKindsAskForBoth,
  eachAckWordAsksForTheAcknowledge,
  eachCloseWordAsksForTheClose,
  theWordsAreTheRuledList,
} from "./copilot-operations-intent.spec";

/** `F4.284` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.284 — the operational own-message words (ADR 0106 decision 3, DC3)", () => {
  it("each ack word asks for the acknowledge alone, in any case", () => eachAckWordAsksForTheAcknowledge());
  it("each close word asks for the close alone, in any case", () => eachCloseWordAsksForTheClose());
  it("a message with both kinds of word asks for both", () => bothKindsAskForBoth());
  it("the words are the ruled list", () => theWordsAreTheRuledList());
  it("a word inside another word does not ask", () => aWordInsideAnotherDoesNotAsk());
  it("a hyphenated token does not ask", () => aHyphenatedTokenDoesNotAsk());
  it("an ordinary message does not ask", () => anOrdinaryMessageDoesNotAsk());
});
