import { describe, it } from "vitest";

import * as spec from "./view-export.serialise.spec";

/** `F4.303` U2 — Vitest entry point. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.303 — the pure view export module (ADR 0108 Amendment 6 item 3)", () => {
  it("the CSV quotes a formula leader and leaves a null empty", () => spec.theCsvQuotesAFormulaLeaderAndLeavesNullEmpty());
  it("the XLSX holds a formula leader as a string with no formula", () => spec.theXlsxHoldsAFormulaLeaderAsAString());
  it("the XLSX has one sheet named Export", () => spec.theXlsxHasOneSheetNamedExport());
  it("the CSV writer refuses NaN", () => spec.theCsvWriterRefusesNaN());
  it("the XLSX writer refuses NaN", () => spec.theXlsxWriterRefusesNaN());
  it("the cap refuses 50 001 rows with the owner's sentence", () => spec.theCapSentenceIsTheOwnersAbove());
  it("the cap admits exactly 50 000 rows", () => spec.theCapAdmitsExactlyTheLimit());
  it("the cap takes a lowered cap", () => spec.theCapTakesALoweredCap());
  it("the aggregate range rules have one copy in the shared source", () => spec.theRangeRulesHaveOneCopyInTheSource());
  it("isoInZone writes Asia/Kolkata", () => spec.isoInZoneWritesKolkata());
  it("isoInZone writes Etc/UTC as +00:00", () => spec.isoInZoneWritesUtcAsZeroOffset());
  it("isoInZone writes America/New_York in winter", () => spec.isoInZoneWritesNewYorkWinter());
  it("isoInZone writes midnight as hour 00", () => spec.isoInZoneWritesMidnightAsHourZero());
  it("energy rows open with the header block", () => spec.energyRowsOpenWithTheHeaderBlock());
  it("energy rows hold three source rows per bucket per period", () => spec.energyRowsHaveThreeSourceRowsPerBucketPerPeriod());
  it("energy rows hold one site row per column per bucket, current only", () =>
    spec.energyRowsHaveOneSiteRowPerColumnPerBucketForCurrentOnly());
  it("segment rows open with the header block", () => spec.segmentRowsOpenWithTheHeaderBlock());
  it("segment rows hold only drawn entries", () => spec.segmentRowsHoldOnlyDrawnEntries());
  it("strip rows open with the header block", () => spec.stripRowsOpenWithTheHeaderBlock());
  it("strip rows hold one per segment, point, asset and bucket", () => spec.stripRowsHoldOnePerSegmentPointAssetBucket());
  it("history rows open with the header block", () => spec.historyRowsOpenWithTheHeaderBlock());
  it("history rows carry the bucket statistics", () => spec.historyRowsCarryTheBucketStatistics());
  it("a null history value is a null cell, never zero", () => spec.aNullValueIsANullCellNotZero());
  it("a null segment mean is a null cell", () => spec.aNullMeanInASegmentRowIsANullCell());
});
