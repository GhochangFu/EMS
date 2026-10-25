import { describe, it } from "vitest";

import {
  aCreateCallsTheValidatorAsTheRouteDoes,
  aCreateNoteCarriesTheBacktestEstimate,
  aGtBacktestNamesTheMinuteHigh,
  anEqBacktestNamesTheMinuteAverage,
  anLtBacktestNamesTheMinuteLow,
  aCreateNoteNamesTheCondition,
  aCreateNoteSaysItWouldMatchNow,
  anEnableOfADraftIsRefused,
  anEnableOfAHalfBuiltRuleIsRefused,
  anUnknownRuleIsNotFound,
  anUpdateOfAnArchivedRuleIsRefused,
  anUpdateValidatesTheMergedDraft,
  aPublishValidatesTheRowAndAssertsArmable,
  aRuleWithNoSampleSaysSo,
  aTimeWindowDraftHasNoBacktest,
  theNonArmingEntriesReadNoSampleAndShowTheCondition,
} from "./rule-proposal-check.service.spec";

/** `F4.278` — Vitest entry point for the copilot's rule check. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.278 — the copilot's write-free rule check (ADR 0099 Amendment 8, Q9)", () => {
  it("a create calls the validator as the route does", () => aCreateCallsTheValidatorAsTheRouteDoes());
  it("a create's note says it would match now", () => aCreateNoteSaysItWouldMatchNow());
  it("a create's note names the condition", () => aCreateNoteNamesTheCondition());
  it("a create's note carries the backtest estimate", () => aCreateNoteCarriesTheBacktestEstimate());
  it("a gt backtest names the minute's highest value (ruling Q1)", () => aGtBacktestNamesTheMinuteHigh());
  it("an lt backtest names the minute's lowest value (ruling Q1)", () => anLtBacktestNamesTheMinuteLow());
  it("an eq backtest names the minute's average (ruling Q1)", () => anEqBacktestNamesTheMinuteAverage());
  it("a time-window draft has no backtest", () => aTimeWindowDraftHasNoBacktest());
  it("an update of an archived rule is refused", () => anUpdateOfAnArchivedRuleIsRefused());
  it("an update validates the merged draft", () => anUpdateValidatesTheMergedDraft());
  it("an enable of a draft is refused", () => anEnableOfADraftIsRefused());
  it("an enable of a half-built rule is refused", () => anEnableOfAHalfBuiltRuleIsRefused());
  it("a publish validates the row and asserts armable", () => aPublishValidatesTheRowAndAssertsArmable());
  it("duplicate, archive and disable read no sample and show the condition", () =>
    theNonArmingEntriesReadNoSampleAndShowTheCondition());
  it("an unknown rule is not found", () => anUnknownRuleIsNotFound());
  it("a rule with no sample says so", () => aRuleWithNoSampleSaysSo());
});
