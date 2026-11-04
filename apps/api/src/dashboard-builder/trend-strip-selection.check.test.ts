import { describe, it } from "vitest";

import {
  aColorKeyInPointsIsAccepted,
  aColorKeyOutsidePointsIsRefused,
  aPointInAChosenSegmentIsAccepted,
  aPointOffItsListIsRefused,
  aPointOnItsListIsAccepted,
  aPointOutsideTheChosenSegmentsIsRefused,
  aRepeatedPointIsRefused,
  aRepeatedSegmentIsRefused,
  aSegmentWithNoListIsRefused,
  aSelectionReadsTheLists,
  aSelectionWithNoSiteIsRefused,
  aStripWithoutSelectionWithNoSiteIsAccepted,
  noSelectionNeverReadsTheLists,
  pointsWithSegmentsIsAccepted,
  pointsWithoutSegmentsIsRefused,
  segmentsAllWithListsAreAccepted,
  theSameEntryInTwoWidgetsIsAccepted,
} from "./trend-strip-selection.check.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F4.306 U5 — assertTrendStripSelections checks a trend strip selection", () => {
  it("points without segments is a 400 naming the widget only", () => pointsWithoutSegmentsIsRefused());
  it("points with segments is accepted", () => pointsWithSegmentsIsAccepted());
  it("a segment with no trend-point list is a 400 naming its index", () => aSegmentWithNoListIsRefused());
  it("segments that all have a list are accepted", () => segmentsAllWithListsAreAccepted());
  it("a point outside the chosen segments is a 400 naming its index", () => aPointOutsideTheChosenSegmentsIsRefused());
  it("a point in a chosen segment is accepted", () => aPointInAChosenSegmentIsAccepted());
  it("a point off its segment's list is a 400 naming its index", () => aPointOffItsListIsRefused());
  it("a point on its segment's list is accepted", () => aPointOnItsListIsAccepted());
  it("a repeated segment is a 400 naming its index", () => aRepeatedSegmentIsRefused());
  it("a repeated point is a 400 naming its index", () => aRepeatedPointIsRefused());
  it("the same entry in two widgets is not a repeat", () => theSameEntryInTwoWidgetsIsAccepted());
  it("a colors key outside points is a 400 naming its index", () => aColorKeyOutsidePointsIsRefused());
  it("colors keys inside points are accepted", () => aColorKeyInPointsIsAccepted());
  it("a selection on a dashboard with no site is a 400 naming the widget", () => aSelectionWithNoSiteIsRefused());
  it("a strip without a selection on a dashboard with no site is accepted", () =>
    aStripWithoutSelectionWithNoSiteIsAccepted());
  it("a trend strip without a selection never reads the lists", () => noSelectionNeverReadsTheLists());
  it("a trend strip with a selection reads the lists", () => aSelectionReadsTheLists());
});
