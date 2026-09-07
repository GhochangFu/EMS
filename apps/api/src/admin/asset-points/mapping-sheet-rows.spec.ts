import { MAPPING_SHEET_HEADERS } from "@bms/shared";
import type { MappingSheetErrorDto } from "@bms/shared";
import * as XLSX from "xlsx";

import { syntheticZip } from "../../testing/synthetic-zip";
import { MAX_IMPORT_ROWS, SHEET_ROWS_BOUND } from "../telemetry-import/telemetry-import-rows";
import { MAX_IMPORT_FILE_BYTES, parseMappingSheet } from "./mapping-sheet-rows";
import type { ParsedMappingRow } from "./mapping-sheet-rows";

/**
 * `F2.7` G2 — `parseMappingSheet`, the pure half of the import: sheet
 * selection, the strict header, and the row errors that need no database
 * (steps 1–4 final, steps 10–12 attached to the row for the planner to raise
 * in order). Buffers are built with `aoa_to_sheet` the way
 * `telemetry-import-rows.spec.ts` builds them.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

type Cell = string | number | boolean;

/** Builds a workbook buffer from rows-of-cells; the sheet is `MAPPINGS` unless told otherwise. */
function buildBuffer(rows: Cell[][], bookType: "csv" | "xlsx" = "xlsx", sheetName = "MAPPINGS"): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName);
  return XLSX.write(book, { type: "buffer", bookType }) as Buffer;
}

/**
 * The same workbook with its used range starting at Excel row `startRow`: the
 * rows are written from there and `!ref` is hand-set to match, which is what a
 * sheet with rows inserted above the header looks like on disk.
 * `aoa_to_sheet([[]])` alone leaves a `!ref` of `A1:A1`, so the range is stated
 * rather than inferred.
 *
 * Written **deflated**, as every real `.xlsx` is: an uncompressed 20,000-row
 * fixture is 9.98 MiB and the parser refuses it as `file_too_large` before the
 * row cap is ever reached, which would make the cap cases below vacuous.
 */
function buildBufferFromRow(rows: Cell[][], startRow: number): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([[]]);
  XLSX.utils.sheet_add_aoa(sheet, rows, { origin: `A${startRow}` });
  sheet["!ref"] = XLSX.utils.encode_range({
    s: { r: startRow - 1, c: 0 },
    e: { r: startRow - 2 + rows.length, c: (rows[0]?.length ?? 1) - 1 },
  });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "MAPPINGS");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}

/** A blank Excel row 1 above the header — the common case, and the one the row numbering turns on. */
function buildBufferFromRowTwo(rows: Cell[][]): Buffer {
  return buildBufferFromRow(rows, 2);
}

const HEADER: Cell[] = [...MAPPING_SHEET_HEADERS];

/** A complete, valid data row; override cells by column name. */
function row(overrides: Partial<Record<(typeof MAPPING_SHEET_HEADERS)[number], Cell>> = {}): Cell[] {
  const base: Record<(typeof MAPPING_SHEET_HEADERS)[number], Cell> = {
    asset_code: "TX01",
    asset_name: "Transformer 1",
    point_key: "kw",
    rtu_code: "WC-RTU-1",
    source_data_key: "TX01_KW",
    unit: "kW",
    scale_multiplier: "",
    scale_offset: "",
    eng_min: "",
    eng_max: "",
    quality_policy: "",
    active: "TRUE",
    ...overrides,
  };
  return MAPPING_SHEET_HEADERS.map((column) => base[column]);
}

function parseOk(buffer: Buffer, what: string): { rows: ParsedMappingRow[]; errors: MappingSheetErrorDto[]; totalRows: number } {
  const result = parseMappingSheet(buffer);
  assert(result.ok, `${what}: expected ok, got ${result.ok ? "" : JSON.stringify(result.error)}`);
  if (!result.ok) {
    throw new Error("unreachable");
  }
  return result;
}

function parseFile(buffer: Buffer, what: string): MappingSheetErrorDto {
  const result = parseMappingSheet(buffer);
  assert(!result.ok, `${what}: expected a file-level refusal, got ok`);
  if (result.ok) {
    throw new Error("unreachable");
  }
  return result.error;
}

