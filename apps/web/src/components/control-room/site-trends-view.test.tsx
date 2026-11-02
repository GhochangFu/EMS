// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aFailedSegmentReadIsAFixedSentence,
  aMissingSegmentHasItsOwnSentence,
  aSegmentSubTabAsksItsSegmentAndPoint,
  anotherPointKeepsTheSegmentNavWhileItLoads,
  anotherSitesSegmentsDoNotShowWhileItLoads,
  choosingAPointWritesTheSearch,
  theBareSectionShowsEnergy,
  theNavListsOneEntryPerSegment,
  theRangeControlReachesTheEnergySubTab,
} from "./site-trends-view.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.302 the Trends & Energy section", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows Energy at the bare section and asks the default segment", async () => {
    await theBareSectionShowsEnergy();
  });

  it("lists Energy, then one entry per segment of the response", async () => {
    await theNavListsOneEntryPerSegment();
  });

  it("asks a segment sub-tab's segment and point and draws it", async () => {
    await aSegmentSubTabAsksItsSegmentAndPoint();
  });

  it("writes a chosen point to the search", async () => {
    await choosingAPointWritesTheSearch();
  });

  it("hands the range control's value to the Energy sub-tab", async () => {
    await theRangeControlReachesTheEnergySubTab();
  });

  it("renders a fixed sentence when the segment read fails", async () => {
    await aFailedSegmentReadIsAFixedSentence();
  });

  it("renders its own sentence for a segment not at the site", async () => {
    await aMissingSegmentHasItsOwnSentence();
  });

  it("lists none of the previous site's segments while another site loads", async () => {
    await anotherSitesSegmentsDoNotShowWhileItLoads();
  });

  it("keeps the segment nav while another point of the same site loads", async () => {
    await anotherPointKeepsTheSegmentNavWhileItLoads();
  });
});
