import { describe, it } from "vitest";

import {
  abnormalGroupsSplitTheVerdictsAndCarryTheCounts,
  colourMaxIsTheNearestRankNinetyFifthPercentile,
  colourMaxOfASingleCellIsItsValueAndOfNoneIsZero,
  heatmapGridHasAscendingDaysTwentyFourHoursAndNullForAMissingCell,
  percentChangeIsThePercentAndNullAgainstZero,
  rankingRowsSortByKwhDescending,
  rankingRowsSortByPeakKw,
  siteStacksGiveOneStackPerColumnAndLabelOther,
  theBaselineSentenceNamesTheStepAndTheConsultedWindows,
  theChangeHasNoPercentWhenThePreviousKwhIsZero,
  theChangeIsNoPreviousForASiteAbsentFromTheCompare,
  theChangeIsNoneWithoutACompare,
} from "./energy-organization-views.spec";

/** Vitest entry point (ADR 0014). */
describe("F4.299 organization-view helpers", () => {
  it("computes a percent change and none against zero", () => {
    percentChangeIsThePercentAndNullAgainstZero();
  });
  it("sorts the ranking by kWh", () => {
    rankingRowsSortByKwhDescending();
  });
  it("sorts the ranking by peak kW", () => {
    rankingRowsSortByPeakKw();
  });
  it("has no change without a compare", () => {
    theChangeIsNoneWithoutACompare();
  });
  it("has no previous for a site absent from the compare", () => {
    theChangeIsNoPreviousForASiteAbsentFromTheCompare();
  });
  it("has no percent when the previous kWh is zero", () => {
    theChangeHasNoPercentWhenThePreviousKwhIsZero();
  });
  it("builds the heatmap grid", () => {
    heatmapGridHasAscendingDaysTwentyFourHoursAndNullForAMissingCell();
  });
  it("takes the nearest-rank P95 as the colour maximum", () => {
    colourMaxIsTheNearestRankNinetyFifthPercentile();
  });
  it("handles a single cell and no cells", () => {
    colourMaxOfASingleCellIsItsValueAndOfNoneIsZero();
  });
  it("groups the abnormal verdicts", () => {
    abnormalGroupsSplitTheVerdictsAndCarryTheCounts();
  });
  it("words the baseline sentence", () => {
    theBaselineSentenceNamesTheStepAndTheConsultedWindows();
  });
  it("builds one stack per trend column", () => {
    siteStacksGiveOneStackPerColumnAndLabelOther();
  });
});