/** The header must be the twelve, in order, case- and space-insensitively; anything else names the offender. */
export function assertHeaderIsStrictAndNamesTheOffender(): void {
  const good = parseOk(buildBuffer([HEADER, row()]), "a correct header");
  assert(good.rows.length === 1 && good.errors.length === 0, "one good row, no errors");
  assert(good.totalRows === 1, `totalRows counts the non-blank data rows, got ${good.totalRows}`);
  const first = good.rows[0];
  assert(first?.rowNumber === 2, `the first data row is Excel row 2, got ${first?.rowNumber}`);
  assert(first?.cells.asset_code === "TX01" && first.cells.point_key === "kw", "cells carry the trimmed text");
  assert(first?.cells.rtu_code === "WC-RTU-1" && first.cells.source_data_key === "TX01_KW", "rtu_code and source_data_key carry through");
  assert(first?.cells.unit === "kW" && first.cells.asset_name === "Transformer 1", "unit and asset_name carry through");
  assert(first?.active === true, "active TRUE parses to true");
  assert(first?.cellError === null, "a valid row has no deferred cell error");

  const spaced = HEADER.map((h) => (h === "scale_multiplier" ? "Scale_Multiplier " : h));
  parseOk(buildBuffer([spaced, row()]), "a header with case and a trailing space");

  const withTrailingBlank = [...HEADER, "", ""];
  parseOk(buildBuffer([withTrailingBlank, row()]), "trailing blank header cells are ignored");

  const thirteenth = parseFile(buildBuffer([[...HEADER, "sensor_code"], [...row(), "S1"]]), "a 13th column");
  assert(thirteenth.code === "header_mismatch", `13th column → header_mismatch, got ${thirteenth.code}`);
  assert(thirteenth.row === null && thirteenth.column === null, "a header problem is file-level: row and column null");
  assert(thirteenth.message.includes("sensor_code"), `the message names the offending header, got "${thirteenth.message}"`);

  const reordered = [...HEADER];
  [reordered[0], reordered[1]] = [reordered[1] as Cell, reordered[0] as Cell];
  const reorderedError = parseFile(buildBuffer([reordered, row()]), "a reordered header");
  assert(reorderedError.code === "header_mismatch", `reordered → header_mismatch, got ${reorderedError.code}`);
  assert(reorderedError.message.includes("asset_name"), `the message names the first misplaced header, got "${reorderedError.message}"`);

  const missingLast = parseFile(buildBuffer([HEADER.slice(0, 11), row().slice(0, 11)]), "eleven columns");
  assert(missingLast.code === "header_mismatch" && missingLast.message.includes("active"), "a missing column is named");
}

/** A `.csv` has one unnamed sheet and it is used; an `.xlsx` must carry `MAPPINGS`. */
export function assertSheetSelection(): void {
  const csv = parseOk(buildBuffer([HEADER, row()], "csv", "whatever"), "a CSV with no sheet name");
  assert(csv.rows.length === 1, "the CSV's one sheet is read");

  const wrongSheet = parseFile(buildBuffer([HEADER, row()], "xlsx", "Import"), "an xlsx without MAPPINGS");
  assert(wrongSheet.code === "sheet_missing", `no MAPPINGS sheet → sheet_missing, got ${wrongSheet.code}`);
  assert(wrongSheet.row === null && wrongSheet.column === null, "sheet_missing is file-level");

  const empty = parseFile(Buffer.alloc(0), "an empty buffer");
  assert(empty.code === "file_unreadable", `an empty buffer → file_unreadable, got ${empty.code}`);

  const headerOnly = parseFile(buildBuffer([HEADER]), "a header-only sheet");
  assert(headerOnly.code === "no_data_rows", `header only → no_data_rows, got ${headerOnly.code}`);

  const blankRowsOnly = parseFile(buildBuffer([HEADER, row().map(() => ""), row().map(() => "")]), "header plus blank rows");
  assert(blankRowsOnly.code === "no_data_rows", `header plus blank rows → no_data_rows, got ${blankRowsOnly.code}`);

  assert(MAX_IMPORT_FILE_BYTES === 5 * 1024 * 1024, "the file cap is F1.9's 5 MiB");
  const tooLarge = parseFile(Buffer.alloc(MAX_IMPORT_FILE_BYTES + 1), "a buffer over the cap");
  assert(tooLarge.code === "file_too_large", `over the cap → file_too_large, got ${tooLarge.code}`);
}

