import { MAPPING_SHEET_HEADERS, MAPPING_SHEET_NAME, QUALITY_POLICIES, patternTokens } from "@bms/shared";
import type {
  MappingSheetColumn,
  MappingSheetErrorCode,
  MappingSheetErrorDto,
  PointMetadataFields,
  QualityPolicy,
} from "@bms/shared";
import * as XLSX from "xlsx";

import { quoteCell, zipInflationProblem } from "../spreadsheet-guard";
import { MAX_IMPORT_ROWS, SHEET_ROWS_BOUND } from "../telemetry-import/telemetry-import-rows";
import { MAX_IMPORT_FILE_BYTES } from "../telemetry-import/telemetry-import.schema";

/**
 * Pure, DB-free parsing of an uploaded `MAPPINGS` sheet (`F2.7`, ADR 0056
 * decision 7) — the half of the import that needs no database.
 *
 * Mirrors `telemetry-import-rows.ts`: one `XLSX.read` for CSV and XLSX alike,
 * `sheetRows` bounded so a small file that inflates to a huge sheet is cut
 * before the row cap is checked — and a sheet that reached that bound is then
 * refused, never imported as the part of itself that survived the cut — never
 * `cellDates`. What is different is the
 * contract: the header is **strict** (the twelve, in order — anything else is a
 * file-level `header_mismatch`), every problem carries a stable code from
 * `MAPPING_SHEET_ERROR_CODES`, and the row errors split in two:
 *
 * - **Steps 1–4** of the plan's evaluation order (`asset_code_required`,
 *   `point_key_required`, `duplicate_row`, `active_invalid`) precede every
 *   database step, so they are **final** here: the row goes to `errors[]` and
 *   not to `rows[]`.
 * - **Steps 10–12** (`source_data_key_*`, `unit_too_long`, `number_invalid`,
 *   `scale_multiplier_zero`, `quality_policy_invalid`) come *after* the asset,
 *   key and RTU resolution in that order, and after step 7's "a blank `active`
 *   on a row with no mapping is an untouched suggestion — stop". A row must
 *   report one code, and a suggestion with a garbage cell must report none, so
 *   these are computed here (first in step order wins) and **attached to the
 *   row** as `cellError` for `planMappingSheet` to raise at step 10–12 — or
 *   never, when an earlier step already spoke.
 *
 * The in-sheet half of step 14 (`source_data_key_duplicate` within the sheet)
 * is **not** here either, for the same reason: a row that stops at steps 5–9 or
 * at step 7 never claims its key, and only the planner knows which rows stop.
 *
 * Every cell is read as **text** before a number is parsed (ADR 0026 / decision
 * 6): `raw: true` keeps a CSV cell's source text (`007` stays `007`), an XLSX
 * numeric cell round-trips through `String()` exactly, and nothing is ever
 * evaluated.
 */

export { MAX_IMPORT_FILE_BYTES };

/** `bms.asset_points.source_data_key` is `varchar(128)` (step 10's `source_data_key_too_long`). */
export const SOURCE_DATA_KEY_MAX_LENGTH = 128;

/** `bms.asset_points.unit` is `varchar(32)` (step 11's `unit_too_long`). */
export const UNIT_MAX_LENGTH = 32;

/** The spellings of a true `active` cell, compared lower-case; a boolean cell stringifies to one of them. */
const ACTIVE_TRUE = new Set(["true", "1", "yes"]);

/** The spellings of a false `active` cell. */
const ACTIVE_FALSE = new Set(["false", "0", "no"]);

/** The four numeric metadata columns, in header order, with the field each parses into. */
const NUMERIC_COLUMNS: ReadonlyArray<readonly [MappingSheetColumn, "scaleMultiplier" | "scaleOffset" | "engMin" | "engMax"]> = [
  ["scale_multiplier", "scaleMultiplier"],
  ["scale_offset", "scaleOffset"],
  ["eng_min", "engMin"],
  ["eng_max", "engMax"],
];

