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
  aDuplicateCodeInsideTheBatchIsRefused,
  aMalformedRowIsRefusedWithItsNumber,
  anAssetCodeIsReadOncePerAsset,
  anUnarmableRowIsRefusedWithItsNumber,
  aRowWithNoSampleIsCountedAsNoSample,
  everyRowIsValidatedArmedEvaluatedAndBacktested,
  theFirstRefusedRowNamesItsNumberAndStopsTheCheck,
  theNoteCountsTheRows,
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

/** `F4.289` — the batch check (ADR 0099 Amendment 9 E3). Assertions live in the sibling `.spec` (§4.6). */
describe("F4.289 — the rule.createBatch card's check", () => {
  it("every row is validated, armed, evaluated and backtested", () => everyRowIsValidatedArmedEvaluatedAndBacktested());
  it("the first refused row names its number and stops the check", () => theFirstRefusedRowNamesItsNumberAndStopsTheCheck());
  it("an unarmable row is refused with its number", () => anUnarmableRowIsRefusedWithItsNumber());
  it("a malformed row is refused with its number", () => aMalformedRowIsRefusedWithItsNumber());
  it("a duplicate code inside the batch is refused", () => aDuplicateCodeInsideTheBatchIsRefused());
  it("the note counts the rows", () => theNoteCountsTheRows());
  it("a row with no sample is counted as no sample", () => aRowWithNoSampleIsCountedAsNoSample());
  it("an asset code is read once per asset", () => anAssetCodeIsReadOncePerAsset());
});
