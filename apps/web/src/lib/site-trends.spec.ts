import { expect } from "vitest";

import type { SegmentAbnormalEntryDto, SegmentViewRankingEntryDto } from "@bms/shared";

import {
  ENERGY_VIEW,
  compareSpanMs,
  historyHrefFor,
  meanChangePct,
  pointFromSearch,
  segmentBaselineSentence,
  segmentChartSeries,
  segmentVerdictSentence,
  segmentViewsQueryOf,
  siteEnergyQueryOf,
  sortRanking,
  trendsSearch,
  viewFromSearch,
} from "./site-trends";

/**
 * `F4.302` U4 (ADR 0108 Amendment 4 items 3, 7, 8) — the Trends & Energy section's pure rules.
 * Entry point: `site-trends.test.ts` (node environment).
 */

const SITE = "11111111-1111-4111-8111-111111111111";
const ASSET_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ASSET_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ASSET_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function entry(
  assetId: string,
  assetCode: string,
  mean: number,
  max: number,
  fields: Partial<SegmentViewRankingEntryDto> = {},
): SegmentViewRankingEntryDto {
  return {
    assetId,
    assetCode,
    assetName: `Asset ${assetCode}`,
    unit: "kW",
    current: { mean, max, maxAt: null, sampleCount: 10 },
    compare: null,
    buckets: null,
    compareBuckets: null,
    ...fields,
  };
}

function abnormal(fields: Partial<SegmentAbnormalEntryDto>): SegmentAbnormalEntryDto {
  return {
    assetId: ASSET_A,
    assetCode: "A1",
    assetName: "Asset A1",
    unit: "kW",
    currentMean: 30,
    baselineMean: 20,
    ratio: 1.5,
    verdict: "above",
    baselineWindows: 4,
    ...fields,
  };
}

/** The Energy sub-tab names the site and never an organization (item 3). Mutation: set `organizationId`. */
export function siteEnergyQueryNamesTheSiteOnly(): void {
  const query = siteEnergyQueryOf(SITE, { range: "7d", compare: "previous" });
  expect(query).toEqual({ range: "7d", locationIds: [SITE], compare: "previous" });
  expect(query !== null && "organizationId" in query).toBe(false);
}

