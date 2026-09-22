import { MetricsService } from "./metrics.service";

/**
 * F3.5b (ADR 0071 decision 8, R-17) — the two scheduled-report counters.
 *
 * Assertions live here; `report-metrics.test.ts` is the Vitest wrapper
 * (§4.6/ADR 0014). The `seriesValue` reader and the "absent before, present
 * after" shape are `queue-health.spec.ts`'s (prom-client emits no series
 * for a labelled metric until a label set is touched).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function seriesValue(text: string, name: string, labels: string): number | undefined {
  const line = text
    .split("\n")
    .find((l) => l.startsWith(`${name}{`) && l.includes(labels) && !l.startsWith("#"));
  const match = line?.match(/\s(-?\d+(?:\.\d+)?)\s*$/);
  return match ? Number(match[1]) : undefined;
}

export async function assertReportFilesWrittenCounterRegistersUnderItsAdrName(): Promise<void> {
  const metrics = new MetricsService();
  const labels = 'format="pdf"';
  const before = seriesValue(
    await metrics.registry.getSingleMetricAsString("bms_report_files_written_total"),
    "bms_report_files_written_total",
    labels,
  );
  metrics.countReportFileWritten("pdf");
  const text = await metrics.registry.getSingleMetricAsString("bms_report_files_written_total");
  const after = seriesValue(text, "bms_report_files_written_total", labels);
  assert(
    before === undefined && after === 1,
    `expected bms_report_files_written_total{${labels}} absent before and 1 after, got ${before} → ${after}:\n${text}`,
  );
}

export async function assertReportDeliveriesCounterRegistersUnderItsAdrName(): Promise<void> {
  const metrics = new MetricsService();
  const labels = 'status="sent"';
  const before = seriesValue(
    await metrics.registry.getSingleMetricAsString("bms_report_deliveries_total"),
    "bms_report_deliveries_total",
    labels,
  );
  metrics.countReportDelivery("sent");
  const text = await metrics.registry.getSingleMetricAsString("bms_report_deliveries_total");
  const after = seriesValue(text, "bms_report_deliveries_total", labels);
  assert(
    before === undefined && after === 1,
    `expected bms_report_deliveries_total{${labels}} absent before and 1 after, got ${before} → ${after}:\n${text}`,
  );
}

export async function assertCountReportFileWrittenMovesOnlyItsFormatLabel(): Promise<void> {
  const metrics = new MetricsService();
  metrics.countReportFileWritten("pdf");
  const text = await metrics.registry.getSingleMetricAsString("bms_report_files_written_total");
  const pdf = seriesValue(text, "bms_report_files_written_total", 'format="pdf"');
  const xlsx = seriesValue(text, "bms_report_files_written_total", 'format="xlsx"');
  assert(
    pdf === 1 && xlsx === undefined,
    `expected format="pdf" to move by exactly one and format="xlsx" to stay absent, got pdf=${pdf} xlsx=${xlsx}`,
  );
}

export async function assertCountReportDeliveryMovesOnlyItsStatusLabel(): Promise<void> {
  const metrics = new MetricsService();
  metrics.countReportDelivery("sent");
  const text = await metrics.registry.getSingleMetricAsString("bms_report_deliveries_total");
  const sent = seriesValue(text, "bms_report_deliveries_total", 'status="sent"');
  const failed = seriesValue(text, "bms_report_deliveries_total", 'status="failed"');
  assert(
    sent === 1 && failed === undefined,
    `expected status="sent" to move by exactly one and status="failed" to stay absent, got sent=${sent} failed=${failed}`,
  );
}
