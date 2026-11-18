import { describe, it } from "vitest";

import {
  aDaysValueIsScoreAssetsScore,
  anUnruledDayHasNoValue,
  aRisingScoreAndOutsideRowsGiveNothing,
  noFairBandMeansNoIndicator,
  p1FromTheCounters,
  slopePerWeekIsSlopeTimesSeven,
  theBandWordIsTheNextBandsLabel,
  weightsChangeTheDailyScore,
} from "./degradation-health.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.5a — health trend (ADR 0138, plan §4.5)", () => {
  it("a day's value is scoreAsset's score for the same counts", () => aDaysValueIsScoreAssetsScore());
  it("weights { a: 3, b: 1 } change the daily score", () => weightsChangeTheDailyScore());
  it("a day whose only tag is unruled has no value", () => anUnruledDayHasNoValue());
  it("no health, no fair band, or fair last → no indicator", () => noFairBandMeansNoIndicator());
  it("the band word is the next band's label ('reaches Degraded')", () => theBandWordIsTheNextBandsLabel());
  it("P1 from the counters: 13–17 days to Poor", () => p1FromTheCounters());
  it("slopePerWeek is slope × 7", () => slopePerWeekIsSlopeTimesSeven());
  it("a rising score and rows outside the window give nothing extra", () => aRisingScoreAndOutsideRowsGiveNothing());
});
