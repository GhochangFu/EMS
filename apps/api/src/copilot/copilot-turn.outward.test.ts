import { describe, it } from "vitest";

import {
  assertAFollowUpOffersNoTestTool,
  assertAnInjectedTestInstructionIsRefused,
  assertATurnThatAsksOffersTheTestTool,
  assertATurnThatDoesNotAskOffersNoTestTool,
  theWordsAreWholeWordsCaseInsensitive,
} from "./copilot-turn.outward.spec";

/** `F4.279` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.279 — the own-message test-send gate (ADR 0099 Amendment 8 D4)", () => {
  it("offers no test tool when the message does not ask", () => assertATurnThatDoesNotAskOffersNoTestTool());
  it("offers the test tool when the message asks", () => assertATurnThatAsksOffersTheTestTool());
  it("offers no test tool on a follow-up", () => assertAFollowUpOffersNoTestTool());
  it("refuses a test send a record's name asks for", () => assertAnInjectedTestInstructionIsRefused());
  it("reads whole words, case-insensitive", () => theWordsAreWholeWordsCaseInsensitive());
});