/** Over `MAX_IMPORT_ROWS` data rows is refused whole; exactly at the cap is accepted. */
export function assertRowCap(): void {
  const over: Cell[][] = [HEADER];
  for (let i = 0; i < MAX_IMPORT_ROWS + 1; i += 1) {
    over.push(row({ asset_code: `A${i}` }));
  }
  const overError = parseFile(buildBuffer(over, "csv"), "20,001 data rows");
  assert(overError.code === "too_many_rows", `20,001 rows → too_many_rows, got ${overError.code}`);

  const atCap: Cell[][] = [HEADER];
  for (let i = 0; i < MAX_IMPORT_ROWS; i += 1) {
    atCap.push(row({ asset_code: `A${i}` }));
  }
  const atCapResult = parseOk(buildBuffer(atCap, "csv"), "exactly 20,000 data rows");
  assert(atCapResult.rows.length === MAX_IMPORT_ROWS, `all ${MAX_IMPORT_ROWS} rows parse, got ${atCapResult.rows.length}`);
}

/** `active` accepts the boolean spellings in any case and a boolean cell; blank is `null`; anything else is `active_invalid`. */
export function assertActiveSpellings(): void {
  const result = parseOk(
    buildBuffer([
      HEADER,
      row({ asset_code: "A1", active: "TRUE" }),
      row({ asset_code: "A2", active: "yes" }),
      row({ asset_code: "A3", active: "0" }),
      row({ asset_code: "A4", active: true }),
      row({ asset_code: "A5", active: "" }),
      row({ asset_code: "A6", active: "No" }),
      row({ asset_code: "A7", active: 1 }),
      row({ asset_code: "A8", active: "maybe" }),
    ]),
    "active spellings",
  );
  const byCode = new Map(result.rows.map((r) => [r.cells.asset_code, r.active]));
  assert(byCode.get("A1") === true, "TRUE → true");
  assert(byCode.get("A2") === true, "yes → true");
  assert(byCode.get("A3") === false, "0 → false");
  assert(byCode.get("A4") === true, "a boolean cell → true");
  assert(byCode.get("A5") === null, "blank → null (no change / suggestion not taken)");
  assert(byCode.get("A6") === false, "No → false");
  assert(byCode.get("A7") === true, "a numeric 1 → true");
  assert(!byCode.has("A8"), "an invalid spelling excludes the row from rows[]");
  assert(result.errors.length === 1, `one error, got ${result.errors.length}`);
  const invalid = result.errors[0];
  assert(invalid?.code === "active_invalid" && invalid.column === "active" && invalid.row === 9, `maybe → active_invalid at row 9/active, got ${JSON.stringify(invalid)}`);
}

