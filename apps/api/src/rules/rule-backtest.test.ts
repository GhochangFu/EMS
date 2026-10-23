import { describe, it } from "vitest";

import {
  aBucketWithNoSamplesIsSkipped,
  aFirstBucketThatMatchesCounts,
  anEmptySeriesCountsZero,
  aTimestampGapClearsByElapsedTime,
  oneExcursionCountsOnce,
  theLtDirectionCountsADip,
  theMeanIsWhatIsCompared,
  twoExcursionsApartByTheHoldCountTwice,
  twoExcursionsInsideTheHoldCountOnce,
} from "./rule-backtest.spec";

/** `F4.278` — Vitest entry point for the 7-day backtest core. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.278 — the 7-day rule backtest (ADR 0099 Amendment 8, Q9)", () => {
  it("one excursion counts once", () => oneExcursionCountsOnce());
  it("two excursions apart by the hold count twice", () => twoExcursionsApartByTheHoldCountTwice());
  it("two excursions inside the hold count once", () => twoExcursionsInsideTheHoldCountOnce());
  it("an empty series counts zero", () => anEmptySeriesCountsZero());
  it("a timestamp gap clears by elapsed time", () => aTimestampGapClearsByElapsedTime());
  it("the lt direction counts a dip", () => theLtDirectionCountsADip());
  it("a first bucket that matches counts", () => aFirstBucketThatMatchesCounts());
  it("the bucket mean is what is compared", () => theMeanIsWhatIsCompared());
  it("a bucket with no samples is skipped", () => aBucketWithNoSamplesIsSkipped());
});
