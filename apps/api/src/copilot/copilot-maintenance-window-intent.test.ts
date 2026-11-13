import { describe, it } from "vitest";

import {
  aWordInsideAnotherDoesNotAsk,
  eachCreateWordAsksForTheCreate,
  eachExtendWordAsksForTheExtend,
  endAndCancelAreNotGated,
  theOwnMessageListJoinsBoth,
  theWordsAreTheFixedLists,
} from "./copilot-maintenance-window-intent.spec";

/** `F4.359` PR 6 — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.359 — the maintenance-window own-message words (ADR 0099 Amendment 19 decision 4, Q2)", () => {
  it("each create word asks for the create alone, in any case", () => eachCreateWordAsksForTheCreate());
  it("each extend word asks for the extend alone, in any case", () => eachExtendWordAsksForTheExtend());
  it("the words are the fixed lists", () => theWordsAreTheFixedLists());
  it("a word inside another word, or hyphenated, does not ask", () => aWordInsideAnotherDoesNotAsk());
  it("end and cancel are not gated", () => endAndCancelAreNotGated());
  it("the turn's own-message list joins the operational and the window ids", () => theOwnMessageListJoinsBoth());
});