/** A custom range sends both ends; without both there is no valid query. */
export function siteEnergyQueryCarriesACustomRangeOrNothing(): void {
  expect(
    siteEnergyQueryOf(SITE, { range: "custom", from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z" }),
  ).toEqual({
    range: "custom",
    locationIds: [SITE],
    from: "2026-10-01T00:00:00.000Z",
    to: "2026-10-02T00:00:00.000Z",
  });
  expect(siteEnergyQueryOf(SITE, { range: "custom", from: "2026-10-01T00:00:00.000Z" })).toBeNull();
}

/** `?view=` is `energy` when absent or not a catalog code; else the domain code as given. */
export function viewFromSearchDefaultsToEnergy(): void {
  expect(ENERGY_VIEW).toBe("energy");
  expect(viewFromSearch(new URLSearchParams(""))).toBe(ENERGY_VIEW);
  expect(viewFromSearch(new URLSearchParams("view=bad code"))).toBe(ENERGY_VIEW);
  expect(viewFromSearch(new URLSearchParams("view=chillers"))).toBe("chillers");
}

/** `?point=` is a catalog code or absent. */
export function pointFromSearchReadsACatalogCode(): void {
  expect(pointFromSearch(new URLSearchParams("point=kw"))).toBe("kw");
  expect(pointFromSearch(new URLSearchParams("point=a%20b"))).toBeUndefined();
  expect(pointFromSearch(new URLSearchParams(""))).toBeUndefined();
}

/** The sub-tab search: none for Energy, the view then the point for a segment. */
export function trendsSearchHoldsIdsAndCodesOnly(): void {
  expect(trendsSearch(ENERGY_VIEW)).toBe("");
  expect(trendsSearch("chillers")).toBe("?view=chillers");
  expect(trendsSearch("chillers", "kw")).toBe("?view=chillers&point=kw");
}

/** On Energy the segment read asks the default segment, so the nav is known (plan C9). */
export function segmentQueryOnEnergyAsksTheDefaultSegment(): void {
  expect(segmentViewsQueryOf(ENERGY_VIEW, "kw", { range: "24h" })).toEqual({ range: "24h" });
}

/** On a segment the read names the segment, the point and the compare. */
export function segmentQueryNamesTheSegmentAndPoint(): void {
  expect(segmentViewsQueryOf("chillers", "kw", { range: "30d", compare: "previous" })).toEqual({
    range: "30d",
    segment: "chillers",
    point: "kw",
    compare: "previous",
  });
  expect(segmentViewsQueryOf("chillers", undefined, { range: "custom" })).toBeNull();
}

/** The click lands on the exact window (item 7). */
export function historyHrefCarriesTheWindowThePointAndCompare(): void {
  const period = { from: "2026-10-30T00:00:00.000Z", to: "2026-10-30T23:59:59.999Z" };
  const href = historyHrefFor(ASSET_A, period, "kw", true);
  const url = new URL(href, "http://x");
  expect(url.pathname).toBe(`/asset-history/${ASSET_A}`);
  expect([...url.searchParams.entries()]).toEqual([
    ["from", period.from],
    ["to", period.to],
    ["points", "kw"],
    ["compare", "1"],
  ]);
  expect(new URL(historyHrefFor(ASSET_A, period, "kw", false), "http://x").searchParams.has("compare")).toBe(false);
}

/** The compare span is current start minus compare start; 0 without a compare period. */
export function compareSpanIsTheGapBetweenTheStarts(): void {
  expect(
    compareSpanMs(
      { from: "2026-10-30T00:00:00.000Z", to: "x", durationHours: 24 },
      { from: "2026-10-29T00:00:00.000Z", to: "x", durationHours: 24 },
    ),
  ).toBe(86_400_000);
  expect(compareSpanMs({ from: "2026-10-30T00:00:00.000Z", to: "x", durationHours: 24 }, null)).toBe(0);
}

/** One solid series per drawn asset, and its compare dashed and shifted by `+span` (`shiftCompareBuckets`). */
export function chartSeriesShiftTheCompareBySpan(): void {
  const drawn = entry(ASSET_A, "A1", 5, 9, {
    buckets: [{ t: "2026-10-30T00:00:00.000Z", v: 5 }],
    compareBuckets: [{ t: "2026-10-29T00:00:00.000Z", v: 4 }],
  });
  const series = segmentChartSeries([drawn, entry(ASSET_B, "B1", 1, 2)], 86_400_000);
  expect(series.map((s) => [s.assetId, s.dashed, s.data])).toEqual([
    [ASSET_A, false, [["2026-10-30T00:00:00.000Z", 5]]],
    [ASSET_A, true, [["2026-10-30T00:00:00.000Z", 4]]],
  ]);
}

/** Mean is the server's order kept; max sorts by max descending, ties by code. */
export function sortRankingByMeanOrMax(): void {
  const rows = [entry(ASSET_A, "A1", 9, 1), entry(ASSET_C, "C1", 5, 7), entry(ASSET_B, "B1", 3, 7)];
  expect(sortRanking(rows, "mean").map((r) => r.assetCode)).toEqual(["A1", "C1", "B1"]);
  expect(sortRanking(rows, "max").map((r) => r.assetCode)).toEqual(["B1", "C1", "A1"]);
}

/** The change shows only with a compare row; a zero previous mean has no percent. */
export function meanChangeNeedsACompareRow(): void {
  const stats = (mean: number) => ({ mean, max: mean, maxAt: null, sampleCount: 1 });
  expect(meanChangePct(entry(ASSET_A, "A1", 12, 1, { compare: stats(10) }))).toBeCloseTo(20);
  expect(meanChangePct(entry(ASSET_A, "A1", -30, 1, { compare: stats(-20) }))).toBeCloseTo(-50);
  expect(meanChangePct(entry(ASSET_A, "A1", 12, 1, { compare: stats(0) }))).toBeNull();
  expect(meanChangePct(entry(ASSET_A, "A1", 12, 1))).toBeUndefined();
}

/** The four verdict sentences; two negatives say they compare by magnitude. */
export function verdictSentencesNameTheVerdict(): void {
  expect(segmentVerdictSentence(abnormal({ ratio: 1.62 }))).toBe("1.62× the baseline — above its normal");
  expect(segmentVerdictSentence(abnormal({ verdict: "below", ratio: 0.4 }))).toBe(
    "0.40× the baseline — below its normal",
  );
  expect(segmentVerdictSentence(abnormal({ currentMean: -30, baselineMean: -20 }))).toBe(
    "1.50× the baseline by magnitude (both negative) — above its normal",
  );
  expect(segmentVerdictSentence(abnormal({ verdict: "not_comparable", ratio: null }))).toBe(
    "Not comparable — the baseline is near zero or of the opposite sign",
  );
  expect(segmentVerdictSentence(abnormal({ verdict: "not_enough_history", ratio: null, baselineWindows: 2 }))).toBe(
    "Not enough history — 2 of 4 windows hold enough data; 3 are needed",
  );
}

/** The baseline line names both sides of the band and the windows. */
export function baselineSentenceNamesBothSides(): void {
  const base = { windows: 4, windowsConsulted: 4, stepDays: 1, ratio: 1.5, belowRatio: 0.5, nearZeroFraction: 0.01 };
  expect(segmentBaselineSentence(base)).toBe(
    "≥ 50 % above or ≥ 50 % below the median of the same window on the 4 preceding days",
  );
  expect(segmentBaselineSentence({ ...base, stepDays: 7 })).toBe(
    "≥ 50 % above or ≥ 50 % below the median of the same window in the 4 preceding 7-day windows",
  );
  expect(segmentBaselineSentence({ ...base, windowsConsulted: 2 })).toBe(
    "≥ 50 % above or ≥ 50 % below the median of the same window; only 2 of 4 windows is within the retained history at this detail level",
  );
}
