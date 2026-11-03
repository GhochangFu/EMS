import { describe, it } from "vitest";

import {
  aCapOfExactlyTheCountPasses,
  aFortySixDayRangeIsNotRefused,
  aFrameRefusalRunsNoStatement,
  aLoweredCapRefusesBeforeAnyStatement,
  csvIsTheWriterOverTheRows,
  noCompareReadsOnePeriod,
  onePeriodReadPerPeriodAndOneSiteSeriesRead,
  theBySiteRowsEqualTheTrend,
  theBySourceRowsEqualTheSeries,
  theFrameRunsFirstWithTheUserAndTheQuery,
  theHeaderBlockReadsTheFrame,
  theRowCountIsTheFramesArithmetic,
  xlsxIsAWorkbook,
} from "./energy-view-export.service.spec";

/** `F4.303` U3 — Vitest entry point for `EnergyViewExportService`. Assertions live in the sibling `.spec` (§4.6). */
describe("F4.303 — EnergyViewExportService (ADR 0108 Amendment 6 item 3)", () => {
  it("E1: a frame refusal runs no pool statement", () => aFrameRefusalRunsNoStatement());
  it("E1: frame runs first with the user and the query", () => theFrameRunsFirstWithTheUserAndTheQuery());
  it("E2: one period read per period and one site-series read", () => onePeriodReadPerPeriodAndOneSiteSeriesRead());
  it("E2: without compare one period read", () => noCompareReadsOnePeriod());
  it("E3: the by-source rows equal the series", () => theBySourceRowsEqualTheSeries());
  it("E3: the by-site rows equal the trend, rounded as on screen", () => theBySiteRowsEqualTheTrend());
  it("E4: the row count is the frame's arithmetic", () => theRowCountIsTheFramesArithmetic());
  it("E4: a lowered cap refuses before any statement", () => aLoweredCapRefusesBeforeAnyStatement());
  it("E4: a cap of exactly the count passes", () => aCapOfExactlyTheCountPasses());
  it("E5: a 46-day range is not refused", () => aFortySixDayRangeIsNotRefused());
  it("E6: the header block reads the frame", () => theHeaderBlockReadsTheFrame());
  it("csv is the writer over the rows", () => csvIsTheWriterOverTheRows());
  it("xlsx is a workbook of the same reads", () => xlsxIsAWorkbook());
});