/** Steps 10–12 attach to the row as one deferred error, in step order, for the planner to raise after the database steps. */
export function assertCellErrorsAreDeferredInOrder(): void {
  const result = parseOk(
    buildBuffer([
      HEADER,
      row({ asset_code: "A1", scale_multiplier: "abc" }),
      row({ asset_code: "A2", scale_multiplier: 0 }),
      row({ asset_code: "A3", quality_policy: "clamp" }),
      row({ asset_code: "A4", source_data_key: "X".repeat(129) }),
      row({ asset_code: "A5", source_data_key: "CH{unit}_T" }),
      row({ asset_code: "A6", source_data_key: "" }),
      row({ asset_code: "A7", unit: "u".repeat(33) }),
      row({ asset_code: "A8", eng_max: "1e400" }),
      row({ asset_code: "A9", scale_offset: "-40", eng_min: 0, eng_max: "100", scale_multiplier: "0.1", quality_policy: "accept_bad" }),
      row({ asset_code: "A10", source_data_key: "", scale_multiplier: "abc" }),
      row({ asset_code: "A11", eng_min: 100, eng_max: 0 }),
      row({ asset_code: "A12", source_data_key: "Y".repeat(128), unit: "u".repeat(32) }),
      row({ asset_code: "A13", quality_policy: "Discard_Bad" }),
    ]),
    "cell errors",
  );
  assert(result.errors.length === 0, `cell errors are deferred, not final: got ${JSON.stringify(result.errors)}`);
  const byCode = new Map(result.rows.map((r) => [r.cells.asset_code, r]));
  const errorOf = (code: string): MappingSheetErrorDto | null | undefined => byCode.get(code)?.cellError;

  assert(errorOf("A1")?.code === "number_invalid" && errorOf("A1")?.column === "scale_multiplier", `abc → number_invalid on scale_multiplier, got ${JSON.stringify(errorOf("A1"))}`);
  assert(errorOf("A1")?.row === 2, "the deferred error carries the Excel row number");
  assert(errorOf("A2")?.code === "scale_multiplier_zero" && errorOf("A2")?.column === "scale_multiplier", "0 → scale_multiplier_zero");
  assert(errorOf("A3")?.code === "quality_policy_invalid" && errorOf("A3")?.column === "quality_policy", "clamp → quality_policy_invalid");
  assert(errorOf("A4")?.code === "source_data_key_too_long" && errorOf("A4")?.column === "source_data_key", "129 chars → source_data_key_too_long");
  assert(errorOf("A5")?.code === "source_data_key_unresolved_token", "CH{unit}_T → source_data_key_unresolved_token");
  assert(errorOf("A5")?.message.includes("{unit}") === true, "the unresolved token is named");
  assert(errorOf("A6")?.code === "source_data_key_required", "blank source key → source_data_key_required");
  assert(errorOf("A7")?.code === "unit_too_long" && errorOf("A7")?.column === "unit", "33 chars → unit_too_long");
  assert(errorOf("A8")?.code === "number_invalid" && errorOf("A8")?.column === "eng_max", "1e400 is not finite → number_invalid on eng_max");

  const good = byCode.get("A9");
  assert(good?.cellError === null, `a fully valid row has no cell error, got ${JSON.stringify(good?.cellError)}`);
  assert(good?.metadata.scaleMultiplier === 0.1 && good.metadata.scaleOffset === -40, "numbers parse from text");
  assert(good?.metadata.engMin === 0 && good.metadata.engMax === 100, "0 parses as 0, not as blank");
  assert(good?.metadata.qualityPolicy === "accept_bad", "the policy parses");

  assert(errorOf("A10")?.code === "source_data_key_required", `step 10 precedes step 12: got ${errorOf("A10")?.code}`);
  assert(byCode.get("A11")?.cellError === null, "an inverted in-sheet band is step 13 (the planner's), not a parse error");
  assert(byCode.get("A11")?.metadata.engMin === 100 && byCode.get("A11")?.metadata.engMax === 0, "both bounds still parse");
  assert(byCode.get("A12")?.cellError === null, "128 chars and 32 chars are within the caps");
  assert(errorOf("A13")?.code === "quality_policy_invalid", "the policy vocabulary is case-sensitive, as the CHECK is");

  const blank = byCode.get("A1")?.metadata;
  assert(blank?.scaleOffset === null && blank.engMin === null && blank.engMax === null && blank.qualityPolicy === null, "blank cells are null");
}

