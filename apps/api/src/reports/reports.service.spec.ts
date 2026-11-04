import { createHash } from "node:crypto";

import { vi } from "vitest";
import * as XLSX from "xlsx";

import type { EnergyReportPreview } from "@bms/shared";

import { energyPreviewFixture, MAIN_PDF_SHA256, previousPreview } from "./energy-pdf.spec";
import { ReportsService } from "./reports.service";

/**
 * `F4.303` U12 (ADR 0108 Amendment 6 item 8, owner Q9; owner ruling Q-B) — the
 * `previous` query on `ReportsService.energyXlsx` and `energyPdf`.
 *
 * `energyPreview` is spied, so the fleet pool is never read: each claim counts
 * the preview calls of the ONE export call it makes (a fresh service and spy per
 * claim, never a lifetime counter), and the byte claims read the same fixture
 * `energy-pdf.spec.ts` captured `main`'s bytes from.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const QUERY = { startDate: "2026-08-01", endDate: "2026-08-07" };
const PREVIOUS = { startDate: "2026-07-25", endDate: "2026-07-31" };
const ASSET_IDS = ["00000000-0000-4000-8000-0000000000a1"];

/** The SHA-256 of `energyXlsx`'s bytes for the fixture on `main` before `F4.303` (captured at `550dfecc`). */
const MAIN_XLSX_SHA256 = "2b60e667690d8aab2b022ddadf4a73a03efdaa46e2654d23361f14dcb818130a";

function harness(): { service: ReportsService; previewSpy: ReturnType<typeof vi.fn> } {
  const service = new ReportsService({} as never, {} as never);
  const previewSpy = vi.fn(async (query: { startDate: string }): Promise<EnergyReportPreview> =>
    query.startDate === PREVIOUS.startDate ? previousPreview() : energyPreviewFixture(),
  );
  (service as unknown as { energyPreview: typeof previewSpy }).energyPreview = previewSpy;
  return { service, previewSpy };
}

const sha256 = (buffer: Buffer): string => createHash("sha256").update(buffer).digest("hex");

/** With `previous`, `energyXlsx` reads the preview twice: the period, then the previous period, over the same asset ids. */
export async function assertXlsxWithPreviousReadsTwoPreviews(): Promise<void> {
  const { service, previewSpy } = harness();
  await service.energyXlsx(QUERY, ASSET_IDS, PREVIOUS);
  assert(
    JSON.stringify(previewSpy.mock.calls) === JSON.stringify([[QUERY, ASSET_IDS], [PREVIOUS, ASSET_IDS]]),
    `energyXlsx with previous must call energyPreview for the period then the previous period, got ${JSON.stringify(previewSpy.mock.calls)}`,
  );
}

/** Without `previous`, `energyXlsx` reads the preview once. */
export async function assertXlsxWithoutPreviousReadsOnePreview(): Promise<void> {
  const { service, previewSpy } = harness();
  await service.energyXlsx(QUERY, ASSET_IDS);
  assert(
    JSON.stringify(previewSpy.mock.calls) === JSON.stringify([[QUERY, ASSET_IDS]]),
    `energyXlsx without previous must call energyPreview once, got ${JSON.stringify(previewSpy.mock.calls)}`,
  );
}

/** With `previous`, `energyPdf` reads the preview twice, like the sheet. */
export async function assertPdfWithPreviousReadsTwoPreviews(): Promise<void> {
  const { service, previewSpy } = harness();
  await service.energyPdf(QUERY, ASSET_IDS, PREVIOUS);
  assert(
    JSON.stringify(previewSpy.mock.calls) === JSON.stringify([[QUERY, ASSET_IDS], [PREVIOUS, ASSET_IDS]]),
    `energyPdf with previous must call energyPreview for the period then the previous period, got ${JSON.stringify(previewSpy.mock.calls)}`,
  );
}

/** Without `previous`, `energyPdf` reads the preview once. */
export async function assertPdfWithoutPreviousReadsOnePreview(): Promise<void> {
  const { service, previewSpy } = harness();
  await service.energyPdf(QUERY, ASSET_IDS);
  assert(
    JSON.stringify(previewSpy.mock.calls) === JSON.stringify([[QUERY, ASSET_IDS]]),
    `energyPdf without previous must call energyPreview once, got ${JSON.stringify(previewSpy.mock.calls)}`,
  );
}

/** Without `previous`, the XLSX bytes are `main`'s. */
export async function assertXlsxBytesWithoutPreviousAreMain(): Promise<void> {
  const { service } = harness();
  const sha = sha256(await service.energyXlsx(QUERY, ASSET_IDS));
  assert(sha === MAIN_XLSX_SHA256, `the no-compare XLSX bytes must be main's, got sha256 ${sha}`);
}

/** Without `previous`, the PDF bytes are `main`'s with the clock pinned to the epoch (pdfkit stamps `new Date()`). */
export async function assertPdfBytesWithoutPreviousAreMain(): Promise<void> {
  const { service } = harness();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(0);
  let buffer: Buffer;
  try {
    buffer = await service.energyPdf(QUERY, ASSET_IDS);
  } finally {
    vi.useRealTimers();
  }
  const sha = sha256(buffer);
  assert(sha === MAIN_PDF_SHA256, `the no-compare PDF bytes must be main's, got sha256 ${sha}`);
}

/** With `previous`, the sheet carries the previous period's row and the five-cell metric header. */
export async function assertXlsxWithPreviousCarriesTheColumns(): Promise<void> {
  const { service } = harness();
  const book = XLSX.read(await service.energyXlsx(QUERY, ASSET_IDS, PREVIOUS), { type: "buffer" });
  const sheet = book.Sheets.Energy;
  assert(sheet !== undefined, "the workbook must hold the Energy sheet");
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet as XLSX.WorkSheet, { header: 1 });
  assert(
    rows.some((row) => row[0] === "Previous period" && row[1] === "2026-07-25 to 2026-07-31"),
    `the sheet must carry the Previous period row, got ${JSON.stringify(rows.slice(0, 6))}`,
  );
  assert(
    rows.some((row) => JSON.stringify(row) === JSON.stringify(["Metric", "Value", "Unit", "Previous", "Change"])),
    "the sheet's metric header must carry Previous and Change",
  );
}
