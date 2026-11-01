import { describe, it } from "vitest";

import {
  assertACodeRegisteredOnAnotherDomainYieldsNothing,
  assertAGroupTabKeepsTheFullList,
  assertAnAbsurdPlanStillFitsWithEverySegment,
  assertAnOverBoundPlanLowersAssetsPerPoint,
  assertAPairNeedsTheDomainListAndARegistration,
  assertAPlanWithinTheBoundIsUnchanged,
  assertARowCountAtTheBoundPasses,
  assertARowPastTheBoundThrows,
  assertASegmentWithNoPairIsAbsent,
  assertEveryWindowEdgeIsABucketMultiple,
  assertGroupSeriesGapFillsEveryPair,
  assertTheDayWindowIsAlignedToHalfHours,
  assertTheDayWindowReadsFiveMinuteRows,
  assertTheInputSegmentOrderIsKept,
  assertTheMonthWindowReadsHourRowsInHalfDayFolds,
  assertTheOverviewKeepsThreePointsPerSegment,
  assertTheSeriesCarriesTheRegistrationUnit,
  assertTheSeventhAssetIsCountedNotPaired,
  assertTheWeekWindowReadsHourRowsInThreeHourFolds,
} from "./trend-strip.pure.spec";

/**
 * `F4.301` U2 — Vitest wrapper for the trend strip's pure arithmetic (ADR 0108
 * Amendment 2). Assertions live in the sibling `.spec` (ADR 0014, AGENTS.md §4.6).
 */
describe("F4.301 — stripWindow", () => {
  it("24h ends on the last half-hour boundary and spans one day", assertTheDayWindowIsAlignedToHalfHours);
  it("24h reads _5m in 30-minute folds, 48 buckets", assertTheDayWindowReadsFiveMinuteRows);
  it("7d reads _1h in 3-hour folds, 56 buckets", assertTheWeekWindowReadsHourRowsInThreeHourFolds);
  it("30d reads _1h in 12-hour folds, 60 buckets", assertTheMonthWindowReadsHourRowsInHalfDayFolds);
  it("from and to are bucket multiples for a now that is not", assertEveryWindowEdgeIsABucketMultiple);
});

describe("F4.301 — pairsFor", () => {
  it("a pair needs the code in its domain's list and an active registration", assertAPairNeedsTheDomainListAndARegistration);
  it("a code listed under one domain but registered on another domain's asset yields nothing", assertACodeRegisteredOnAnotherDomainYieldsNothing);
  it("the overview keeps the first 3 points per segment", assertTheOverviewKeepsThreePointsPerSegment);
  it("a group tab keeps the full list", assertAGroupTabKeepsTheFullList);
  it("the 7th asset by code goes to moreAssets and no pair", assertTheSeventhAssetIsCountedNotPaired);
  it("a segment with no pair is absent", assertASegmentWithNoPairIsAbsent);
  it("the input segment order is kept", assertTheInputSegmentOrderIsKept);
  it("the point carries the catalog unit and the series the registration unit", assertTheSeriesCarriesTheRegistrationUnit);
});

describe("F4.301 — fitSeries", () => {
  it("216 planned series under a bound of 180 trim to 5 assets per point", assertAnOverBoundPlanLowersAssetsPerPoint);
  it("144 planned series are unchanged and not trimmed", assertAPlanWithinTheBoundIsUnchanged);
  it("200 segments × 3 × 1 still fit the bound with every segment present", assertAnAbsurdPlanStillFitsWithEverySegment);
});

describe("F4.301 — row bound and grouping", () => {
  it("a row count past the bound throws", assertARowPastTheBoundThrows);
  it("a row count at the bound passes", assertARowCountAtTheBoundPasses);
  it("groupSeries gap-fills every pair to the window's bucket count", assertGroupSeriesGapFillsEveryPair);
});
