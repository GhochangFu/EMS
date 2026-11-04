import { describe, it } from "vitest";

import * as spec from "./trend-points-pdf.spec";

/** `F4.303` U13 — the `trend_points` rows and PDF definition. Assertions live in the sibling `.spec.ts` (§4.6). */
describe("F4.303 trend_points report rows and PDF (ADR 0108 Amendment 6 item 8)", () => {
  it("one table per point with its heading", spec.assertOneTablePerPointWithItsHeading);
  it("a summary row, then the bucket rows", spec.assertSummaryRowThenBucketRows);
  it("with compare the previous period follows the current one", spec.assertComparePutsThePreviousPeriodAfter);
  it("a gap is a dash in the PDF cell", spec.assertAGapIsADashInThePdf);
  it("a gap is null in the long row", spec.assertAGapIsNullInTheLongRow);
  it("the dropped sentence names the pairs", spec.assertTheDroppedSentenceNamesThePairs);
  it("no sentence when nothing is left out", spec.assertNoSentenceWhenNothingIsLeftOut);
  it("every point dropped leaves the head and no table", spec.assertEveryPointDroppedLeavesNoTable);
  it("a kept point draws one table with the header row", spec.assertAKeptPointDrawsOneTable);
  it("the sheet reads the tables' rows", spec.assertTheSheetReadsTheTablesRows);
  it("a 1m read folds to hours in the PDF", spec.assertA1mReadFoldsToHoursInThePdf);
  it("the sheet keeps every minute bucket", spec.assertTheSheetKeepsEveryMinuteBucket);
  it("a 5m read is not folded", spec.assertA5mReadIsNotFolded);
  it("the folded PDF says so on its level line", spec.assertTheFoldedPdfSaysSo);
  it("exactly one row builder is exported", spec.assertExactlyOneRowBuilderIsExported);
  it("the service calls the row builder once", spec.assertTheServiceCallsTheBuilderOnce);
});