/** Steps 1–3 are final: the row is excluded and the error names the row and column. */
export function assertRequiredCellsAndDuplicateRows(): void {
  const result = parseOk(
    buildBuffer([
      HEADER,
      row({ asset_code: "" }),
      row({ point_key: "" }),
      row({ asset_code: "TX01", point_key: "kw" }),
      row({ asset_code: "TX01", point_key: "kw", source_data_key: "OTHER" }),
      row({ asset_code: "TX01", point_key: "kw_b" }),
      row({ asset_code: "", point_key: "", active: "maybe" }),
    ]),
    "required cells and duplicates",
  );
  assert(result.rows.length === 2, `two rows survive, got ${result.rows.length}`);
  assert(result.errors.length === 4, `four final errors, got ${JSON.stringify(result.errors)}`);
  const [blankCode, blankKey, duplicate, bothBlank] = result.errors;
  assert(blankCode?.code === "asset_code_required" && blankCode.column === "asset_code" && blankCode.row === 2, `row 2 → asset_code_required, got ${JSON.stringify(blankCode)}`);
  assert(blankKey?.code === "point_key_required" && blankKey.column === "point_key" && blankKey.row === 3, `row 3 → point_key_required, got ${JSON.stringify(blankKey)}`);
  assert(duplicate?.code === "duplicate_row" && duplicate.column === "point_key" && duplicate.row === 5, `row 5 → duplicate_row, got ${JSON.stringify(duplicate)}`);
  assert(duplicate?.message.includes("row 4"), `the duplicate names the first occurrence, got "${duplicate?.message}"`);
  assert(bothBlank?.code === "asset_code_required" && bothBlank.row === 7, "step 1 precedes steps 2 and 4");
  assert(result.totalRows === 6, `totalRows counts every non-blank data row, got ${result.totalRows}`);
}

/** Blank rows are skipped but keep the numbering: Excel row = offset + 2. */
export function assertBlankRowsKeepTheExcelNumbering(): void {
  const result = parseOk(
    buildBuffer([HEADER, row({ asset_code: "A1" }), row().map(() => ""), row({ asset_code: "A2" }), ["", "", "", "", "", "", "", "", "", "", "", ""], row({ asset_code: "A3" })]),
    "blank rows",
  );
  assert(result.rows.length === 3, `three non-blank rows, got ${result.rows.length}`);
  assert(
    JSON.stringify(result.rows.map((r) => r.rowNumber)) === JSON.stringify([2, 4, 6]),
    `Excel numbering skips the blank rows, got ${JSON.stringify(result.rows.map((r) => r.rowNumber))}`,
  );
  assert(result.totalRows === 3, "blank rows are not counted");
}

/**
 * Row numbers are Excel rows even when the used range starts below row 1 — a
 * blank row inserted above the header shifts `!ref` to `A2:…`, the header sits
 * on Excel row 2 and the first data row on 3 (PR 2 code review, finding 3).
 */
export function assertRowNumbersAreAbsoluteWhenTheRangeStartsBelowRowOne(): void {
  const data = [HEADER, row({ asset_code: "A1" }), row({ asset_code: "" })];
  const result = parseOk(buildBufferFromRowTwo(data), "a range starting at A2");
  // The valid row is Excel row 3; the blank-asset_code row is a parser-side
  // error, so it lands in `errors` (not `rows`) and must name Excel row 4.
  assert(
    JSON.stringify(result.rows.map((r) => r.rowNumber)) === JSON.stringify([3]),
    `the valid data row is Excel row 3, got ${JSON.stringify(result.rows.map((r) => r.rowNumber))}`,
  );
  assert(result.errors.length === 1, `one parser-side error, got ${result.errors.length}`);
  assert(result.errors[0]?.row === 4, `the blank asset_code error names Excel row 4, got ${result.errors[0]?.row}`);
  assert(result.totalRows === 2, `both non-blank data rows are counted, got ${result.totalRows}`);
}

/**
 * The row cap trips even when the used range starts below row 1 (post-merge
 * code review, finding 1).
 *
 * `sheetRows` bounds materialisation in **absolute** rows from 0, while the cap
 * was checked as `range.e.r - range.s.r` on the already-truncated range. A
 * header on Excel row 2 spends one of those rows, so a 25,000-row sheet came
 * back cut to the bound with `range.e.r - range.s.r` reading exactly
 * `MAX_IMPORT_ROWS` — the cap could not trip, and 20,000 of the 25,000 rows
 * were imported with nothing said. The parser now refuses whenever
 * materialisation reached the bound as well, and the bound carries
 * `MAX_RANGE_START_ROW` rows of slack so a sheet that merely starts a little
 * below row 1 is still read whole and accepted at the cap.
 */
