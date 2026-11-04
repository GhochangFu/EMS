import { describe, it } from "vitest";

import {
  assertPdfBytesWithoutPreviousAreMain,
  assertPdfWithoutPreviousReadsOnePreview,
  assertPdfWithPreviousReadsTwoPreviews,
  assertXlsxBytesWithoutPreviousAreMain,
  assertXlsxWithoutPreviousReadsOnePreview,
  assertXlsxWithPreviousCarriesTheColumns,
  assertXlsxWithPreviousReadsTwoPreviews,
} from "./reports.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("ReportsService — compare on the energy report (F4.303, ADR 0108 Amendment 6 item 8)", () => {
  it("energyXlsx with previous reads the period and the previous period", async () => {
    await assertXlsxWithPreviousReadsTwoPreviews();
  });

  it("energyXlsx without previous reads one preview", async () => {
    await assertXlsxWithoutPreviousReadsOnePreview();
  });

  it("energyPdf with previous reads the period and the previous period", async () => {
    await assertPdfWithPreviousReadsTwoPreviews();
  });

  it("energyPdf without previous reads one preview", async () => {
    await assertPdfWithoutPreviousReadsOnePreview();
  });

  it("energyXlsx without previous gives main's bytes", async () => {
    await assertXlsxBytesWithoutPreviousAreMain();
  });

  it("energyPdf without previous gives main's bytes with the clock pinned", async () => {
    await assertPdfBytesWithoutPreviousAreMain();
  });

  it("energyXlsx with previous writes the Previous period row and the five-cell metric header", async () => {
    await assertXlsxWithPreviousCarriesTheColumns();
  });
});
