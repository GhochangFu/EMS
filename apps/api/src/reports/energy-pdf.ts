import type { EnergyReportPreview } from "@bms/shared";
import PdfMake from "pdfmake";
import type { Content, TableCell, TDocumentDefinitions, TFontDictionary } from "pdfmake/interfaces";

import { energyTable } from "./reports.serialise";

/**
 * The Energy Consumption PDF (ADR 0071 decision 2).
 *
 * **Measured, not the plan's literal shape.** The plan's Unit 1 text assumed
 * `pdfmake`'s `PdfPrinter` class (`new PdfPrinter(fonts).createPdfKitDocument(...)`).
 * Measured against the installed `pdfmake@0.3.11`: `js/index.js` exports a
 * **singleton** (`module.exports = new pdfmake()`) whose type declarations
 * (`@types/pdfmake@0.3.3`) mirror the browser API: `setFonts`/`createPdf`, no
 * default export and no constructable class. `import PdfMake from "pdfmake"`
 * *does* compile — `esModuleInterop` synthesises the default as the module
 * namespace object — but `new PdfMake(...)` does not (`TS2351: This
 * expression is not constructable`, measured). The renderer below therefore
 * calls `PdfMake.setFonts(STANDARD_FONTS)` then `PdfMake.createPdf(definition)`,
 * which internally builds a fresh `Printer` per call (`base.js`, measured) —
 * the four-name Helvetica descriptor below is unaffected by the class/singleton
 * distinction.
 *
 * **Decision 2's font consequence.** `STANDARD_FONTS` names PDFKit's built-in
 * Standard-14 Helvetica by string (`"Helvetica"`, `"Helvetica-Bold"`, …) — no
 * `.ttf` file, no `vfs_fonts` bundle. Standard-14 fonts are WinAnsi-encoded:
 * a character outside that encoding (for example CJK) renders pdfkit's
 * fallback glyph rather than throwing. `assertNonWinAnsiNameDoesNotThrow`
 * pins "does not throw" as the claim this file makes — not "renders
 * correctly", which WinAnsi cannot promise.
 *
 * **The singleton's URL/local-file access policy is left unset, on purpose.**
 * `createPdf` warns on every call when neither policy is set (`base.js`,
 * measured) because a font descriptor *can* name a URL or a local path.
 * Measured here: `URLResolver.resolve` only acts on a value starting
 * `http://`/`https://`, so a bare Standard-14 name is a no-op regardless of
 * URL policy — but `PDFDocument.provideFont` (`PDFDocument.js`) calls
 * `validateLocalFile` for **every** font not found in the virtual filesystem,
 * bare Standard-14 names included. A deny-all local policy was tried and
 * measured to throw `Access to local file denied` for `Helvetica-Bold` —
 * pdfmake has no "this is a built-in name" exemption, so denying local access
 * denies the standard font itself. The two `console.warn` lines this leaves
 * on every render are the accepted residual (§8: not step-6 verified beyond
 * "no throw"); a real access policy needs a rule that recognises the four
 * Standard-14 names, which is out of this unit's scope.
 */
export const STANDARD_FONTS: TFontDictionary = {
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
};

const numberFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

/** A `ReportCell[][]` block (rows between the blank-row separators `energyTable` writes). */
function splitIntoBlocks(rows: readonly (string | number)[][]): (string | number)[][][] {
  const blocks: (string | number)[][][] = [];
  let current: (string | number)[][] = [];
  for (const row of rows) {
    if (row.length === 0) {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    current.push(row);
  }
  if (current.length > 0) {
    blocks.push(current);
  }
  return blocks;
}

function tableCell(cell: string | number): TableCell {
  if (typeof cell === "number") {
    return { text: numberFormat.format(cell), alignment: "right" };
  }
  return { text: cell };
}

function blockToTable(block: (string | number)[][]): Content {
  const columnCount = Math.max(...block.map((row) => row.length));
  return {
    table: {
      headerRows: 1,
      widths: Array.from({ length: columnCount }, () => "*"),
      body: block.map((row) => row.map((cell) => tableCell(cell))),
    },
    margin: [0, 0, 0, 10],
  };
}

/**
 * Pure — the R-2 layout over `energyTable(preview)`'s rows. Every string cell
 * (including a top consumer's `code`, `name`, `siteName`) appears verbatim as
 * `text`; every number is formatted through `Intl.NumberFormat("en", {
 * maximumFractionDigits: 2 })` and right-aligned. Money keeps the table's own
 * shape — the ISO currency code sits in the adjacent Unit cell, never a
 * symbol — and a null cost is already the table's U+2014 by the time this
 * function sees it (`reports.serialise.ts`).
 */
export function energyPdfDefinition(preview: EnergyReportPreview): TDocumentDefinitions {
  const blocks = splitIntoBlocks(energyTable(preview));
  const content: Content[] = [
    { text: "Energy Consumption", fontSize: 16, bold: true, margin: [0, 0, 0, 2] },
    { text: `${preview.range.startDate} to ${preview.range.endDate}`, fontSize: 9, margin: [0, 0, 0, 2] },
    { text: `Generated at ${preview.generatedAt}`, fontSize: 8, margin: [0, 0, 0, 10] },
    ...blocks.map(blockToTable),
  ];
  return {
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: 40,
    defaultStyle: { font: "Helvetica", fontSize: 9 },
    content,
    footer: (currentPage: number, pageCount: number) => ({
      text: `${currentPage} / ${pageCount}`,
      alignment: "center",
      fontSize: 8,
    }),
  };
}

/**
 * Renders `definition` to a `Buffer`. `PdfMake.createPdf(...).getBuffer()`
 * attaches its stream listeners before calling `.end()` internally
 * (`pdfmake/js/OutputDocument.js`, measured) — this function does not need to
 * repeat that ordering itself.
 */
export async function renderPdf(definition: TDocumentDefinitions): Promise<Buffer> {
  // A shallow copy: `Printer.resolveUrls` can assign back into the font
  // descriptor object it is given, and `STANDARD_FONTS` is exported for the
  // spec to assert on — this keeps that assertion reading what was declared,
  // not whatever the singleton wrote back into it.
  PdfMake.setFonts({ Helvetica: { ...STANDARD_FONTS.Helvetica } });
  return PdfMake.createPdf(definition).getBuffer();
}