export function assertTheRowCapTripsWhenTheRangeStartsBelowRowOne(): void {
  const overRows: Cell[][] = [HEADER];
  for (let i = 0; i < MAX_IMPORT_ROWS + 1; i += 1) {
    overRows.push(row({ asset_code: `A${i}` }));
  }
  const overError = parseFile(buildBufferFromRowTwo(overRows), "20,001 data rows under a header on Excel row 2");
  assert(overError.code === "too_many_rows", `20,001 rows below row 1 → too_many_rows, got ${overError.code}`);

  const atCapRows: Cell[][] = [HEADER];
  for (let i = 0; i < MAX_IMPORT_ROWS; i += 1) {
    atCapRows.push(row({ asset_code: `A${i}` }));
  }
  const atCap = parseOk(buildBufferFromRowTwo(atCapRows), "exactly 20,000 data rows under a header on Excel row 2");
  assert(atCap.totalRows === MAX_IMPORT_ROWS, `the sheet at the cap is read whole, got ${atCap.totalRows}`);
}

/**
 * The **reading-bound** half of that refusal, on its own (post-merge review of
 * the fix, finding 1).
 *
 * The A2 pair above is decided by the count clause alone — its over-cap sheet
 * ends at absolute row 20,002, short of the 20,102-row bound — so neither case
 * exercises `range.e.r + 1 >= SHEET_ROWS_BOUND`. This one does: the header sits
 * on Excel row 201 and 25,000 data rows follow, so materialisation stops at the
 * bound and the range comes back `A201:L20102`. What survives the cut is 19,901
 * data rows — **under** the cap, so the count clause is silent and the bound
 * clause is the only thing between the operator and a 25,000-row file imported
 * as 19,901 rows with nothing said. Measured: delete the clause and this case
 * parses `ok`.
 *
 * The message is asserted too, because both clauses raise the same
 * `too_many_rows` code: a refusal that reported "File has 19901 data rows, more
 * than the 20000-row limit" contradicted itself, and the count it quoted was
 * the size of the cut rather than the size of the file.
 */
export function assertASheetCutAtTheReadingBoundIsRefused(): void {
  const rows: Cell[][] = [HEADER];
  for (let i = 0; i < 25_000; i += 1) {
    rows.push(row({ asset_code: `A${i}` }));
  }
  const error = parseFile(buildBufferFromRow(rows, 201), "25,000 data rows under a header on Excel row 201");
  assert(error.code === "too_many_rows", `a sheet cut at the reading bound → too_many_rows, got ${error.code}`);
  assert(
    error.message.includes(`reading bound of ${SHEET_ROWS_BOUND} rows`),
    `the refusal says the reading bound is what fired, got "${error.message}"`,
  );
  assert(
    !error.message.includes("19901"),
    `the refusal must not quote the cut's row count as the file's, got "${error.message}"`,
  );
}

/**
 * PR 2 security review, H1 — a 32,767-character cell is echoed bounded. The
 * measured attack was 6,000 duplicate rows with two such cells each: 375 MiB of
 * `duplicate_row` messages and ~32 s of blocked event loop from a 4.8 MB file.
 * `row`, `column` and `code` identify the cell; the text is a hint, and cut.
 */
export function assertEchoedCellTextIsBounded(): void {
  const huge = "A".repeat(32_767);
  const result = parseOk(
    buildBuffer([HEADER, row({ asset_code: huge, point_key: huge }), row({ asset_code: huge, point_key: huge }), row({ asset_code: "TX01", active: "maybe" }), row({ asset_code: "TX02", scale_multiplier: huge })]),
    "huge cells",
  );
  const duplicate = result.errors.find((e) => e.code === "duplicate_row");
  assert(duplicate !== undefined, "the second huge row is a duplicate_row");
  assert(duplicate!.message.length < 400, `a duplicate_row message is bounded, got ${duplicate!.message.length} characters`);
  assert(duplicate!.message.includes("more characters"), "the omitted length is stated");
  const active = result.errors.find((e) => e.code === "active_invalid");
  assert(active !== undefined && active.message.length < 300, "active_invalid is bounded");
  const numeric = result.rows.find((r) => r.cells.asset_code === "TX02")?.cellError;
  assert(numeric?.code === "number_invalid" && numeric.message.length < 300, `number_invalid is bounded, got ${numeric?.message.length}`);
  const total = result.errors.reduce((n, e) => n + e.message.length, 0);
  assert(total < 2_000, `the whole error list for this file is under 2,000 characters, got ${total}`);
}

