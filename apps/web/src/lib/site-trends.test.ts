import { describe, it } from "vitest";

import {
  baselineSentenceNamesBothSides,
  chartSeriesShiftTheCompareBySpan,
  chartSeriesCarryTheAssetLabel,
  chartSeriesLabelAnRtuLessAssetByItsLocation,
  sortRankingTieStaysByCode,
  compareSpanIsTheGapBetweenTheStarts,
  historyHrefCarriesTheWindowThePointAndCompare,
  meanChangeNeedsACompareRow,
  pointFromSearchReadsACatalogCode,
  segmentQueryNamesTheSegmentAndPoint,
  segmentQueryOnEnergyAsksTheDefaultSegment,
  siteEnergyQueryCarriesACustomRangeOrNothing,
  siteEnergyQueryNamesTheSiteOnly,
  sortRankingByMeanOrMax,
  verdictSentencesNameTheVerdict,
  viewFromSearchDefaultsToEnergy,
} from "./site-trends.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6). */
describe("F4.302 the Trends & Energy section's pure rules", () => {
  it("builds the Energy sub-tab query from the site alone, never an organization", () => {
    siteEnergyQueryNamesTheSiteOnly();
  });

  it("carries a custom range's two ends, or asks nothing without both", () => {
    siteEnergyQueryCarriesACustomRangeOrNothing();
  });

  it("reads ?view= as energy by default and a domain code otherwise", () => {
    viewFromSearchDefaultsToEnergy();
  });

  it("reads ?point= as a catalog code or nothing", () => {
    pointFromSearchReadsACatalogCode();
  });

  it("asks the default segment on the Energy sub-tab", () => {
    segmentQueryOnEnergyAsksTheDefaultSegment();
  });

  it("names the segment, the point and the compare on a segment sub-tab", () => {
    segmentQueryNamesTheSegmentAndPoint();
  });

  it("links an asset to its history over the exact window", () => {
    historyHrefCarriesTheWindowThePointAndCompare();
  });

  it("measures the compare span between the two starts", () => {
    compareSpanIsTheGapBetweenTheStarts();
  });

  it("draws the compare dashed and shifted by +span", () => {
    chartSeriesShiftTheCompareBySpan();
  });

  it("sorts the ranking by mean or by max, ties by code", () => {
    sortRankingByMeanOrMax();
  });

  it("labels a line and its previous period <code> · <RTU> (F4.316)", () => {
    chartSeriesCarryTheAssetLabel();
  });

  it("labels an RTU-less asset's line <code> · <location> (F4.316)", () => {
    chartSeriesLabelAnRtuLessAssetByItsLocation();
  });

  it("keeps a max tie on one code in the server's order, not by RTU name (F4.316)", () => {
    sortRankingTieStaysByCode();
  });

  it("shows a change only with a previous-period row", () => {
    meanChangeNeedsACompareRow();
  });

  it("writes one sentence per verdict", () => {
    verdictSentencesNameTheVerdict();
  });

  it("writes the baseline line with both sides of the band", () => {
    baselineSentenceNamesBothSides();
  });
});
