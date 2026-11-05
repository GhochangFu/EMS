import { describe, it } from "vitest";

import {
  aDuplicateEntryBindsEachPairOnce,
  aDuplicateEntryCountsOnce,
  aGlobalAdminReadsTheSitesAssetIds,
  aGroupBindsTheAssetReadToItsMembers,
  aGroupIntersectsWithReadable,
  aGroupOfAnotherSiteIsA404,
  aGroupStripIsTheFullList,
  aLoweredCapRefusesTheStripExportBeforeTelemetry,
  aNonEmptyIntersectionReadsTelemetryOnce,
  aScopedCallerReadsTheIntersection,
  aSelectionKeepsTheScope,
  aStoredUtcReportsUtc,
  aStripExportOnAGroupOfAnotherSiteIsA404,
  aWholeSiteStripIsTheOverview,
  anEmptyIntersectionReadsNoTelemetry,
  anUnreadableSiteIsA404WithNoPoolRead,
  everySeriesHasTheWindowsBuckets,
  forSiteRunsBeforeAnyPoolRead,
  noLocationZoneUsesTheOrganizations,
  noSegmentsIsNoSelection,
  noSelectionFrameIsTheGolden,
  pointsWithSegmentsReadsTheChosenPoint,
  pointsWithoutSegmentsIsA400BeforeTelemetry,
  theRealCapAdmitsTheStripExport,
  theCsvOverASelectionCarriesOnlyTheChosenPoint,
  theExportRefusesPointsWithoutSegments,
  theStripCsvOpensWithTheZoneRow,
  theStripExportMeansAreForSitesBuckets,
  theStripSeriesCarryTheRtuAndLocationNames,
  theStripRowCountIsPairsTimesBuckets,
  theWindowIsStripWindows,
} from "./trend-strip.service.spec";

/** `F4.301` U3 — Vitest entry point for `SiteTrendStripService`. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.301 — SiteTrendStripService (ADR 0108 Amendment 2)", () => {
  describe("access before read", () => {
    it("TrendPointsService.forSite runs before any pool read", () => forSiteRunsBeforeAnyPoolRead());
    it("forSite's 404 propagates with no pool statement", () => anUnreadableSiteIsA404WithNoPoolRead());
    it("a group of another site is a 404 with no telemetry statement", () => aGroupOfAnotherSiteIsA404());
    it("a global admin reads exactly the site's asset ids, never null", () => aGlobalAdminReadsTheSitesAssetIds());
    it("a scoped caller reads the intersection", () => aScopedCallerReadsTheIntersection());
    it("an empty intersection answers segments: [] and reads no telemetry", () => anEmptyIntersectionReadsNoTelemetry());
    it("a non-empty intersection reads telemetry once", () => aNonEmptyIntersectionReadsTelemetryOnce());
    it("a group binds the asset read to the site and its members", () => aGroupBindsTheAssetReadToItsMembers());
    it("a group member the caller cannot read is dropped", () => aGroupIntersectsWithReadable());
  });

  describe("the overview rule", () => {
    it("a whole-site strip keeps the first 3 points per segment", () => aWholeSiteStripIsTheOverview());
    it("a group strip keeps the full list", () => aGroupStripIsTheFullList());
  });

  describe("the zone and the window", () => {
    it("a stored UTC reports UTC", () => aStoredUtcReportsUtc());
    it("no location zone falls to the organization's", () => noLocationZoneUsesTheOrganizations());
    it("from, to, level and bucketSeconds are stripWindow's and reach the statement", () => theWindowIsStripWindows());
    it("every series is gap-filled to the window's buckets", () => everySeriesHasTheWindowsBuckets());
    it("each series carries the RTU and location names (F4.316)", () => theStripSeriesCarryTheRtuAndLocationNames());
  });

  describe("F4.303 — the export (ADR 0108 Amendment 6 item 3)", () => {
    it("G6 each exported mean is forSite's bucket v for the same query", () => theStripExportMeansAreForSitesBuckets());
    it("G7 a group of another site is a 404 with no telemetry statement", () => aStripExportOnAGroupOfAnotherSiteIsA404());
    it("a lowered cap refuses before the telemetry statement", () => aLoweredCapRefusesTheStripExportBeforeTelemetry());
    it("the real cap admits the export and its one telemetry statement runs", () => theRealCapAdmitsTheStripExport());
    it("the row count is pairs × the window's buckets", () => theStripRowCountIsPairsTimesBuckets());
    it("the CSV opens with the zone row", () => theStripCsvOpensWithTheZoneRow());
  });

  describe("F4.306 — the widget selection (ADR 0108 Amendment 7)", () => {
    it("no selection: JSON.stringify of the frame is the frozen golden", () => noSelectionFrameIsTheGolden());
    it("points without segments is a 400 with no telemetry statement", () => pointsWithoutSegmentsIsA400BeforeTelemetry());
    it("points with segments reads the chosen point once", () => pointsWithSegmentsReadsTheChosenPoint());
    it("the export refuses points without segments", () => theExportRefusesPointsWithoutSegments());
    it("a scoped caller gets no foreign pair beside the admin's both", () => aSelectionKeepsTheScope());
    it("the CSV export over a selection carries only the chosen point", () =>
      theCsvOverASelectionCarriesOnlyTheChosenPoint());
    it("a duplicate segment or entry counts once", () => aDuplicateEntryCountsOnce());
    it("no segments is no selection; segments alone has no entries", () => noSegmentsIsNoSelection());
    it("a duplicate entry binds each pair once", () => aDuplicateEntryBindsEachPairOnce());
  });
});