/** PR 2 security review, L3 — only a plain decimal literal is a number; `0x10`, `0b101`, `0o17` are `number_invalid`, not 16, 5 and 15. */
export function assertOnlyDecimalLiteralsAreNumbers(): void {
  for (const text of ["0x10", "0b101", "0o17", "1_000", " 12 34", "1e", "--1"]) {
    const result = parseOk(buildBuffer([HEADER, row({ scale_multiplier: text })]), `non-decimal ${text}`);
    assert(result.rows[0]?.cellError?.code === "number_invalid", `${JSON.stringify(text)} is number_invalid, got ${JSON.stringify(result.rows[0]?.cellError)}`);
  }
  for (const [text, value] of [["1.5", 1.5], ["-2", -2], ["+3", 3], [".5", 0.5], ["1e3", 1000], ["2.", 2]] as const) {
    const result = parseOk(buildBuffer([HEADER, row({ scale_multiplier: text })], "csv"), `decimal ${text}`);
    assert(result.rows[0]?.cellError === null, `${text} parses without error, got ${JSON.stringify(result.rows[0]?.cellError)}`);
    assert(result.rows[0]?.metadata.scaleMultiplier === value, `${text} parses to ${value}, got ${result.rows[0]?.metadata.scaleMultiplier}`);
  }
}

/**
 * `F4.101` — the header scan is bounded by the twelve columns this sheet has,
 * not by the width the file declares.
 *
 * The scan used to walk `range.s.c..range.e.c`, and `safe_decode_range`
 * accumulates column letters with no XFD clamp, so a hand-written
 * `<dimension ref="A1:AAAAAAA20102"/>` decodes to 321,272,406 columns. Measured
 * through `parseMappingSheet`: 12.4M declared columns took 13.4 s and 494 MiB,
 * and 321M took the process to `FATAL ERROR: JavaScript heap out of memory` at
 * a 768 MiB cap — all from uploads of about 2.46 KB, holding two real cells.
 * The scan runs BEFORE `cutAtTheReadingBound`, and no densification is
 * involved, which is why the row cap and the `sheet_to_json` bound its sibling
 * needed both miss it.
 *
 * That fixture cannot be built here: SheetJS's writer is O(declared cells), so
 * a 321M-column declaration cannot be written by a test. The wall clock was
 * measured out-of-suite against a hand-built zip; what is gated here is the
 * bound itself, structurally.
 *
 * A stray cell far right in the header row is the discriminator. Unbounded, the
 * scan reaches it, the trailing-blank `pop` stops at it, and `headerProblem`
 * refuses the file as having a thirteenth column. Bounded, the twelve are read
 * and the file parses. That is a deliberate behaviour change and it is the
 * kinder one: a stray cell Excel left behind in the header row no longer
 * refuses an otherwise-correct sheet.
 */
