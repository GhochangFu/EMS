import { describe, it } from "vitest";

import {
  assertA46DayCustomRangeIsHourLevelDayBucket,
  assertADaySeriesIsFilledByLocalMidnight,
  assertALevelSeriesIsGapFilled,
  assertAPointOutsideTheListIsA404,
  assertAWindowPastRetentionIsDropped,
  assertAnAssetWithoutACurrentRowIsNotRanked,
  assertAnUnknownSegmentIsA404,
  assertCandidatesAreTheSegmentsRegistrations,
  assertCompareIsNullWithoutAPreviousRow,
  assertEightAssetsAreNotTrimmed,
  assertNoSegmentPresentIsNull,
  assertOlderStartIsTheOldestConsultedWindow,
  assertReadWindowsCarryCurrentCompareAndBaseline,
  assertSegmentsFollowForSiteOrder,
  assertTheDefaultPointIsTheFirstOfTheList,
  assertTheDefaultSegmentIsTheFirstPresent,
  assertTheRankingIsByMeanThenCode,
  assertTheRankingIsCutAtFifty,
  assertTheTopEightDrawSeries,
} from "./segment-views.pure.spec";

/** `F4.302` U2 — Vitest entry point for the segment view's pure rules. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.302 — the segment view's pure rules (ADR 0108 Amendment 4 items 2 and 4)", () => {
  describe("segments and points", () => {
    it("the segments are the rows' distinct domains in forSite order, with an asset count", () =>
      assertSegmentsFollowForSiteOrder());
    it("the default segment is the first present one", () => assertTheDefaultSegmentIsTheFirstPresent());
    it("no segment present and none asked is null", () => assertNoSegmentPresentIsNull());
    it("an unknown segment is the 404", () => assertAnUnknownSegmentIsA404());
    it("the default point is the first of the effective list", () => assertTheDefaultPointIsTheFirstOfTheList());
    it("a point outside the segment's list is the 404", () => assertAPointOutsideTheListIsA404());
    it("the candidates are the segment's assets registering the point", () =>
      assertCandidatesAreTheSegmentsRegistrations());
  });

  describe("the ranking", () => {
    it("ranks by mean descending, ties by code", () => assertTheRankingIsByMeanThenCode());
    it("an asset without a current row is not ranked", () => assertAnAssetWithoutACurrentRowIsNotRanked());
    it("60 ranked assets send 50 with moreAssets 10", () => assertTheRankingIsCutAtFifty());
    it("the top 8 draw series and trimmed is set", () => assertTheTopEightDrawSeries());
    it("8 ranked assets are not trimmed", () => assertEightAssetsAreNotTrimmed());
    it("compare is null without an idx -1 row", () => assertCompareIsNullWithoutAPreviousRow());
  });

  describe("the range frame", () => {
    it("olderStart is the oldest consulted window's start", () => assertOlderStartIsTheOldestConsultedWindow());
    it("a 46-day custom range is 1h level, 1d bucket", () => assertA46DayCustomRangeIsHourLevelDayBucket());
    it("a window past retention is dropped", () => assertAWindowPastRetentionIsDropped());
    it("statement A's windows are current, compare, then the consulted baseline", () =>
      assertReadWindowsCarryCurrentCompareAndBaseline());
  });

  describe("the display series", () => {
    it("a level bucket is gap-filled with null", () => assertALevelSeriesIsGapFilled());
    it("a 1d bucket is filled by local midnight", () => assertADaySeriesIsFilledByLocalMidnight());
  });
});
