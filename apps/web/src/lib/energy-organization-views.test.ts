import { describe, it } from "vitest";

import {
  abnormalGroupsSplitTheVerdictsAndCarryTheCounts,
  colourMaxIsTheNearestRankNinetyFifthPercentile,
  colourMaxOfASingleCellIsItsValueAndOfNoneIsZero,
  heatmapGridHasAscendingDaysTwentyFourHoursAndNullForAMissingCell,
  aKwhPerM2TieFallsToTheNameThenTheId,
  aNoAreaSiteIsNeverRankedAsZero,
  percentChangeIsThePercentAndNullAgainstZero,
  rankingRowsSortByKwhDescending,
  rankingRowsSortByKwhPerM2WithNoAreaLast,
  rankingRowsSortByPeakKw,
  siteStacksGiveOneStackPerColumnAndLabelOther,
  theBaselineSentenceNamesTheStepAndTheConsultedWindows,
  theKwhModeIgnoresTheArea,
  theNoAreaSitesKeepTheServersOrder,
  thePeakKwModeIgnoresTheArea,
  theChangeIsNoPreviousWhenThePreviousKwhIsNegative,
  theChangeIsNoPreviousWhenThePreviousKwhIsZero,
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
  it("F4.304 K1: sorts by kWh per m² with the no-area sites last", () => {
    rankingRowsSortByKwhPerM2WithNoAreaLast();
  });
  it("F4.304 K2: never ranks a no-area site as a zero", () => {
    aNoAreaSiteIsNeverRankedAsZero();
  });
  it("F4.304 K3: breaks a kWh per m² tie by name, then by location id", () => {
    aKwhPerM2TieFallsToTheNameThenTheId();
  });
  it("F4.304 K4: keeps the server's order for the no-area sites", () => {
    theNoAreaSitesKeepTheServersOrder();
  });
  it("F4.304 K5: the kWh mode ignores the area", () => {
    theKwhModeIgnoresTheArea();
  });
  it("F4.304 K5: the peak kW mode ignores the area", () => {
    thePeakKwModeIgnoresTheArea();
  });
  it("has no change without a compare", () => {
    theChangeIsNoneWithoutACompare();
  });
  it("has no previous for a site absent from the compare", () => {
    theChangeIsNoPreviousForASiteAbsentFromTheCompare();
  });
  it("has no previous when the previous kWh is zero", () => {
    theChangeIsNoPreviousWhenThePreviousKwhIsZero();
  });
  it("has no previous when the previous kWh is below zero", () => {
    theChangeIsNoPreviousWhenThePreviousKwhIsNegative();
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
