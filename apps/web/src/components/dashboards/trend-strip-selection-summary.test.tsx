// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aColourIsDroppedWithItsPoint,
  aStyleIsDroppedWithItsPoint,
  aListedPointShowsNeither,
  aStalePointShowsTheMarkerAndARemove,
  aStaleSegmentShowsTheMarker,
  cleanupSelectionSummary,
  clearSelectionWritesEveryFieldUndefined,
  eachPointShowsItsColourRole,
  noLocationReadsNothing,
  removingAStaleSegmentDropsItsPointsAndColours,
  removingTheLastPointWritesUndefined,
} from "./trend-strip-selection-summary.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom
 * docblock is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F4.306 U10 TrendStripSelectionSummary", () => {
  afterEach(() => {
    cleanupSelectionSummary();
  });

  it("marks a stored point that is not on its segment's list and offers Remove", async () => {
    await aStalePointShowsTheMarkerAndARemove();
  });

  it("shows a listed point by name with no marker and no Remove", async () => {
    await aListedPointShowsNeither();
  });

  it("marks a stored segment the site no longer lists", async () => {
    await aStaleSegmentShowsTheMarker();
  });

  it("shows each point's colour role, or Default", async () => {
    await eachPointShowsItsColourRole();
  });

  it("writes stripPoints undefined, not [], when the last point is removed", async () => {
    await removingTheLastPointWritesUndefined();
  });

  it("drops a point's style with the point (F4.323)", async () => {
    await aStyleIsDroppedWithItsPoint();
  });

  it("drops a point's colour with the point", async () => {
    await aColourIsDroppedWithItsPoint();
  });

  it("drops a removed segment's points and colours", async () => {
    await removingAStaleSegmentDropsItsPointsAndColours();
  });

  it("clears all three fields to undefined", async () => {
    await clearSelectionWritesEveryFieldUndefined();
  });

  it("shows one sentence and reads nothing without a site", async () => {
    await noLocationReadsNothing();
  });
});
