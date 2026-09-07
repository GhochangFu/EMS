import * as XLSX from "xlsx";

/**
 * A workbook that **declares** a used range far wider than the cells it holds —
 * what `<dimension ref="A1:XFD20102"/>` looks like on disk, and the shape
 * `F4.101` bounds. SheetJS's writer preserves a hand-set `!ref` and its reader
 * takes the declared range at face value; both measured on the pinned 0.20.3.
 *
 * The declared width is modest on purpose. Writing is O(declared cells), so
 * `A1:XFD2000` takes **46.8 s to write** where `A1:ZZ200` takes 187 ms — a
 * full-width fixture cannot live in a test suite. 702 columns is 11× the
 * 64-column bound, which is all an end-to-end case needs to show. The real
 * ceiling is asserted against the pure range helpers directly instead
 * (`columnBoundedRange` for the importer, `onboardingSheetRangeProblem` for the
 * onboarding upload), where no workbook has to exist at all.
 *
 * Lifted out of `telemetry-import-rows.spec.ts` by `F4.102`, which needs the
 * same shape for a second parser. `sheetName` exists because the onboarding
 * fixtures read a sheet by position and are clearer named for their own
 * workbook; the default keeps the original call site unchanged. Never used in
 * production code.
 */
export function buildWorkbookBufferDeclaring(
  rows: (string | number)[][],
  declaredRef: string,
  sheetName = "Import",
): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!ref"] = declaredRef;
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName);
  return XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}
