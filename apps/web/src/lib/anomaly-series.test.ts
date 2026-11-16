import { describe, it } from "vitest";

import {
  anHourOutsideTheWindowIsDropped,
  anomalyAppliesBesideAvgUpTo31Days,
  theCaptionIsAdvisory,
  theDetectorLabels,
  theLargerOfTwoDetectorsWins,
  theLineIsInclusive,
  theMarkSeriesIsOneScatterAtTheHourStart,
  theMarksTooltipNamesScoreDetectorsAndPoints,
  theWindowIsWholeHoursWithinTheCap,
} from "./anomaly-series.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E1.2b — the unusual-hour marks (ADR 0135 Amendment 5 ruling 4(b))", () => {
  it("per hour the larger of two detectors wins", () => theLargerOfTwoDetectorsWins());
  it("0.99 is unusual and 0.9899 is not", () => theLineIsInclusive());
  it("an hour outside the window is dropped", () => anHourOutsideTheWindowIsDropped());
  it("the detector labels, unknown as stored", () => theDetectorLabels());
  it("R14: marks apply beside avg on a window of at most 31 days", () => anomalyAppliesBesideAvgUpTo31Days());
  it("the read's window is whole hours within the route's cap", () => theWindowIsWholeHoursWithinTheCap());
  it("the mark series is one scatter at each hour's start", () => theMarkSeriesIsOneScatterAtTheHourStart());
  it("a mark's tooltip names the score, the detectors and the points", () =>
    theMarksTooltipNamesScoreDetectorsAndPoints());
  it("the caption is advisory", () => theCaptionIsAdvisory());
});
