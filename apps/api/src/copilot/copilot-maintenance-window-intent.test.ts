import { describe, it } from "vitest";

import {
  aCreateRequestAsksForTheCreate,
  aQuestionOrAnEndDoesNotAskForTheCreate,
  aWordInsideAnotherDoesNotAsk,
  eachCreateVerbBeforeTheNounAsks,
  eachExtendWordAsksForTheExtend,
  theOwnMessageListJoinsBoth,
  theWordsAreTheFixedLists,
} from "./copilot-maintenance-window-intent.spec";

/** `F4.359` PR 6 — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.359 — the maintenance-window own-message words (ADR 0099 Amendment 19 decision 4, Q2)", () => {
  it("a create request asks for the create alone", () => aCreateRequestAsksForTheCreate());
  it("each create verb before the window noun, and each suppress word, asks for the create", () => eachCreateVerbBeforeTheNounAsks());
  it("a question, an end, a cancel or an extend does not ask for the create", () => aQuestionOrAnEndDoesNotAskForTheCreate());
  it("each extend word asks for the extend alone, in any case", () => eachExtendWordAsksForTheExtend());
  it("the words are the fixed lists", () => theWordsAreTheFixedLists());
  it("a word inside another word, or hyphenated, does not ask", () => aWordInsideAnotherDoesNotAsk());
  it("the turn's own-message list joins the operational and the window ids", () => theOwnMessageListJoinsBoth());
});
