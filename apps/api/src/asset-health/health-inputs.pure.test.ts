import { describe, it } from "vitest";

import {
  aForestOnlyAssetIsListedLastAndIsNotWeak,
  losingAssetsAreCountedOverTheWholeScope,
  sevenUnusualAssetsAreCutToFive,
  theAnswersParse,
  theCaveatReadsTheWholeScope,
  theFactsAreNullWithoutData,
  theLowestScoresAreTheFiveLowestRuleScores,
  theOrderIsStrongThenBaselineOnlyThenCode,
  theRowCarriesTheRuleScoreAndTheAdvisoryFigure,
  theTopPointsAndTheLinkFollowTheLastUnusualHour,
  weakIsTrueOnlyWhenEveryUnusualHourIsBaselineOnly,
} from "./health-inputs.pure.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.8a — the health inputs pure step (ADR 0050 Amendment 5, plan T1.2)", () => {
  it("order: strong, then Baseline-only, then asset code; an asset with no unusual hour is not listed", () =>
    theOrderIsStrongThenBaselineOnlyThenCode());
  it("seven unusual assets give five items and unusualAssetCount 7", () => sevenUnusualAssetsAreCutToFive());
  it("a forest-only asset is listed after every Baseline-only asset, with its unusual hours, not weak", () =>
    aForestOnlyAssetIsListedLastAndIsNotWeak());
  it("weak is true only when every unusual hour is Baseline-only", () => weakIsTrueOnlyWhenEveryUnusualHourIsBaselineOnly());
  it("the caveat reads every unusual hour in scope, not only the top 5", () => theCaveatReadsTheWholeScope());
  it("top points: detector order, no repeats, at most 3; the link is the E1.9 link with every point", () =>
    theTopPointsAndTheLinkFollowTheLastUnusualHour());
  it("a row carries the rule score and the advisory figure, or null for both", () =>
    theRowCarriesTheRuleScoreAndTheAdvisoryFigure());
  it("losing points is counted over the whole scope, never for no rule score, a score of 0 or Baseline-only hours", () =>
    losingAssetsAreCountedOverTheWholeScope());
  it("lowest: the five lowest rule scores ascending, ties by id, never an unscored asset", () =>
    theLowestScoresAreTheFiveLowestRuleScores());
  it("no anomaly row or no open ticket is null, never a zero", () => theFactsAreNullWithoutData());
  it("every answer parses under its schema; the five inputs are HEALTH_INPUTS", () => theAnswersParse());
});
