import { describe, it } from "vitest";

import {
  aFinderWithNoRuleAheadIsNotTowardTheLimit,
  anIntervalEndOfExactlyZeroIncludesZero,
  daysRangeKeepsItsBounds,
  p10TwentyDaysIsCoverage,
  p11QuotientsAreRoundedFirst,
  p12RisingHealthIsNotTowardTheLimit,
  p13UnderOneDayIsNotReported,
  p1NoisyFallCrossesInThirteenToSeventeenDays,
  p2RiseCrossesTheRuleAheadInTenToTwelveDays,
  p3EqualEndsWidenByOne,
  p4BeyondTheHorizonHasNoRange,
  p5LongCrossingReadsToMoreThanNinety,
  p6AlreadyPast,
  p7IntervalHoldingZeroIsNoTrend,
  p8PAboveTheLevelIsNoTrend,
  p9NothingInTheLastThreeDaysIsStale,
  theMedianSlopeDecidesTheHorizon,
} from "./degradation-trend.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.5a — the trend rule and the projection (ADR 0138, plan §4.4, R-g)", () => {
  it("P1: V2 toward 0.70 crosses in 13–17 days", () => p1NoisyFallCrossesInThirteenToSeventeenDays());
  it("P2: V7 toward a gt 8 rule crosses in 10–12 days", () => p2RiseCrossesTheRuleAheadInTenToTwelveDays());
  it("P3: V1 toward 0.70, equal ends widen to 14–15", () => p3EqualEndsWidenByOne());
  it("P4: V1 toward 0.25 is beyond the horizon", () => p4BeyondTheHorizonHasNoRange());
  it("P5: V2 toward 0.30 reads 74 to more than 90", () => p5LongCrossingReadsToMoreThanNinety());
  it("the median slope decides the horizon, not the range's min", () => theMedianSlopeDecidesTheHorizon());
  it("P6: V2 toward 0.80 is already past", () => p6AlreadyPast());
  it("P7: V9, the interval holds 0", () => p7IntervalHoldingZeroIsNoTrend());
  it("P8: V11, p is 0.087", () => p8PAboveTheLevelIsNoTrend());
  it("P9: nothing in the last 3 days is stale", () => p9NothingInTheLastThreeDaysIsStale());
  it("P10: 20 days is coverage", () => p10TwentyDaysIsCoverage());
  it("P11: quotients are rounded to 6 decimals first", () => p11QuotientsAreRoundedFirst());
  it("P12: rising health is not toward the limit", () => p12RisingHealthIsNotTowardTheLimit());
  it("a finder with no rule ahead is not toward the limit", () => aFinderWithNoRuleAheadIsNotTowardTheLimit());
  it("P13: under one day is not reported", () => p13UnderOneDayIsNotReported());
  it("low or high exactly 0 includes 0", () => anIntervalEndOfExactlyZeroIncludesZero());
  it("daysRange keeps its bounds", () => daysRangeKeepsItsBounds());
});