/** Anything in braces — a `{token}` left unresolved, or a stray brace pair (step 10). */
const BRACED = /\{[^}]*\}/;

/** One data row after the header, as the planner consumes it. */
export type ParsedMappingRow = {
  /** 1-based Excel row number — header is row 1, so the first data row is 2. */
  readonly rowNumber: number;
  /** Every one of the twelve cells as trimmed text, keyed by header name. */
  readonly cells: Readonly<Record<MappingSheetColumn, string>>;
  /** `null` for a blank cell (design decision 4: no change / suggestion not taken); a boolean when the cell parsed. */
  readonly active: boolean | null;
  /** The five as parsed — `null` for a blank cell (inherit) and for a cell that did not parse (`cellError` says which). */
  readonly metadata: PointMetadataFields;
  /** The first of steps 10–12 that failed, for the planner to raise in order; `null` when the cells are all valid. */
  readonly cellError: MappingSheetErrorDto | null;
};

/** What `parseMappingSheet` returns: the rows and the final row errors, or one file-level refusal. */
export type ParseMappingSheetResult =
  | {
      readonly ok: true;
      readonly rows: ParsedMappingRow[];
      /** Steps 1–4, final — these rows are not in `rows[]`. */
      readonly errors: MappingSheetErrorDto[];
      /** Non-blank data rows, valid or not. */
      readonly totalRows: number;
    }
  | { readonly ok: false; readonly error: MappingSheetErrorDto };

function fileError(code: MappingSheetErrorCode, message: string): MappingSheetErrorDto {
  return { row: null, column: null, code, message };
}

function rowError(row: number, column: MappingSheetColumn, code: MappingSheetErrorCode, message: string): MappingSheetErrorDto {
  return { row, column, code, message };
}

/**
 * Whether `book` came from a genuine binary spreadsheet (XLSX, XLS, ODS, …)
 * rather than CSV/plain text — SheetJS sets `bookType` for the former and
 * leaves it `undefined` for the latter, the same check
 * `telemetry-import-rows.ts` makes. A binary workbook must carry `MAPPINGS`;
 * a text file has one unnamed sheet and it is used.
 */
function isBinarySpreadsheet(book: XLSX.WorkBook): boolean {
  return book.bookType !== undefined && book.bookType !== "csv" && book.bookType !== "txt";
}

/** The trimmed text of one cell; an absent cell is `""`. Never evaluates anything. */
function cellText(sheet: XLSX.WorkSheet, r: number, c: number): string {
  const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
  if (cell === undefined || cell.v === undefined || cell.v === null) {
    return "";
  }
  return String(cell.v).trim();
}

/**
 * Compares the header row to the twelve and names the first thing wrong with it:
 * a misplaced or misspelt header, a missing one, or a thirteenth. Trailing
 * blank header cells are ignored (an exported sheet re-saved by Excel often
 * carries them). Returns `null` when the header is exactly right.
 */
function headerProblem(headers: readonly string[]): string | null {
  const expected: readonly string[] = MAPPING_SHEET_HEADERS;
  for (let i = 0; i < Math.max(headers.length, expected.length); i += 1) {
    const got = headers[i];
    const want = expected[i];
    if (got === want) {
      continue;
    }
    if (want === undefined) {
      return `Column ${i + 1} is ${quoteCell(got ?? "")}; the header must be exactly the twelve columns and this is a thirteenth`;
    }
    if (got === undefined) {
      return `Column ${i + 1} is missing; expected '${want}'`;
    }
    return `Column ${i + 1} is ${quoteCell(got)}; expected '${want}' (the header must be exactly: ${expected.join(", ")})`;
  }
  return null;
}

/** `true`/`false` per the spellings, `null` for blank, `undefined` for anything else. */
function parseActive(text: string): boolean | null | undefined {
  if (text === "") {
    return null;
  }
  const lower = text.toLowerCase();
  if (ACTIVE_TRUE.has(lower)) {
    return true;
  }
  if (ACTIVE_FALSE.has(lower)) {
    return false;
  }
  return undefined;
}

