import { describe, it } from "vitest";

import {
  assertDescribeBufferHashesAndMeasuresTheBytes,
  assertPdfFilename,
  assertReportFilenameSignatureCarriesNoName,
  assertReportFilenameTakesTwoDatesAndAFormat,
  assertXlsxFilename,
} from "./report-file-store.spec";

describe("report-file-store (F3.5b U7, plan R-15)", () => {
  it("names a pdf energy-consumption-<start>-to-<end>.pdf", assertPdfFilename);
  it("names an xlsx energy-consumption-<start>-to-<end>.xlsx", assertXlsxFilename);
  it("describeBuffer hashes and measures the bytes", assertDescribeBufferHashesAndMeasuresTheBytes);
  it("reportFilename takes periodStart, periodEnd and format", assertReportFilenameTakesTwoDatesAndAFormat);
  it("reportFilename's signature carries no name or title (Amendment 1 item 12)", assertReportFilenameSignatureCarriesNoName);
});
