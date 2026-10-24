import { describe, it } from "vitest";

import {
  assertAFollowUpOffersNoTestTool,
  assertAnInjectedTestInstructionIsRefused,
  assertATurnThatAsksOffersTheTestTool,
  assertATurnThatDoesNotAskOffersNoTestTool,
  theWordsAreWholeWordsCaseInsensitive,
  theReportEmailWordsAreWholeWords,
  theTwoSwitchesAreSeparate,
  aTurnThatAsksForEmailSetsTheReportSwitch,
  aTurnThatDoesNotAskLeavesTheReportSwitchOff,
  aFileTurnLeavesTheReportSwitchOff,
} from "./copilot-turn.outward.spec";

/** `F4.279` — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.279 — the own-message test-send gate (ADR 0099 Amendment 8 D4)", () => {
  it("offers no test tool when the message does not ask", () => assertATurnThatDoesNotAskOffersNoTestTool());
  it("offers the test tool when the message asks", () => assertATurnThatAsksOffersTheTestTool());
  it("offers no test tool on a follow-up", () => assertAFollowUpOffersNoTestTool());
  it("refuses a test send a record's name asks for", () => assertAnInjectedTestInstructionIsRefused());
  it("reads whole words, case-insensitive", () => theWordsAreWholeWordsCaseInsensitive());
  it("F4.280: reads the report-email words as whole words", () => theReportEmailWordsAreWholeWords());
  it("F4.280: keeps the two switches separate (Q3)", () => theTwoSwitchesAreSeparate());
  it("F4.280: a turn that asks for email sets the report switch", () => aTurnThatAsksForEmailSetsTheReportSwitch());
  it("F4.280: a turn that does not ask leaves the report switch off", () => aTurnThatDoesNotAskLeavesTheReportSwitchOff());
  it("F4.280: a turn that carries a file leaves the report switch off (A7)", () => aFileTurnLeavesTheReportSwitchOff());
});
