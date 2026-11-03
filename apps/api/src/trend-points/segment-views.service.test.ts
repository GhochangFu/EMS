import { describe, it } from "vitest";

import {
  aForeignSiteIsA404WithNoStatement,
  aGlobalAdminBindsTheExplicitList,
  aPointOutsideTheSegmentIsA404,
  aScopedCallerSeesOnlyReadableAssets,
  anEmptyScopeSendsNoTelemetryStatement,
  anUnknownSegmentIsA404BeforeTheScope,
  compareRidesInStatementA,
  exactlyTwoStatementsWithCompare,
  exactlyTwoStatementsWithoutCompare,
  forSiteRunsFirst,
  noCandidateSendsNoTelemetryStatement,
  onlyTheTopEightCarryBuckets,
  sixtyCandidatesAreCapped,
  theAbnormalListJudgesStatementA,
  theDefaultSegmentIsTheFirstPresent,
  theResponseParses,
  withoutCompareEveryEntryCompareIsNull,
  aSegmentExportOfAForeignSiteIsA404WithNoStatement,
  aSegmentExportOfAnUnknownSegmentIsA404,
  aLoweredCapRefusesTheSegmentExportBeforeTelemetry,
  theRealCapAdmitsTheSegmentExport,
  onlyTheDrawnEntriesAreExported,
  theSegmentRowCountIsSeriesTimesBucketsTimesPeriods,
  theSegmentCsvOpensWithTheZoneRow,
} from "./segment-views.service.spec";

/** `F4.302` U2 — Vitest entry point for `SiteSegmentViewsService`. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.302 — SiteSegmentViewsService (ADR 0108 Amendment 4 items 4–5)", () => {
  describe("access before read", () => {
    it("TrendPointsService.forSite runs first", () => forSiteRunsFirst());
    it("a foreign site is a 404 with no statement", () => aForeignSiteIsA404WithNoStatement());
    it("an unknown segment is a 404 before the scope", () => anUnknownSegmentIsA404BeforeTheScope());
    it("a point outside the segment's list is a 404 before the scope", () => aPointOutsideTheSegmentIsA404());
    it("a global admin binds the explicit candidate list and the point", () => aGlobalAdminBindsTheExplicitList());
    it("a scoped caller binds, ranks and judges only readable assets", () => aScopedCallerSeesOnlyReadableAssets());
    it("an empty scope sends no telemetry statement", () => anEmptyScopeSendsNoTelemetryStatement());
    it("no candidate sends no telemetry statement", () => noCandidateSendsNoTelemetryStatement());
  });

  describe("two statements", () => {
    it("exactly two without compare", () => exactlyTwoStatementsWithoutCompare());
    it("exactly two with compare", () => exactlyTwoStatementsWithCompare());
    it("the compare window rides in statement A", () => compareRidesInStatementA());
    it("without compare every entry's compare is null", () => withoutCompareEveryEntryCompareIsNull());
  });

  describe("caps and assembly", () => {
    it("60 candidates rank 50, moreAssets 10, 8 series, trimmed", () => sixtyCandidatesAreCapped());
    it("only the top 8 carry buckets", () => onlyTheTopEightCarryBuckets());
    it("the default segment is the first present, in forSite order", () => theDefaultSegmentIsTheFirstPresent());
    it("the abnormal list judges statement A's rows", () => theAbnormalListJudgesStatementA());
    it("the response parses, in the site zone", () => theResponseParses());
  });

  describe("F4.303 — the export (ADR 0108 Amendment 6 item 3)", () => {
    it("a foreign site is a 404 with no statement", () => aSegmentExportOfAForeignSiteIsA404WithNoStatement());
    it("an unknown segment is a 404 before the scope", () => aSegmentExportOfAnUnknownSegmentIsA404());
    it("a lowered cap refuses before statement A", () => aLoweredCapRefusesTheSegmentExportBeforeTelemetry());
    it("the real cap admits the export and the read's two statements run", () => theRealCapAdmitsTheSegmentExport());
    it("G3 only the drawn entries are exported", () => onlyTheDrawnEntriesAreExported());
    it("the row count is series max × buckets × periods", () => theSegmentRowCountIsSeriesTimesBucketsTimesPeriods());
    it("the CSV opens with the zone row", () => theSegmentCsvOpensWithTheZoneRow());
  });
});
