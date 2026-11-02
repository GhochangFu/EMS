import { describe, it } from "vitest";

import {
  assertALargeCurrentAgainstASteadyBaselineIsAbove,
  assertANearZeroBaselineIsNotComparable,
  assertAWindowAtHalfTheBucketsCounts,
  assertAnAllZeroPointIsNotComparable,
  assertNormalIsCountedNotSent,
  assertOnlyAssetsWithACurrentRowAreJudged,
  assertOppositeSignsAreNotComparable,
  assertRatioOfOneHalfIsBelow,
  assertRatioOfOnePointFiveIsAbove,
  assertRatioOfOnePointFourNineIsNormal,
  assertRatioOfPointFiveOneIsNormal,
  assertTheCompareRowIsNotABaselineWindow,
  assertTheListOrder,
  assertTruncatedAtOneHundredAndOne,
  assertTwoCountingWindowsAreNotEnoughHistory,
  assertTwoNegativesCompareByMagnitude,
} from "./segment-abnormal.spec";

/** `F4.302` U2 — Vitest entry point for the segment abnormal verdict. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.302 — the segment view's two-sided abnormal verdict (ADR 0108 Amendment 4 item 5)", () => {
  describe("the verdict", () => {
    it("a ratio of 1.5 is above", () => assertRatioOfOnePointFiveIsAbove());
    it("a ratio of 1.49 is normal", () => assertRatioOfOnePointFourNineIsNormal());
    it("a ratio of 0.5 is below", () => assertRatioOfOneHalfIsBelow());
    it("a ratio of 0.51 is normal", () => assertRatioOfPointFiveOneIsNormal());
    it("a baseline within 1 % of the largest counting-window magnitude is not comparable, with no ratio", () =>
      assertANearZeroBaselineIsNotComparable());
    it("a current mean of 600 against counting windows at 5 is above (the current is not in the scale)", () =>
      assertALargeCurrentAgainstASteadyBaselineIsAbove());
    it("+5 against -5 is not comparable", () => assertOppositeSignsAreNotComparable());
    it("-30 against -20 is above (by magnitude)", () => assertTwoNegativesCompareByMagnitude());
    it("an all-zero point is not comparable", () => assertAnAllZeroPointIsNotComparable());
    it("two counting windows are not enough history", () => assertTwoCountingWindowsAreNotEnoughHistory());
    it("a window at exactly half the current bucket count counts", () => assertAWindowAtHalfTheBucketsCounts());
  });

  describe("the entries", () => {
    it("the compare row (idx -1) is not a baseline window", () => assertTheCompareRowIsNotABaselineWindow());
    it("only assets with a current row are judged", () => assertOnlyAssetsWithACurrentRowAreJudged());
  });

  describe("the list", () => {
    it("above by ratio desc, below by ratio asc, then not comparable and not enough history by code", () =>
      assertTheListOrder());
    it("normal is counted, not sent", () => assertNormalIsCountedNotSent());
    it("101 entries are cut to 100 with truncated", () => assertTruncatedAtOneHundredAndOne());
  });
});
