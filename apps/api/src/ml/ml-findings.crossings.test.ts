import { describe, it } from "vitest";

import {
  aPointThatNeverCrossesGivesNone,
  aRuleUnitThatDiffersIsSkippedAnEqualOrAbsentOneKept,
  alreadyBeyondAtBucketZeroIsFromNow,
  eachCoveredOperatorCrosses,
  eqTimeWindowAndOtherRulesAreSkipped,
  exactlyAtTheThresholdGtIsNotCrossedGteIs,
  expectedComesBeforeMayAtTheSameHour,
  fourCrossingsGiveTheEarliestThree,
  onlyTheBandCrossesUpperForGtLowerForLt,
} from "./ml-findings.crossings.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.9a — forecast limit crossings (ADR 0135 Amendment 8 decision 3)", () => {
  it("gt, gte, lt and lte each give their expected crossing", () => eachCoveredOperatorCrosses());
  it("exactly at the threshold: gt no, gte yes", () => exactlyAtTheThresholdGtIsNotCrossedGteIs());
  it("the band only: the upper edge for gt, the lower edge for lt", () => onlyTheBandCrossesUpperForGtLowerForLt());
  it("already beyond at bucket 0 is `from now`", () => alreadyBeyondAtBucketZeroIsFromNow());
  it("a point that never crosses gives none", () => aPointThatNeverCrossesGivesNone());
  it("eq, time_window, another window, no threshold, another asset or point: skipped", () =>
    eqTimeWindowAndOtherRulesAreSkipped());
  it("a rule unit that differs is skipped; an equal or absent one is kept", () =>
    aRuleUnitThatDiffersIsSkippedAnEqualOrAbsentOneKept());
  it("four crossings give the earliest three", () => fourCrossingsGiveTheEarliestThree());
  it("expected before may at the same hour, then asset label, then rule name", () =>
    expectedComesBeforeMayAtTheSameHour());
});