export function assertTheHeaderScanIsBoundedByTheTwelve(): void {
  const strayColumn = 700;
  const headerRow: Cell[] = [...HEADER];
  const dataRow: Cell[] = [...row()];
  // Annotated: `MAPPING_SHEET_HEADERS` is a readonly tuple, so `.length` is the
  // literal `12` and `c` would be inferred as `12` rather than `number`.
  for (let c: number = MAPPING_SHEET_HEADERS.length; c <= strayColumn; c += 1) {
    headerRow[c] = c === strayColumn ? "stray" : "";
    dataRow[c] = "";
  }

  const result = parseMappingSheet(buildBuffer([headerRow, dataRow]));
  assert(
    result.ok,
    `a stray header-row cell beyond the twelve must not refuse the sheet, got ${result.ok === false ? result.error.message : ""}`,
  );
  if (result.ok) {
    assert(result.rows.length === 1, `expected the one data row, got ${result.rows.length}`);
    assert(result.rows[0]?.rowNumber === 2, `the data row keeps its Excel number, got ${result.rows[0]?.rowNumber}`);
  }

  // And the thirteenth-column refusal still fires when the thirteenth is really
  // the thirteenth — the bound reads one past the twelve for exactly this.
  const thirteenth = parseMappingSheet(buildBuffer([[...HEADER, "extra"], [...row(), ""]]));
  assert(!thirteenth.ok, "a real thirteenth column must still be refused");
  assert(
    thirteenth.ok === false && thirteenth.error.message.includes("thirteenth"),
    `the refusal must still name it a thirteenth, got ${thirteenth.ok === false ? thirteenth.error.message : ""}`,
  );

  // A CSV whose first thirteen header cells are blank but which carries content
  // further right is a file with a **wrong header**, not an unreadable file.
  // Bounding the scan made `headers` pop to empty and took the "no file" branch,
  // which the web renders as "File cannot be read" — telling the operator their
  // readable CSV is not a CSV. The error CODE is part of the contract here, so
  // this asserts the code and not the prose (post-merge review, Q1).
  const shiftedHeader: Cell[] = [];
  const shiftedData: Cell[] = [];
  for (let c: number = 0; c <= 20; c += 1) {
    shiftedHeader[c] = c < 14 ? "" : String(MAPPING_SHEET_HEADERS[c - 14] ?? "");
    shiftedData[c] = c < 14 ? "" : "x";
  }
  const shifted = parseMappingSheet(buildBuffer([shiftedHeader, shiftedData], "csv"));
  assert(!shifted.ok, "a CSV whose header sits beyond the scanned columns must be refused");
  assert(
    shifted.ok === false && shifted.error.code === "header_mismatch",
    `it is a wrong header, not an unreadable file — got ${shifted.ok === false ? shifted.error.code : "ok"}`,
  );
}

/** PR 2 security review, H2 — a zip declaring a 500 MiB inflation is refused before `XLSX.read` inflates anything. */
export function assertADeclaredZipBombIsRefusedBeforeRead(): void {
  const result = parseMappingSheet(syntheticZip([500 * 1024 * 1024]));
  assert(!result.ok, "a declared bomb is refused");
  assert(result.ok === false && result.error.code === "file_too_large", `refused as file_too_large, got ${result.ok === false ? result.error.code : "ok"}`);
  assert(result.ok === false && result.error.message.includes("when unpacked"), `the message names the declared inflation, got ${result.ok === false ? result.error.message : ""}`);
}

/** Every cell is read as text before a number is parsed: a formula-looking code stays text, a CSV leading zero survives. */
export function assertCellsAreReadAsText(): void {
  const xlsx = parseOk(buildBuffer([HEADER, row({ asset_code: "=1+1", scale_multiplier: 0.1 })]), "a formula-looking code");
  assert(xlsx.rows[0]?.cells.asset_code === "=1+1", `=1+1 survives verbatim as text, got ${xlsx.rows[0]?.cells.asset_code}`);
  assert(xlsx.rows[0]?.metadata.scaleMultiplier === 0.1, "a numeric xlsx cell parses exactly");

  const csv = parseOk(buildBuffer([HEADER, row({ asset_code: "007", source_data_key: "00123", scale_offset: "1.50" })], "csv"), "CSV leading zeros");
  assert(csv.rows[0]?.cells.asset_code === "007", `a CSV code with leading zeros keeps them, got ${csv.rows[0]?.cells.asset_code}`);
  assert(csv.rows[0]?.cells.source_data_key === "00123", `a CSV source key with leading zeros keeps them, got ${csv.rows[0]?.cells.source_data_key}`);
  assert(csv.rows[0]?.metadata.scaleOffset === 1.5, "a CSV numeric cell parses");

  const padded = parseOk(buildBuffer([HEADER, row({ asset_code: "  TX01  ", point_key: " kw ", unit: " kW " })]), "padded cells");
  assert(padded.rows[0]?.cells.asset_code === "TX01" && padded.rows[0].cells.point_key === "kw" && padded.rows[0].cells.unit === "kW", "cells are trimmed");
}