/**
 * A plain decimal literal: optional sign, digits with an optional fraction (or
 * a bare fraction), optional exponent. `Number()` alone also accepts `0x10`,
 * `0b101` and `0o17`, and a hex cell silently becoming a decimal scale factor
 * is not what a sheet author means (PR 2 security review, L3).
 */
const DECIMAL_LITERAL = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

/** A finite decimal number, `null` for blank, `undefined` for text that is not one. */
function parseNumber(text: string): number | null | undefined {
  if (text === "") {
    return null;
  }
  if (!DECIMAL_LITERAL.test(text)) {
    return undefined;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Steps 10–12 for one row, first failure wins; and the five as parsed. A cell
 * that fails to parse leaves its field `null` — the row is refused anyway, and
 * the planner never writes it.
 */
function parseCells(
  rowNumber: number,
  cells: Readonly<Record<MappingSheetColumn, string>>,
): { metadata: PointMetadataFields; cellError: MappingSheetErrorDto | null } {
  let cellError: MappingSheetErrorDto | null = null;
  const fail = (column: MappingSheetColumn, code: MappingSheetErrorCode, message: string): void => {
    if (cellError === null) {
      cellError = rowError(rowNumber, column, code, message);
    }
  };

  // Step 10 — source_data_key
  const sourceKey = cells.source_data_key;
  if (sourceKey === "") {
    fail("source_data_key", "source_data_key_required", "source_data_key is required on a row being written");
  } else if (sourceKey.length > SOURCE_DATA_KEY_MAX_LENGTH) {
    fail(
      "source_data_key",
      "source_data_key_too_long",
      `source_data_key is ${sourceKey.length} characters; the limit is ${SOURCE_DATA_KEY_MAX_LENGTH}`,
    );
  } else if (BRACED.test(sourceKey)) {
    const tokens = patternTokens(sourceKey);
    fail(
      "source_data_key",
      "source_data_key_unresolved_token",
      tokens.length > 0
        ? `source_data_key still holds the unresolved token(s) ${tokens.map((t) => `{${t}}`).join(", ")}; replace each with the real value`
        : "source_data_key still holds a {…} placeholder; replace it with the real value",
    );
  }

  // Step 11 — unit
  if (cells.unit.length > UNIT_MAX_LENGTH) {
    fail("unit", "unit_too_long", `unit is ${cells.unit.length} characters; the limit is ${UNIT_MAX_LENGTH}`);
  }

  // Step 12 — the numeric cells, then the zero multiplier, then the policy
  const numbers: Record<"scaleMultiplier" | "scaleOffset" | "engMin" | "engMax", number | null> = {
    scaleMultiplier: null,
    scaleOffset: null,
    engMin: null,
    engMax: null,
  };
  for (const [column, field] of NUMERIC_COLUMNS) {
    const parsed = parseNumber(cells[column]);
    if (parsed === undefined) {
      fail(column, "number_invalid", `${column} ${quoteCell(cells[column])} is not a finite decimal number`);
    } else {
      numbers[field] = parsed;
    }
  }
  if (numbers.scaleMultiplier === 0) {
    fail(
      "scale_multiplier",
      "scale_multiplier_zero",
      "scale_multiplier 0 would store 0 for every reading; leave it blank to inherit the template default (which reads as 1), or set a non-zero factor",
    );
  }
  let qualityPolicy: QualityPolicy | null = null;
  if (cells.quality_policy !== "") {
    const match = QUALITY_POLICIES.find((policy) => policy === cells.quality_policy);
    if (match === undefined) {
      fail(
        "quality_policy",
        "quality_policy_invalid",
        `quality_policy ${quoteCell(cells.quality_policy)} is not one of ${QUALITY_POLICIES.join(", ")}`,
      );
    } else {
      qualityPolicy = match;
    }
  }

  return { metadata: { ...numbers, qualityPolicy }, cellError };
}

/**
 * Parses an uploaded CSV or XLSX buffer into the sheet's data rows and the
 * row errors that need no database. Returns a discriminated result instead of
 * throwing: an unreadable file, a missing `MAPPINGS` sheet, a wrong header, a
 * header with no data, or a file over either cap is `ok: false` with one
 * file-level error DTO, which the controller returns as a 400 body.
 *
 * `rows[]` holds every non-blank data row that passed steps 1–4, in sheet
 * order, each with its parsed cells and — when steps 10–12 found something —
 * its deferred `cellError`. `errors[]` holds the steps 1–4 refusals.
 */
export function parseMappingSheet(buffer: Buffer): ParseMappingSheetResult {
  if (buffer.length > MAX_IMPORT_FILE_BYTES) {
    return {
      ok: false,
      error: fileError("file_too_large", `File is ${buffer.length} bytes, more than the ${MAX_IMPORT_FILE_BYTES}-byte limit`),
    };
  }

  // Before a byte is inflated: what does the zip *declare* it will unpack to?
  // `sheetRows` below bounds row materialisation, not the shared-string table;
  // the PR 2 security review took the process to 2.5 GB RSS with a 1.3 MB file.
  const inflation = zipInflationProblem(buffer);
  if (inflation !== null) {
    return { ok: false, error: fileError("file_too_large", inflation) };
  }

  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(buffer, {
      type: "buffer",
      // Every text-format cell stays the text the file holds — no number or
      // date guessing, so `007` is `007`. XLSX cells carry their own types and
      // are stringified below; either way a number is parsed from text here.
      raw: true,
      // Bounds what SheetJS materialises before the row cap is checked: the
      // header, one overflow row so a file one row over the cap is still
      // detected as over it, and the start slack a used range below row 1
      // needs (`telemetry-import-rows.ts`'s `SHEET_ROWS_BOUND`).
      sheetRows: SHEET_ROWS_BOUND,
    });
  } catch {
    return { ok: false, error: fileError("file_unreadable", "Could not read the uploaded file as CSV or Excel") };
  }

  const firstName = book.SheetNames[0];
  if (firstName === undefined) {
    return { ok: false, error: fileError("file_unreadable", "The uploaded file has no sheet") };
  }
  const binary = isBinarySpreadsheet(book);
  let sheet: XLSX.WorkSheet | undefined;
  if (binary) {
    sheet = book.Sheets[MAPPING_SHEET_NAME];
    if (!sheet) {
      return {
        ok: false,
        error: fileError(
          "sheet_missing",
          `The workbook has no sheet named ${MAPPING_SHEET_NAME} (sheets: ${quoteCell(book.SheetNames.join(", "))})`,
        ),
      };
    }
  } else {
    sheet = book.Sheets[firstName];
  }
  if (!sheet) {
    return { ok: false, error: fileError("file_unreadable", "The uploaded file has no readable sheet") };
  }

  const ref = sheet["!ref"];
  if (!ref) {
    // A text file with no cells at all (an empty upload) is not a spreadsheet;
    // an empty sheet inside a real workbook has a header problem.
    if (!binary) {
      return { ok: false, error: fileError("file_unreadable", "The uploaded file is empty") };
    }
    return {
      ok: false,
      error: fileError("header_mismatch", `The sheet is empty; row 1 must be the header: ${MAPPING_SHEET_HEADERS.join(", ")}`),
    };
  }
  const range = XLSX.utils.decode_range(ref);

  const headers: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    headers.push(cellText(sheet, range.s.r, c).toLowerCase());
  }
  while (headers.length > 0 && headers[headers.length - 1] === "") {
    headers.pop();
  }
  if (headers.length === 0 && !binary) {
    // SheetJS reads an empty or non-spreadsheet text buffer as one sheet with
    // one blank cell; that is not a file with a wrong header, it is no file.
    return { ok: false, error: fileError("file_unreadable", "The uploaded file is empty or is not CSV or Excel") };
  }
  const problem = headerProblem(headers);
  if (problem !== null) {
    return { ok: false, error: fileError("header_mismatch", problem) };
  }

  // Every sheet row after the header, blanks included — that is what makes the
  // Excel row number `offset + 2`, and what the cap counts.
  const dataRowCount = range.e.r - range.s.r;
  // Two ways to be over the cap. The count is the plain one; the other is a
  // used range that **reached** the reading bound, where `dataRowCount` counts
  // what survived the cut rather than what the file holds. `sheetRows` bounds
  // absolute rows from 0, so a header on Excel row 2 spends one of them and a
  // 25,000-row sheet came back reading as exactly 20,000 — the cap could not
  // trip and 20,000 rows imported with nothing said (post-merge review,
  // finding 1).
  if (range.e.r + 1 >= SHEET_ROWS_BOUND || dataRowCount > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: fileError(
        "too_many_rows",
        `File has ${dataRowCount} data rows, more than the ${MAX_IMPORT_ROWS}-row limit (or the sheet was cut at the reading bound)`,
      ),
    };
  }

  const rows: ParsedMappingRow[] = [];
  const errors: MappingSheetErrorDto[] = [];
  const firstRowOf = new Map<string, number>();
  let totalRows = 0;

  for (let r = range.s.r + 1; r <= range.e.r; r += 1) {
    // The Excel row is the absolute row index plus one — not relative to the
    // used range. A workbook whose `!ref` starts at A2 (a blank row inserted
    // above the header before saving) has its header on Excel row 2 and its
    // first data row on 3; `r - range.s.r + 1` would have said 2, and every
    // reported row number would send the person to the wrong line (PR 2 code
    // review, finding 3).
    const rowNumber = r + 1;
    const texts = MAPPING_SHEET_HEADERS.map((_, c) => cellText(sheet, r, range.s.c + c));
    if (texts.every((text) => text === "")) {
      continue; // a spacer row — skipped, but it keeps its Excel number
    }
    totalRows += 1;
    const cells = Object.fromEntries(MAPPING_SHEET_HEADERS.map((column, c) => [column, texts[c] ?? ""])) as Record<
      MappingSheetColumn,
      string
    >;

    // Step 1
    if (cells.asset_code === "") {
      errors.push(rowError(rowNumber, "asset_code", "asset_code_required", "asset_code is required"));
      continue;
    }
    // Step 2
    if (cells.point_key === "") {
      errors.push(rowError(rowNumber, "point_key", "point_key_required", "point_key is required"));
      continue;
    }
    // Step 3 — the in-sheet upsert key
    const upsertKey = `${cells.asset_code}\u0000${cells.point_key}`;
    const firstRow = firstRowOf.get(upsertKey);
    if (firstRow !== undefined) {
      errors.push(
        rowError(
          rowNumber,
          "point_key",
          "duplicate_row",
          `Duplicate of row ${firstRow} — the same asset_code ${quoteCell(cells.asset_code)} and point_key ${quoteCell(cells.point_key)} appear earlier in this file`,
        ),
      );
      continue;
    }
    firstRowOf.set(upsertKey, rowNumber);
    // Step 4
    const active = parseActive(cells.active);
    if (active === undefined) {
      errors.push(
        rowError(
          rowNumber,
          "active",
          "active_invalid",
          `active ${quoteCell(cells.active)} is not a boolean; use TRUE/FALSE, yes/no or 1/0, or leave it blank for no change`,
        ),
      );
      continue;
    }

    const { metadata, cellError } = parseCells(rowNumber, cells);
    rows.push({ rowNumber, cells, active, metadata, cellError });
  }

  if (totalRows === 0) {
    return { ok: false, error: fileError("no_data_rows", "The sheet has a header row but no data rows") };
  }

  return { ok: true, rows, errors, totalRows };
}
