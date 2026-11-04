import { describe, it } from "vitest";

import {
  aSegmentWithNothingDrawnHasNoPrefill,
  aSegmentWithoutAPointHasNoPrefill,
  aWholeOrganizationFilterHasNoLocations,
  compareOnIsCarried,
  historyCompareOffStaysOff,
  historyIsATrendPointsPrefill,
  historyKeepsAtMostEightPoints,
  noOrganizationIsInvented,
  segmentIsTheDrawnPairsAtTheSite,
  theFiltersLocationsAreCarried,
  theTemplateLineNamesTheArm,
} from "./schedule-from-view.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6). */
describe("F4.303 U16 schedule from a view: the prefill", () => {
  it("a whole-organization filter has no locations and compare off", () => aWholeOrganizationFilterHasNoLocations());
  it("compare on is carried", () => compareOnIsCarried());
  it("the filter's locations are carried", () => theFiltersLocationsAreCarried());
  it("no organization is invented", () => noOrganizationIsInvented());
  it("asset history is a trend_points prefill", () => historyIsATrendPointsPrefill());
  it("history compare off stays off", () => historyCompareOffStaysOff());
  it("history keeps at most eight points", () => historyKeepsAtMostEightPoints());
  it("a segment sub-tab is its drawn pairs at the site", () => segmentIsTheDrawnPairsAtTheSite());
  it("a segment without a point has no prefill", () => aSegmentWithoutAPointHasNoPrefill());
  it("a segment with nothing drawn has no prefill", () => aSegmentWithNothingDrawnHasNoPrefill());
  it("the template line names the arm", () => theTemplateLineNamesTheArm());
});
