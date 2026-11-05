// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { useAuthStore } from "../../stores/auth-store";
import {
  aFailedSegmentReadIsAFixedSentence,
  aSegmentSubTabExportsItsSegmentView,
  exportSitsBesideCopyLink,
  theEnergySubTabExportsTheSiteEnergyView,
  aMissingSegmentHasItsOwnSentence,
  aRangeChangeIsWrittenToTheUrl,
  aSegmentSubTabAsksItsSegmentAndPoint,
  aSortChangeIsWrittenToTheUrl,
  anotherPointKeepsTheSegmentNavWhileItLoads,
  anotherSitesSegmentsDoNotShowWhileItLoads,
  choosingAPointWritesTheSearch,
  copyLinkSitsBesideTheRangeControls,
  theBareSectionShowsEnergy,
  theNavKeepsTheRange,
  theNavListsOneEntryPerSegment,
  theRangeControlReachesTheEnergySubTab,
  theSectionStateIsReadFromTheUrl,
  aSegmentSubTabOffersPin,
  aSegmentSubTabLegendReadsTheAssetLabel,
  aSegmentSubTabOffersSchedule,
  theEnergySubTabSchedulesTheSitesEnergyReport,
  theEnergySubTabHasNoPin,
} from "./site-trends-view.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.302 the Trends & Energy section", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAuthStore.setState({ user: null });
  });

  it("F4.303 U15: a segment sub-tab offers Pin", async () => {
    await aSegmentSubTabOffersPin();
  });

  it("F4.316: a segment sub-tab's legend reads <code> · <RTU>", async () => {
    await aSegmentSubTabLegendReadsTheAssetLabel();
  });

  it("F4.303 U16: the Energy sub-tab schedules the site energy report", async () => {
    await theEnergySubTabSchedulesTheSitesEnergyReport();
  });

  it("F4.303 U16: a segment sub-tab offers one Schedule", async () => {
    await aSegmentSubTabOffersSchedule();
  });

  it("F4.303 U15: the Energy sub-tab has no Pin", async () => {
    await theEnergySubTabHasNoPin();
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

  it("F4.303 T1: reads the range, the custom instants, compare and rankBy from the URL", async () => {
    await theSectionStateIsReadFromTheUrl();
  });

  it("F4.303 T1: writes a range change to the URL", async () => {
    await aRangeChangeIsWrittenToTheUrl();
  });

  it("F4.303 T1: writes the ranking sort to the URL", async () => {
    await aSortChangeIsWrittenToTheUrl();
  });

  it("F4.303 T2: keeps the range on every nav entry", async () => {
    await theNavKeepsTheRange();
  });

  it("F4.303 T3: puts Copy link at the end of the control row", async () => {
    await copyLinkSitsBesideTheRangeControls();
  });

  it("F4.303 U7: puts Export before Copy link in the control row", async () => {
    await exportSitsBesideCopyLink();
  });

  it("F4.303 U7: the Energy sub-tab exports the site's energy view", async () => {
    await theEnergySubTabExportsTheSiteEnergyView();
  });

  it("F4.303 U7: a segment sub-tab exports its segment view", async () => {
    await aSegmentSubTabExportsItsSegmentView();
  });
});
