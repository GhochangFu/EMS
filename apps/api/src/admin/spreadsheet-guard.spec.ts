import * as XLSX from "xlsx";

import { syntheticZip } from "../testing/synthetic-zip";
import {
  MAX_ECHOED_CELL_CHARS,
  MAX_INFLATED_BYTES,
  declaredZipInflation,
  looksLikeZip,
  quoteCell,
  zipInflationProblem,
} from "./spreadsheet-guard";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** `quoteCell` bounds what a message may echo; the omitted length is stated, never silently cut. */
export function assertQuoteCellBoundsEchoedText(): void {
  assert(quoteCell("TX01") === "'TX01'", `short text is quoted verbatim, got ${quoteCell("TX01")}`);
  const exact = "A".repeat(MAX_ECHOED_CELL_CHARS);
  assert(quoteCell(exact) === `'${exact}'`, "text at the cap is not cut");
  const long = "B".repeat(32_767);
  const quoted = quoteCell(long);
  assert(quoted.length < MAX_ECHOED_CELL_CHARS + 40, `a 32,767-character cell echoes at most ~${MAX_ECHOED_CELL_CHARS + 40} characters, got ${quoted.length}`);
  assert(quoted.includes("+32703 more characters"), `the omitted length is stated, got ${quoted}`);
  assert(quoted.startsWith(`'${"B".repeat(MAX_ECHOED_CELL_CHARS)}…'`), "the visible prefix is the first 64 characters plus an ellipsis");
}

/** A real workbook passes: its declared inflation is small and honest. A CSV is not a zip at all. */
export function assertRealWorkbooksAndCsvPass(): void {
  const sheet = XLSX.utils.aoa_to_sheet([["a", "b"], ["1", "2"]]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "MAPPINGS");
  const xlsx = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
  assert(looksLikeZip(xlsx), "an .xlsx starts with the zip local-file header");
  const declared = declaredZipInflation(xlsx);
  assert(declared !== null && !declared.zip64, "a real workbook parses without zip64");
  assert(declared !== null && declared.entries >= 5, `a workbook has several entries, got ${declared?.entries}`);
  assert(declared !== null && declared.totalBytes > 0 && declared.totalBytes < 1_000_000, `a two-cell workbook inflates to well under 1 MB, got ${declared?.totalBytes}`);
  assert(zipInflationProblem(xlsx) === null, "a real workbook is not refused");

  const csv = Buffer.from("asset_code,point_key\nTX01,kw\n", "utf8");
  assert(!looksLikeZip(csv), "a CSV is not a zip");
  assert(declaredZipInflation(csv) === null, "a CSV has no declared inflation");
  assert(zipInflationProblem(csv) === null, "a CSV is never refused by the zip guard");
}

/** The guard reads the directory, not the payload: a zip declaring 500 MiB across two entries is refused without inflating anything. */
export function assertADeclaredBombIsRefusedFromTheDirectoryAlone(): void {
  const bomb = syntheticZip([400 * 1024 * 1024, 100 * 1024 * 1024]);
  assert(bomb.length < 300, `the synthetic zip is tiny (${bomb.length} bytes) — the sizes are declared, not real`);
  const declared = declaredZipInflation(bomb);
  assert(declared?.totalBytes === 500 * 1024 * 1024 && declared.entries === 2, `declared 500 MiB over 2 entries, got ${JSON.stringify(declared)}`);
  const problem = zipInflationProblem(bomb);
  assert(problem !== null && problem.includes(`${MAX_INFLATED_BYTES}-byte limit`), `refused against the stated limit, got ${problem}`);

  const underBudget = syntheticZip([MAX_INFLATED_BYTES - 1]);
  assert(zipInflationProblem(underBudget) === null, "a zip one byte under the budget passes");
  const atBudget = syntheticZip([MAX_INFLATED_BYTES]);
  assert(zipInflationProblem(atBudget) === null, "a zip exactly at the budget passes (the bound is 'more than')");
  const overByOne = syntheticZip([MAX_INFLATED_BYTES + 1]);
  assert(zipInflationProblem(overByOne) !== null, "a zip one byte over the budget is refused");
}

/** zip64 sizes and a corrupt directory are refused too — the guard never guesses. */
export function assertZip64AndCorruptDirectoriesAreRefused(): void {
  const zip64 = syntheticZip([1], { zip64: true });
  const problem = zipInflationProblem(zip64);
  assert(problem !== null && problem.includes("zip64"), `zip64 markers are refused by name, got ${problem}`);

  const truncated = syntheticZip([1]).subarray(0, 40); // local header plus a torn directory, no EOCD
  const corrupt = zipInflationProblem(truncated);
  assert(corrupt !== null && corrupt.includes("could not be read"), `a zip without a readable directory is refused, got ${corrupt}`);
}
