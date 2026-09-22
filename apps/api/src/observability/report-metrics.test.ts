import { describe, it } from "vitest";

import {
  assertCountReportDeliveryMovesOnlyItsStatusLabel,
  assertCountReportFileWrittenMovesOnlyItsFormatLabel,
  assertReportDeliveriesCounterRegistersUnderItsAdrName,
  assertReportFilesWrittenCounterRegistersUnderItsAdrName,
} from "./report-metrics.spec";

/**
 * F3.5b (ADR 0071 decision 8, R-17) — Vitest entry point for the two
 * scheduled-report counters. Assertions live in the sibling `.spec`
 * (§4.6/ADR 0014); this file only runs them.
 */
describe("F3.5b — report metrics counters", () => {
  it("registers bms_report_files_written_total under its ADR name", async () => {
    await assertReportFilesWrittenCounterRegistersUnderItsAdrName();
  });

  it("registers bms_report_deliveries_total under its ADR name", async () => {
    await assertReportDeliveriesCounterRegistersUnderItsAdrName();
  });

  it("countReportFileWritten moves only its format label", async () => {
    await assertCountReportFileWrittenMovesOnlyItsFormatLabel();
  });

  it("countReportDelivery moves only its status label", async () => {
    await assertCountReportDeliveryMovesOnlyItsStatusLabel();
  });
});
