import { describe, it } from "vitest";

import * as spec from "./trend-strip.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.301 — the trend strip contract (ADR 0108 Amendment 2, ADR 0030)", () => {
  it("parses range=24h alone", () => spec.assertRange24hAloneParses());
  it("refuses range=1y", () => spec.assertRange1yIsRefused());
  it("refuses a non-uuid assetGroupId", () => spec.assertANonUuidAssetGroupIdIsRefused());
  it("refuses an unknown query key (strict)", () => spec.assertAnUnknownKeyIsRefused());
  it("parses a response with segments: []", () => spec.assertAResponseWithNoSegmentsParses());
  it("parses a response with a null bucket, moreAssets 0 and trimmed false", () =>
    spec.assertAResponseWithANullBucketParses());
  it("refuses a negative moreAssets", () => spec.assertANegativeMoreAssetsIsRefused());
  it("refuses a from that is not an ISO datetime", () => spec.assertANonDatetimeFromIsRefused());
  it("declares exactly the three ranges", () => spec.assertTheRangeTableHasExactlyThreeKeys());
  it("divides every window into at most 60 whole buckets", () => spec.assertEachRangeDividesIntoAtMost60Buckets());
  it("uses bucket widths that divide one day", () => spec.assertEachBucketWidthDividesADay());
  it("reads a level on the ADR 0023 ladder for every range", () => spec.assertEachLevelIsOnTheLadder());
  it("caps a point at 6 assets", () => spec.assertTheMaxAssetsPerPointIs6());
  it("bounds the series count at 180", () => spec.assertTheMaxSeriesIs180());
  it("shows 3 points per segment on a whole-site strip", () => spec.assertTheOverviewPointsPerSegmentIs3());
});

describe("F4.306 U2 — the selection on the trend strip query (ADR 0108 Amendment 7)", () => {
  it("parses range=24h to exactly { range: \"24h\" }", () => spec.assertRange24hParsesToExactlyTheRange());
  it("parses one segment", () => spec.assertOneSegmentParses());
  it("parses two segments", () => spec.assertTwoSegmentsParse());
  it("refuses an empty segment entry", () => spec.assertAnEmptySegmentEntryIsRefused());
  it("refuses a trailing segment comma", () => spec.assertATrailingSegmentCommaIsRefused());
  it("refuses a segment outside the catalog pattern", () => spec.assertASegmentOutsideTheCatalogPatternIsRefused());
  it("refuses an over-long segments", () => spec.assertAnOverLongSegmentsIsRefused());
  it("parses two points", () => spec.assertTwoPointsParse());
  it("refuses a bare code in points", () => spec.assertABarePointCodeIsRefused());
  it("refuses an empty points entry", () => spec.assertAnEmptyPointEntryIsRefused());
  it("parses 30 points of the longest stored length", () => spec.assertTheLongestStoredPointParses());
  it("parses points without segments (the 400 is the service's)", () => spec.assertPointsWithoutSegmentsParses());
});

describe("F4.316 — a trend strip series names its RTU and location (ADR 0111)", () => {
  it("refuses a series without assetRtuName", () => spec.assertASeriesWithoutTheRtuNameIsRefused());
  it("parses an RTU-less series", () => spec.assertAnRtuLessSeriesParses());
});
