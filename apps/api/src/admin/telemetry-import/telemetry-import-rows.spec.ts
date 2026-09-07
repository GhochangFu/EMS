import * as XLSX from "xlsx";

import { buildWorkbookBufferDeclaring } from "../../testing/declared-range-workbook";
import { syntheticZip } from "../../testing/synthetic-zip";
import {
  MAX_HEADER_COLUMNS,
  MAX_IMPORT_ROWS,
  SHEET_ROWS_BOUND,
  columnBoundedRange,
  parseWorkbook,
} from "./telemetry-import-rows";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Builds a workbook buffer from rows-of-cells, CSV or XLSX. */
function buildWorkbookBuffer(rows: (string | number)[][], bookType: "csv" | "xlsx" = "xlsx"): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Import");
  return XLSX.write(book, { type: "buffer", bookType }) as Buffer;
}

/** Excel's 1900 date system: days since 1899-12-30, UTC-instant-agnostic. */
function excelSerialForUtcInstant(date: Date): number {
  return date.getTime() / 86400000 + 25569;
}

/**
 * Builds an XLSX buffer where any native `Date` cell is written as a real
 * numeric date-serial cell (not text), the way a genuine Excel file stores
 * a date the user picked in a cell. Writes the serial directly (`t: "n"`)
 * rather than going through `aoa_to_sheet`'s own `{ cellDates: true }` —
 * that write path re-derives the serial from the `Date`'s *local* getters,
 * which would silently bake this host's timezone offset into the fixture
 * itself and defeat the point of these tests.
 */
function buildWorkbookBufferWithDates(rows: (string | number | Date)[][]): Buffer {
  const aoa = rows.map((row) => row.map((cell) => (cell instanceof Date ? excelSerialForUtcInstant(cell) : cell)));
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Import");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/**
 * The same workbook with its used range starting at `origin` — down the sheet,
 * across it, or both: the rows are written from that cell and `!ref` is
 * hand-set to match, which is what a sheet with rows or columns inserted above
 * and left of the header looks like on disk (`aoa_to_sheet([[]])` alone leaves
 * a `!ref` of `A1:A1`). Both axes matter, because `sheet_to_json` indexes
 * `raw` from the range's own origin on both, which is the mismatch `F4.100`
 * closed.
 *
 * Written **deflated**, as every real `.xlsx` is — the ~20,000-row fixtures
 * below are 1.3–1.7 MiB compressed against 8–10 MiB plain, and this parser's
 * own upload route caps a file at `MAX_IMPORT_FILE_BYTES` (5 MiB).
 */
function buildWorkbookBufferFromCell(rows: (string | number)[][], origin: string): Buffer {
  const start = XLSX.utils.decode_cell(origin);
  const sheet = XLSX.utils.aoa_to_sheet([[]]);
  XLSX.utils.sheet_add_aoa(sheet, rows, { origin });
  sheet["!ref"] = XLSX.utils.encode_range({
    s: { r: start.r, c: start.c },
    e: { r: start.r + rows.length - 1, c: start.c + (rows[0]?.length ?? 1) - 1 },
  });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Import");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}

/** Column A, `startRow` down — the row-axis-only shape the cap fixtures want. */
function buildWorkbookBufferFromRow(rows: (string | number)[][], startRow: number): Buffer {
  return buildWorkbookBufferFromCell(rows, `A${startRow}`);
}

/** A blank Excel row 1 above the header — the common case, and the one the row numbering turns on. */
function buildWorkbookBufferFromRowTwo(rows: (string | number)[][]): Buffer {
  return buildWorkbookBufferFromRow(rows, 2);
}

const HEADER = ["asset_code", "point_key", "value", "unit", "time"];

/**
 * `F2.7`'s post-merge code review, finding 1, in this parser: the row cap has
 * to trip when the used range starts below row 1.
 *
 * `sheetRows` bounds materialisation in **absolute** rows from 0, while the cap
 * is checked on `raw.slice(1)` over the already-truncated range. A header on
 * Excel row 2 spends one of those rows, so a sheet far over the cap came back
 * cut to the bound with exactly `MAX_IMPORT_ROWS` data rows left in it — the
 * cap could not trip and the rest of the file was dropped silently. The parser
 * now refuses whenever materialisation reached the bound as well, and the bound
 * carries `MAX_RANGE_START_ROW` rows of slack so a sheet that merely starts a
 * little below row 1 is still read whole.
 *
 * The at-cap case was asserted as `rows + rejected` while `F4.100` stood open:
 * the parser then assumed the header was absolute row 0 when it re-read a time
 * cell's source text, so an A2-origin sheet had its first data row rejected on
 * `time` and every later row accepted carrying the previous row's timestamp.
 * `F4.100` fixed that, so the assertion is now the exact one — 20,000 accepted
 * and nothing rejected. What this pair still exists to hold is the cap itself:
 * all 20,000 rows reached the row loop instead of being cut. The row numbering
 * and the time shift have their own fixtures in
 * {@link runTelemetryImportRangeOriginTests}, which use distinct timestamps —
 * every row here shares one instant, so a one-row shift is invisible in it.
 */
export function runTelemetryImportRangeStartTests(): void {
  const overCapRows: (string | number)[][] = [HEADER];
  for (let i = 0; i < MAX_IMPORT_ROWS + 1; i += 1) {
    overCapRows.push([`F19-ASSET-${i}`, "kw", 1, "kW", "2026-08-19T10:00:00Z"]);
  }
  const overCapResult = parseWorkbook(buildWorkbookBufferFromRowTwo(overCapRows));
  assert(!overCapResult.ok, `${MAX_IMPORT_ROWS + 1} data rows under a header on Excel row 2 must be refused as over the cap`);
  if (!overCapResult.ok) {
    // Not merely "refused" — refused *for being over the row limit*. The sibling
    // mapping-sheet assertion pins its `too_many_rows` code; this parser has no
    // codes, so the reason has to name the limit itself.
    assert(
      /20000|row/i.test(overCapResult.reason),
      `the refusal must name the ${MAX_IMPORT_ROWS}-row limit, got "${overCapResult.reason}"`,
    );
  }

  const atCapRows: (string | number)[][] = [HEADER];
  for (let i = 0; i < MAX_IMPORT_ROWS; i += 1) {
    atCapRows.push([`F19-ASSET-${i}`, "kw", 1, "kW", "2026-08-19T10:00:00Z"]);
  }
  const atCapResult = parseWorkbook(buildWorkbookBufferFromRowTwo(atCapRows));
  assert(atCapResult.ok, `exactly ${MAX_IMPORT_ROWS} data rows under a header on Excel row 2 must be accepted structurally`);
  if (atCapResult.ok) {
    assert(
      atCapResult.rejected.length === 0,
      `no row of the at-cap sheet may be rejected, got ${atCapResult.rejected.length}`,
    );
    assert(
      atCapResult.rows.length === MAX_IMPORT_ROWS,
      `every one of the ${MAX_IMPORT_ROWS} data rows reached the row loop and was accepted, got ${atCapResult.rows.length}`,
    );
  }
}

/**
 * `F4.100`: a sheet whose used range does not start at A1 must address its
 * cells by their **absolute** sheet position, not by their offset within the
 * range — on both axes.
 *
 * `sheet_to_json` indexes `raw` from the range's own origin, measured on both:
 * `raw[0]` is the range's first row and `raw[n][0]` its first column, whatever
 * `!ref` says. Every index taken out of `raw` is therefore range-relative,
 * while `rawCellText` addresses `sheet` absolutely, and the parser used to hand
 * the one to the other unchanged. Two defects came out of that single mismatch:
 *
 * - **Rows.** `sheetRowIndex = offset + 1` pointed one row **above** each data
 *   row of an A2-origin sheet. The first data row read the header's `time`
 *   cell and was rejected; every later row was accepted carrying the
 *   **previous row's timestamp**, with a `rowNumber` one below the operator's
 *   true Excel row. No structural error — a silent time shift.
 * - **Columns.** `timeIdx` counts columns from the range's first one, so a
 *   sheet starting at column B read the cell one column to the **left** of
 *   `time`. Usually that is unparsable and the row fails closed on `time`,
 *   blaming the operator's data for a parser fault; where the neighbour holds
 *   its own ISO timestamp, the row is accepted at that other instant instead.
 *
 * `F2.7`'s sibling parser anchors both axes (`r + 1` and `range.s.c + c`).
 *
 * Four properties of the fixtures matter, because each one hides the defect if
 * it is wrong:
 *
 * - **Distinct timestamps per row.** The at-cap fixture above gives every row
 *   the same instant, so a one-row shift is invisible in it.
 * - **Text ISO time cells, not date serials.** The numeric date-serial branch
 *   reads `row[timeIdx]` out of the parsed array and never addresses `sheet`,
 *   so neither index is used there and the defect does not fire.
 * - **Several origins, not one.** A single A2 case is satisfied by a hardcoded
 *   `+1`; row 5 and columns B and C kill that.
 * - **A decoy ISO column beside `time`.** Without it the column axis only ever
 *   fails closed, and a fixture that asserts "rejected" would pass against
 *   both the defect and the fix. The decoy is what makes the column axis
 *   corrupt silently, which is the property worth gating.
 *
 * XLSX only — a CSV's range always starts at A1.
 */
export function runTelemetryImportRangeOriginTests(): void {
  const times = ["2026-08-19T10:00:00Z", "2026-08-19T11:00:00Z", "2026-08-19T12:00:00Z"];

  // A2/A5 move the range down, B2/C3 move it down AND right.
  for (const origin of ["A2", "A5", "B2", "C3"]) {
    const start = XLSX.utils.decode_cell(origin);
    const rows: (string | number)[][] = [HEADER];
    times.forEach((time, i) => {
      rows.push([`F19-ASSET-${i + 1}`, "kw", i + 1, "kW", time]);
    });
    const result = parseWorkbook(buildWorkbookBufferFromCell(rows, origin));
    assert(result.ok, `a sheet whose used range starts at ${origin} must parse`);
    if (!result.ok) {
      continue;
    }
    assert(
      result.rejected.length === 0,
      `no row of the ${origin}-origin sheet may be rejected, got ${JSON.stringify(result.rejected)}`,
    );
    assert(
      result.rows.length === times.length,
      `expected ${times.length} accepted rows in the ${origin}-origin sheet, got ${result.rows.length}`,
    );
    times.forEach((time, i) => {
      const row = result.rows[i];
      // The header sits on the range's first row, so the first data row is the
      // one below it — what the operator sees in Excel, which is the whole
      // point of reporting a row number at all.
      const expectedRowNumber = start.r + 2 + i;
      assert(
        row?.rowNumber === expectedRowNumber,
        `data row ${i + 1} of the ${origin}-origin sheet must be numbered ${expectedRowNumber}, got ${row?.rowNumber}`,
      );
      const expectedTime = new Date(time).toISOString();
      assert(
        row?.time === expectedTime,
        `data row ${i + 1} of the ${origin}-origin sheet must keep its OWN timestamp ${expectedTime}, got ${row?.time}`,
      );
      assert(
        row?.assetCode === `F19-ASSET-${i + 1}`,
        `data row ${i + 1} of the ${origin}-origin sheet must carry its own asset code, got ${row?.assetCode}`,
      );
    });
  }

  // ---- the column axis, corrupting silently rather than failing closed ------
  // `captured_at` is an unknown column the parser ignores, placed immediately
  // left of `time` and holding its own valid ISO instant. On a B1-origin sheet
  // the relative `timeIdx` of 5 addressed absolute column F — `captured_at` —
  // so the row was accepted at 2001-01-01 instead of its real instant, with
  // nothing rejected and nothing logged.
  const decoyHeader = ["asset_code", "point_key", "value", "unit", "captured_at", "time"];
  const decoyRows: (string | number)[][] = [
    decoyHeader,
    ["F19-ASSET-1", "kw", 1, "kW", "2001-01-01T00:00:00Z", "2026-08-19T10:00:00Z"],
    ["F19-ASSET-2", "kw", 2, "kW", "2001-01-02T00:00:00Z", "2026-08-19T11:00:00Z"],
  ];
  const decoyResult = parseWorkbook(buildWorkbookBufferFromCell(decoyRows, "B1"));
  assert(decoyResult.ok, "a B1-origin sheet with an extra ISO column must parse");
  if (decoyResult.ok) {
    assert(decoyResult.rejected.length === 0, `the decoy sheet must reject nothing, got ${decoyResult.rejected.length}`);
    assert(
      decoyResult.rows[0]?.time === "2026-08-19T10:00:00.000Z",
      `the first row must take the 'time' column, not the ISO column beside it, got ${decoyResult.rows[0]?.time}`,
    );
    assert(
      decoyResult.rows[1]?.time === "2026-08-19T11:00:00.000Z",
      `the second row must take the 'time' column, not the ISO column beside it, got ${decoyResult.rows[1]?.time}`,
    );
  }

  // A rejection must name the operator's true Excel line as well — the same
  // arithmetic drives both, and a rejection list that points at the wrong line
  // is what an operator actually has to act on.
  const badRows: (string | number)[][] = [
    HEADER,
    ["F19-ASSET-1", "kw", 1, "kW", "2026-08-19T10:00:00Z"],
    ["F19-ASSET-2", "kw", "not-a-number", "kW", "2026-08-19T11:00:00Z"],
  ];
  const badResult = parseWorkbook(buildWorkbookBufferFromRowTwo(badRows));
  assert(badResult.ok, "a sheet with one bad value must not fail structurally");
  if (badResult.ok) {
    assert(badResult.rejected.length === 1, `expected exactly 1 rejection, got ${badResult.rejected.length}`);
    assert(
      badResult.rejected[0]?.rowNumber === 4,
      `the bad-value row must be numbered 4 (header on Excel row 2), got ${badResult.rejected[0]?.rowNumber}`,
    );
    assert(badResult.rejected[0]?.field === "value", "the rejection must name the value field");
  }
}

/**
 * The **reading-bound** half of that refusal, on its own (post-merge review of
 * the fix, finding 1).
 *
 * The A2 pair above is decided by the count clause alone — its over-cap sheet
 * ends at absolute row 20,002, short of the 20,102-row bound — so neither case
 * exercises `range.e.r + 1 >= SHEET_ROWS_BOUND`. This one does: the header sits
 * on Excel row 201 and 25,000 data rows follow, so materialisation stops at the
 * bound and the range comes back `A201:E20102`. What survives the cut is 19,901
 * data rows — **under** the cap, so the count clause is silent and the bound
 * clause is the only thing between the operator and a 25,000-row file imported
 * as 19,901 rows with nothing said. Measured: delete the clause and this case
 * parses `ok`.
 *
 * The reason is asserted too, because both clauses raise the same refusal: one
 * that reported "File has 19901 data rows, more than the 20000-row limit"
 * contradicted itself, and the count it quoted was the size of the cut rather
 * than the size of the file.
 */
export function runTelemetryImportReadingBoundTests(): void {
  const rows: (string | number)[][] = [HEADER];
  for (let i = 0; i < 25_000; i += 1) {
    rows.push([`F19-ASSET-${i}`, "kw", 1, "kW", "2026-08-19T10:00:00Z"]);
  }
  const result = parseWorkbook(buildWorkbookBufferFromRow(rows, 201));
  assert(!result.ok, "a sheet whose reading was cut at the bound must be refused, not imported as the part that survived");
  if (!result.ok) {
    assert(
      result.reason.includes(`reading bound of ${SHEET_ROWS_BOUND} rows`),
      `the refusal says the reading bound is what fired, got "${result.reason}"`,
    );
    assert(
      /20000|row/i.test(result.reason),
      `the refusal must name the ${MAX_IMPORT_ROWS}-row limit, got "${result.reason}"`,
    );
    assert(
      !result.reason.includes("19901"),
      `the refusal must not quote the cut's row count as the file's, got "${result.reason}"`,
    );
  }
}

/** Coverage for `parseWorkbook` (`F1.9`) — pure, DB-free row parsing and validation. */
export function runTelemetryImportRowsTests(): void {
  // ---- a good CSV file parses cleanly ----------------------------------------

  const goodCsv = buildWorkbookBuffer(
    [HEADER, ["F19-ASSET-1", "kw", 12.5, "kW", "2026-08-19T10:00:00Z"]],
    "csv",
  );
  const csvResult = parseWorkbook(goodCsv);
  assert(csvResult.ok, "a well-formed CSV must parse");
  if (csvResult.ok) {
    assert(csvResult.rows.length === 1, `expected 1 accepted row, got ${csvResult.rows.length}`);
    assert(csvResult.rejected.length === 0, "a well-formed CSV must reject nothing");
    const row = csvResult.rows[0];
    assert(row?.rowNumber === 2, `the first data row must be numbered 2 (header is row 1), got ${row?.rowNumber}`);
    assert(row?.assetCode === "F19-ASSET-1", "asset_code must be carried through");
    assert(row?.pointKey === "kw", "point_key must be carried through");
    assert(row?.value === 12.5, "value must be parsed as a number");
    assert(row?.unit === "kW", "unit must be carried through");
    assert(row?.time === "2026-08-19T10:00:00.000Z", `expected time 2026-08-19T10:00:00.000Z, got ${row?.time}`);
  }

  // ---- a CSV time cell with an explicit UTC offset keeps its real instant ----
  // (C-TZ) `Date.parse` honours an explicit offset the same way on every host,
  // so this case fails on ANY machine — not just a non-UTC one — if the time
  // cell is ever routed through a host-local reinterpretation instead.

  const offsetCsv = buildWorkbookBuffer(
    [HEADER, ["F19-ASSET-1", "kw", 12.5, "kW", "2026-08-20T07:37:50.634+05:30"]],
    "csv",
  );
  const offsetCsvResult = parseWorkbook(offsetCsv);
  assert(offsetCsvResult.ok, "a CSV file with an offset timestamp must parse");
  if (offsetCsvResult.ok) {
    assert(
      offsetCsvResult.rows[0]?.time === "2026-08-20T02:07:50.634Z",
      `expected time 2026-08-20T02:07:50.634Z, got ${offsetCsvResult.rows[0]?.time}`,
    );
  }

  // ---- a locale-ambiguous CSV date is rejected, not silently misparsed (C-AMBIG) --
  // SheetJS's CSV reader guesses date-like text into a numeric serial even
  // without `cellDates: true` — and "03/08/2026" is guessed MONTH-FIRST
  // (US convention), so if this were ever trusted as a genuine date serial
  // it would silently store 8 March instead of 3 August. Must fail closed.

  const ambiguousSlashCsv = buildWorkbookBuffer(
    [HEADER, ["F19-ASSET-1", "kw", 12.5, "kW", "03/08/2026 10:00"]],
    "csv",
  );
  const ambiguousSlashResult = parseWorkbook(ambiguousSlashCsv);
  assert(ambiguousSlashResult.ok, "an ambiguous-date CSV must not fail the whole file");
  if (ambiguousSlashResult.ok) {
    assert(ambiguousSlashResult.rows.length === 0, "a locale-ambiguous date must not be silently accepted");
    assert(ambiguousSlashResult.rejected[0]?.field === "time", "the rejection must name the time field");
  }

  const ambiguousDashCsv = buildWorkbookBuffer(
    [HEADER, ["F19-ASSET-1", "kw", 12.5, "kW", "03-08-2026 10:00"]],
    "csv",
  );
  const ambiguousDashResult = parseWorkbook(ambiguousDashCsv);
  assert(ambiguousDashResult.ok, "an ambiguous-date CSV must not fail the whole file");
  if (ambiguousDashResult.ok) {
    assert(ambiguousDashResult.rows.length === 0, "a locale-ambiguous dash-separated date must not be silently accepted");
  }

  // ---- a CSV time cell with no zone is still asserted UTC, not host-local ---
  // Bare ISO text with no offset gets SheetJS-guessed into a numeric serial
  // too (unlike the unambiguous-day case above) — must decode as UTC, the
  // same convention as every other case, not the host's local offset.

  const bareIsoCsv = buildWorkbookBuffer(
    [HEADER, ["F19-ASSET-1", "kw", 12.5, "kW", "2026-08-19T10:00:00"]],
    "csv",
  );
  const bareIsoResult = parseWorkbook(bareIsoCsv);
  assert(bareIsoResult.ok, "a bare (no-zone) ISO CSV timestamp must parse");
  if (bareIsoResult.ok) {
    assert(
      bareIsoResult.rows[0]?.time === "2026-08-19T10:00:00.000Z",
      `expected time 2026-08-19T10:00:00.000Z, got ${bareIsoResult.rows[0]?.time}`,
    );
  }

  // ---- a good XLSX file parses cleanly, same shape as CSV --------------------

  const goodXlsx = buildWorkbookBuffer(
    [HEADER, ["F19-ASSET-1", "kw", 12.5, "kW", "2026-08-19T10:00:00Z"]],
    "xlsx",
  );
  const xlsxResult = parseWorkbook(goodXlsx);
  assert(xlsxResult.ok, "a well-formed XLSX must parse");
  if (xlsxResult.ok) {
    assert(xlsxResult.rows.length === 1, `expected 1 accepted row, got ${xlsxResult.rows.length}`);
  }

  // ---- a missing required header is a structural failure ---------------------

  const missingHeader = buildWorkbookBuffer([
    ["asset_code", "point_key", "unit", "time"], // no value column
    ["F19-ASSET-1", "kw", "kW", "2026-08-19T10:00:00Z"],
  ]);
  // F2.7 PR 2 security review H2 — the same `XLSX.read` shape inflated a 1.3 MB
  // workbook to 2.5 GB RSS through `xl/sharedStrings.xml`; the declared
  // inflation is refused from the zip directory before a byte is inflated.
  const bombResult = parseWorkbook(syntheticZip([500 * 1024 * 1024]));
  assert(!bombResult.ok, "a zip declaring 500 MiB of inflation must be refused before it is read");
  if (!bombResult.ok) {
    assert(/when unpacked/.test(bombResult.reason), `the reason names the declared inflation, got: ${bombResult.reason}`);
  }

  const missingHeaderResult = parseWorkbook(missingHeader);
  assert(!missingHeaderResult.ok, "a missing required column must be a structural failure");
  if (!missingHeaderResult.ok) {
    assert(/value/i.test(missingHeaderResult.reason), `the reason must name the missing column, got: ${missingHeaderResult.reason}`);
  }

  // ---- neither asset_code nor asset_id present is a structural failure -------

  const noAssetRef = buildWorkbookBuffer([
    ["point_key", "value", "time"],
    ["kw", 12.5, "2026-08-19T10:00:00Z"],
  ]);
  const noAssetRefResult = parseWorkbook(noAssetRef);
  assert(!noAssetRefResult.ok, "a file with neither asset_code nor asset_id must be a structural failure");

  // ---- a non-numeric value is a per-row rejection, not structural ------------

  const badValue = buildWorkbookBuffer([HEADER, ["F19-ASSET-1", "kw", "not-a-number", "kW", "2026-08-19T10:00:00Z"]]);
  const badValueResult = parseWorkbook(badValue);
  assert(badValueResult.ok, "a bad value in one row must not fail the whole file");
  if (badValueResult.ok) {
    assert(badValueResult.rows.length === 0, "the row with a bad value must not be accepted");
    assert(badValueResult.rejected.length === 1, `expected 1 rejection, got ${badValueResult.rejected.length}`);
    assert(badValueResult.rejected[0]?.rowNumber === 2, "the rejection must carry the original row number");
    assert(badValueResult.rejected[0]?.field === "value", "the rejection must name the offending field");
  }

  // ---- a bad timestamp is a per-row rejection --------------------------------

  const badTime = buildWorkbookBuffer([HEADER, ["F19-ASSET-1", "kw", 12.5, "kW", "not-a-date"]]);
  const badTimeResult = parseWorkbook(badTime);
  assert(badTimeResult.ok, "a bad timestamp in one row must not fail the whole file");
  if (badTimeResult.ok) {
    assert(badTimeResult.rejected.length === 1, `expected 1 rejection, got ${badTimeResult.rejected.length}`);
    assert(badTimeResult.rejected[0]?.field === "time", "the rejection must name the time field");
  }

  // ---- an in-file duplicate (same asset ref + point key + time) rejects ------

  const duplicate = buildWorkbookBuffer([
    HEADER,
    ["F19-ASSET-1", "kw", 10, "kW", "2026-08-19T10:00:00Z"],
    ["F19-ASSET-1", "kw", 11, "kW", "2026-08-19T10:00:00Z"],
  ]);
  const duplicateResult = parseWorkbook(duplicate);
  assert(duplicateResult.ok, "a duplicate row must not fail the whole file");
  if (duplicateResult.ok) {
    assert(duplicateResult.rows.length === 1, `expected exactly 1 accepted row (the first), got ${duplicateResult.rows.length}`);
    assert(duplicateResult.rejected.length === 1, `expected exactly 1 rejected row (the second), got ${duplicateResult.rejected.length}`);
    assert(duplicateResult.rejected[0]?.rowNumber === 3, "the second (duplicate) occurrence must be the one rejected");
    assert(/row 2/.test(duplicateResult.rejected[0]?.reason ?? ""), "the rejection reason must point back at the first occurrence's row number");
  }

  // ---- an empty sheet (header only, no data rows) is a structural failure ----

  const emptySheet = buildWorkbookBuffer([HEADER]);
  const emptySheetResult = parseWorkbook(emptySheet);
  assert(!emptySheetResult.ok, "a header-only sheet must be a structural failure");

  // ---- a workbook with no sheets at all is a structural failure --------------
  // (`XLSX.write` itself refuses to serialise a sheet-less workbook, so an
  // empty buffer is the way to exercise `parseWorkbook`'s own "no sheets"
  // path rather than the writer's own guard.)

  const noSheetsResult = parseWorkbook(Buffer.alloc(0));
  assert(!noSheetsResult.ok, "a workbook with no sheets must be a structural failure");

  // ---- a genuinely unreadable buffer is a structural failure, not a throw ----

  const garbage = Buffer.from("this is not a spreadsheet at all \x00\x01\x02", "utf8");
  const garbageResult = parseWorkbook(garbage);
  assert(!garbageResult.ok, "an unreadable buffer must be reported, not thrown");

  // ---- a file one row over the cap is a structural failure -------------------

  const overCapRows: (string | number)[][] = [HEADER];
  for (let i = 0; i < MAX_IMPORT_ROWS + 1; i += 1) {
    overCapRows.push([`F19-ASSET-${i}`, "kw", 1, "kW", "2026-08-19T10:00:00Z"]);
  }
  const overCapResult = parseWorkbook(buildWorkbookBuffer(overCapRows, "csv"));
  assert(!overCapResult.ok, `a file with ${MAX_IMPORT_ROWS + 1} data rows must be refused as over the cap`);
  if (!overCapResult.ok) {
    assert(new RegExp(String(MAX_IMPORT_ROWS)).test(overCapResult.reason), "the reason must name the cap");
  }

  // ---- a file exactly at the cap is accepted structurally --------------------

  const atCapRows: (string | number)[][] = [HEADER];
  for (let i = 0; i < MAX_IMPORT_ROWS; i += 1) {
    atCapRows.push([`F19-ASSET-${i}`, "kw", 1, "kW", "2026-08-19T10:00:00Z"]);
  }
  const atCapResult = parseWorkbook(buildWorkbookBuffer(atCapRows, "csv"));
  assert(atCapResult.ok, `a file with exactly ${MAX_IMPORT_ROWS} data rows must be accepted structurally`);

  // ---- asset_id alone (no asset_code column) is a valid file shape -----------

  const byId = buildWorkbookBuffer([
    ["asset_id", "point_key", "value", "time"],
    ["00000000-0000-4000-8000-000000000001", "kw", 12.5, "2026-08-19T10:00:00Z"],
  ]);
  const byIdResult = parseWorkbook(byId);
  assert(byIdResult.ok, "a file keyed by asset_id must parse");
  if (byIdResult.ok) {
    assert(byIdResult.rows[0]?.assetId === "00000000-0000-4000-8000-000000000001", "asset_id must be carried through");
    assert(byIdResult.rows[0]?.assetCode === undefined, "assetCode must be absent when the file has no asset_code column");
  }

  // ---- a missing point_key is a per-row rejection -----------------------------

  const missingPointKey = buildWorkbookBuffer([HEADER, ["F19-ASSET-1", "", 12.5, "kW", "2026-08-19T10:00:00Z"]]);
  const missingPointKeyResult = parseWorkbook(missingPointKey);
  assert(missingPointKeyResult.ok, "a missing point_key in one row must not fail the whole file");
  if (missingPointKeyResult.ok) {
    assert(missingPointKeyResult.rejected[0]?.field === "pointKey", "the rejection must name pointKey");
  }

  // ---- a row missing both asset_code and asset_id is rejected per-row --------

  const missingAssetRef = buildWorkbookBuffer([HEADER, ["", "kw", 12.5, "kW", "2026-08-19T10:00:00Z"]]);
  const missingAssetRefResult = parseWorkbook(missingAssetRef);
  assert(missingAssetRefResult.ok, "a row missing its asset reference must not fail the whole file");
  if (missingAssetRefResult.ok) {
    assert(missingAssetRefResult.rejected[0]?.field === "assetCode", "the rejection must name the asset reference field");
  }

  // ---- a real Excel date-time cell (not a string) parses correctly (C1) -----
  // A cell where the user picked a date/time in Excel comes back from
  // `XLSX.read` as a numeric serial, decoded via `parse_date_code` — only
  // trusted for a genuine binary workbook (`isBinarySpreadsheet`), unlike
  // the CSV numeric-guess cases above.

  const realDateTime = new Date(Date.UTC(2026, 7, 19, 10, 30, 0));
  const dateTimeCellResult = parseWorkbook(
    buildWorkbookBufferWithDates([HEADER, ["F19-ASSET-1", "kw", 12.5, "kW", realDateTime]]),
  );
  assert(dateTimeCellResult.ok, "a file with a real Excel datetime cell must parse");
  if (dateTimeCellResult.ok) {
    assert(dateTimeCellResult.rejected.length === 0, `a real datetime cell must not be rejected, got ${JSON.stringify(dateTimeCellResult.rejected)}`);
    assert(
      dateTimeCellResult.rows[0]?.time === realDateTime.toISOString(),
      `expected time ${realDateTime.toISOString()}, got ${dateTimeCellResult.rows[0]?.time}`,
    );
  }

  // ---- a real Excel date-ONLY cell (midnight, no time-of-day) parses too ----
  // The other C1 failure mode: a date-only cell reads as a serial integer,
  // which parses to a plausible-looking but WRONG far-future date if
  // stringified and re-parsed rather than read as the Date it already is.

  const realDateOnly = new Date(Date.UTC(2026, 7, 19));
  const dateOnlyCellResult = parseWorkbook(
    buildWorkbookBufferWithDates([HEADER, ["F19-ASSET-1", "kw", 12.5, "kW", realDateOnly]]),
  );
  assert(dateOnlyCellResult.ok, "a file with a real Excel date-only cell must parse");
  if (dateOnlyCellResult.ok) {
    assert(dateOnlyCellResult.rejected.length === 0, "a real date-only cell must not be rejected");
    assert(
      dateOnlyCellResult.rows[0]?.time === realDateOnly.toISOString(),
      `expected time ${realDateOnly.toISOString()}, got ${dateOnlyCellResult.rows[0]?.time}`,
    );
  }

  // ---- a blank row in the middle must not shift later row numbers (C4) ------

  const withBlankRow = buildWorkbookBuffer([
    HEADER,
    ["F19-ASSET-1", "kw", 10, "kW", "2026-08-19T10:00:00Z"], // row 2 — good
    ["", "", "", "", ""], // row 3 — blank, must be silently skipped
    ["F19-ASSET-1", "kw", "not-a-number", "kW", "2026-08-19T10:00:00Z"], // row 4 — bad value
  ]);
  const withBlankRowResult = parseWorkbook(withBlankRow);
  assert(withBlankRowResult.ok, "a file with a blank row must not fail structurally");
  if (withBlankRowResult.ok) {
    assert(withBlankRowResult.rows.length === 1, `expected 1 accepted row, got ${withBlankRowResult.rows.length}`);
    assert(withBlankRowResult.rows[0]?.rowNumber === 2, "the first good row must still be numbered 2");
    assert(withBlankRowResult.rejected.length === 1, `expected 1 rejection, got ${withBlankRowResult.rejected.length}`);
    assert(
      withBlankRowResult.rejected[0]?.rowNumber === 4,
      `the bad-value row after the blank must be numbered 4 (its true sheet row), got ${withBlankRowResult.rejected[0]?.rowNumber}`,
    );
  }

  // ---- the row cap counts blank rows too, matching what the sheet counts ----

  const capWithBlanksRows: (string | number)[][] = [HEADER];
  for (let i = 0; i < MAX_IMPORT_ROWS; i += 1) {
    capWithBlanksRows.push([`F19-ASSET-${i}`, "kw", 1, "kW", "2026-08-19T10:00:00Z"]);
  }
  capWithBlanksRows.push(["", "", "", "", ""]); // one blank row over the cap
  const capWithBlanksResult = parseWorkbook(buildWorkbookBuffer(capWithBlanksRows, "csv"));
  assert(
    !capWithBlanksResult.ok,
    "a blank row that pushes the sheet one row past the cap must still be refused as over the cap",
  );
}

/**
 * `F4.101`: the column span a sheet may cost is bounded before anything
 * densifies it.
 *
 * `sheetRows` bounds rows only, and `sheet_to_json` materialises every cell of
 * the **declared** range whether or not a cell is really there. SheetJS clamps
 * the column span solely inside its row-clamp branch, which never fires while
 * the declared end row is under `SHEET_ROWS_BOUND` — so a workbook could
 * declare `A1:XFD20102`, hold two real cells, weigh 2,668 bytes, and cost 3.29
 * billion cells to read. Measured through the real `parseWorkbook`: the process
 * died with `JavaScript heap out of memory` after 78.9 s at a 512 MiB heap cap
 * and after 331.9 s at 2 GiB — a bigger heap postpones the kill, it does not
 * prevent it. The request writes nothing and is repeatable.
 *
 * The gates below are split deliberately, because the obvious end-to-end
 * assertion does not gate this at all: "the wide sheet still returns its one
 * row" passes against the defect too — just 56 s later. So:
 *
 * - the **ceiling** is asserted against {@link columnBoundedRange} directly, on
 *   the worst range a workbook can declare, with no fixture to build;
 * - the **wiring** is asserted through `parseWorkbook` by a case whose *result*
 *   differs depending on whether the bounded range actually reached
 *   `sheet_to_json` — computing the bound and not passing it must go red;
 * - the **anchor** `F4.100` depends on is asserted separately, because a bound
 *   that moved the range's `s` would silently shift every column by one.
 */
export function runTelemetryImportColumnBoundTests(): void {
  const emptySheet = {} as XLSX.WorkSheet;

  // ---- the ceiling, on the worst range a workbook can declare --------------
  // 20,102 rows x 16,384 columns = 329,351,168 cells before the bound.
  const worst = columnBoundedRange(emptySheet, { s: { r: 0, c: 0 }, e: { r: SHEET_ROWS_BOUND - 1, c: 16_383 } });
  assert(worst.ok, "the worst declarable range must be bounded, not refused — no recognised header sits in it");
  if (worst.ok) {
    const width = worst.range.e.c - worst.range.s.c + 1;
    assert(width === MAX_HEADER_COLUMNS, `the widest read must be ${MAX_HEADER_COLUMNS} columns, got ${width}`);
    const cells = (worst.range.e.r - worst.range.s.r + 1) * width;
    assert(
      cells <= SHEET_ROWS_BOUND * MAX_HEADER_COLUMNS,
      `the worst declarable range must cost at most ${SHEET_ROWS_BOUND * MAX_HEADER_COLUMNS} cells, got ${cells}`,
    );
    // The rows are NOT bounded here — that is `SHEET_ROWS_BOUND`'s job, and a
    // column bound that also moved the end row would break the cap check.
    assert(worst.range.e.r === SHEET_ROWS_BOUND - 1, "the column bound must not move the range's end row");
  }

  // ---- the anchor `F4.100` depends on: `s` is never moved ------------------
  // `sheet_to_json` indexes `raw` from the range it is given, on both axes,
  // while `firstSheetColIndex` counts from `!ref`. A bound that snapped `s.c`
  // to 0 makes the two disagree, and the absolute time read lands one column
  // past `time`.
  //
  // This assertion is not redundant with `F4.100`'s four-origin suite —
  // measured, that suite stays GREEN under the snapped bound. The two shifts
  // cancel for everything taken out of `raw`, and the absolute read is rescued
  // by `rawCellText`'s `?? cellText(row, timeIdx)` fallback whenever the column
  // it lands on is empty, as it is in those fixtures. A sheet with an ISO
  // timestamp in that column would be read at the wrong instant instead, which
  // is the `F4.100` defect returning. Hence the invariant is held here,
  // directly on the returned range, rather than left to a fixture to imply.
  const bOrigin = columnBoundedRange(emptySheet, { s: { r: 1, c: 1 }, e: { r: 199, c: 700 } });
  assert(bOrigin.ok, "a B2-origin range with no recognised header beyond the window must be bounded");
  if (bOrigin.ok) {
    assert(bOrigin.range.s.c === 1, `the bounded range must keep its own first column, got ${bOrigin.range.s.c}`);
    assert(bOrigin.range.s.r === 1, `the bounded range must keep its own first row, got ${bOrigin.range.s.r}`);
    assert(
      bOrigin.range.e.c === 1 + MAX_HEADER_COLUMNS - 1,
      `the window is counted from the range's own first column, expected ${MAX_HEADER_COLUMNS} wide, got ${bOrigin.range.e.c - bOrigin.range.s.c + 1}`,
    );
  }

  // ---- a sheet already narrower than the window is returned untouched ------
  const narrow = columnBoundedRange(emptySheet, { s: { r: 0, c: 0 }, e: { r: 9, c: 4 } });
  assert(narrow.ok && narrow.range.e.c === 4, "a sheet narrower than the window must keep its own width");

  // ---- a `<dimension>` wider than the XLSX format allows -------------------
  // `safe_decode_range` accumulates column letters with no XFD clamp, so a
  // hand-written `<dimension ref="A1:AAAAAAAA20102"/>` decodes to 8,353,082,582
  // columns from a ~2.4 KB upload — measured. `HEADER_SCAN_COLUMN_CEILING` is
  // the only thing bounding the scan for that input, and no fixture below is
  // wide enough to bind it, so it is asserted here or it is not asserted at all.
  const malformedStart = performance.now();
  const malformed = columnBoundedRange(emptySheet, { s: { r: 0, c: 0 }, e: { r: SHEET_ROWS_BOUND - 1, c: 8_353_082_582 } });
  const malformedMs = performance.now() - malformedStart;
  assert(malformed.ok, "a dimension wider than the format allows must be bounded, not refused");
  if (malformed.ok) {
    assert(
      malformed.range.e.c - malformed.range.s.c + 1 === MAX_HEADER_COLUMNS,
      `a malformed dimension must still read ${MAX_HEADER_COLUMNS} columns, got ${malformed.range.e.c - malformed.range.s.c + 1}`,
    );
  }
  // Generous by 3 orders of magnitude against the ~5 ms this takes bounded, and
  // against the minutes it takes unbounded — a ceiling, not a benchmark.
  assert(malformedMs < 5_000, `the header scan must be bounded, took ${malformedMs.toFixed(0)} ms`);

  // ---- the WIRING: the bounded range must actually reach sheet_to_json -----
  // Row 3 is empty in every named column and carries a stray note far to the
  // right, past the window. Read bounded, it is a blank row — silently skipped,
  // as a spacer row always was. Read unbounded, it is a row with content and no
  // asset reference, so it lands in `rejected`. Nothing else in this file tells
  // the two apart, and computing the bound without passing it fails here.
  const strayColumn = 99;
  const strayHeader = [...HEADER];
  const goodRow: (string | number)[] = ["F19-ASSET-1", "kw", 12.5, "kW", "2026-08-19T10:00:00Z"];
  const strayRow: (string | number)[] = ["", "", "", "", ""];
  for (let c = HEADER.length; c <= strayColumn; c += 1) {
    strayHeader[c] = "";
    goodRow[c] = "";
    strayRow[c] = c === strayColumn ? "a note the importer never reads" : "";
  }
  const strayResult = parseWorkbook(buildWorkbookBufferDeclaring([strayHeader, goodRow, strayRow], "A1:ZZ200"));
  assert(strayResult.ok, `a sheet declaring a wide range must still parse, got ${JSON.stringify(strayResult)}`);
  if (strayResult.ok) {
    assert(strayResult.rows.length === 1, `expected the one real row, got ${strayResult.rows.length}`);
    assert(strayResult.rows[0]?.rowNumber === 2, `the real row must still be numbered 2, got ${strayResult.rows[0]?.rowNumber}`);
    assert(strayResult.rows[0]?.time === "2026-08-19T10:00:00.000Z", `the real row must keep its instant, got ${strayResult.rows[0]?.time}`);
    assert(
      strayResult.rejected.length === 0,
      `a row whose only content is outside the read window is a spacer row, not a rejection — got ${JSON.stringify(strayResult.rejected)}`,
    );
  }

  // ---- a recognised header beyond the window refuses the file, by name -----
  // Fail closed, and say what is wrong. Without this the file would fail later
  // as "Missing required column 'time'", blaming the operator's sheet for a
  // bound this parser imposes — the same "blame the data for a parser fault"
  // shape `F4.100` closed on the column axis.
  const farHeader: (string | number)[] = [];
  const farData: (string | number)[] = [];
  for (let c = 0; c <= strayColumn; c += 1) {
    farHeader[c] = c === 0 ? "asset_code" : c === 1 ? "point_key" : c === 2 ? "value" : `spare_${c}`;
    farData[c] = c === 0 ? "F19-ASSET-1" : c === 1 ? "kw" : c === 2 ? "12.5" : "";
  }
  farHeader[strayColumn] = "time";
  farData[strayColumn] = "2026-08-19T10:00:00Z";
  const farResult = parseWorkbook(buildWorkbookBuffer([farHeader, farData]));
  assert(!farResult.ok, "a sheet whose `time` column sits beyond the window must be refused");
  if (!farResult.ok) {
    assert(farResult.reason.includes("'time'"), `the refusal must name the column, got ${farResult.reason}`);
    assert(
      farResult.reason.includes(XLSX.utils.encode_col(strayColumn)),
      `the refusal must name where the column is (${XLSX.utils.encode_col(strayColumn)}), got ${farResult.reason}`,
    );
  }

  // ---- the same header ALSO inside the window is not a refusal ------------
  // `indexOf` takes the first, so the in-window column is the one that would
  // have been read anyway; refusing here would reject a sheet that works.
  const duplicateHeader = [...farHeader];
  const duplicateData = [...farData];
  duplicateHeader[4] = "time";
  duplicateData[4] = "2026-08-19T11:00:00Z";
  const duplicateResult = parseWorkbook(buildWorkbookBuffer([duplicateHeader, duplicateData]));
  assert(duplicateResult.ok, `a duplicate header inside the window must not be refused, got ${JSON.stringify(duplicateResult)}`);
  if (duplicateResult.ok) {
    assert(
      duplicateResult.rows[0]?.time === "2026-08-19T11:00:00.000Z",
      `the in-window column is the one read, expected 11:00, got ${duplicateResult.rows[0]?.time}`,
    );
  }

  // ---- a header row of long cells is bounded per cell, not just per column -
  // SheetJS dedupes shared strings, so ONE long string referenced from every
  // scanned column multiplies its own length by the column count, and neither
  // upload guard bounds that product. The scanned width is already bounded; this
  // holds the other factor.
  //
  // The fixture is the full scan width against the string length the security
  // review measured, because the previous one (201 columns of 5,000 characters,
  // ~1M character operations) cost milliseconds either way — it asserted a
  // ceiling nothing could breach, so disabling the bound left the suite green.
  // Unbounded, this input took 204 s; `U+0130` is the expensive case, since
  // `toLowerCase` expands it to two code units as it copies.
  const longCell = "İ".repeat(131_068);
  const longSheet: XLSX.WorkSheet = {};
  for (let c = 0; c <= 16_383; c += 1) {
    longSheet[XLSX.utils.encode_cell({ r: 0, c })] = { t: "s", v: longCell };
  }
  const longStart = performance.now();
  const longResult = columnBoundedRange(longSheet, { s: { r: 0, c: 0 }, e: { r: 199, c: 16_383 } });
  const longMs = performance.now() - longStart;
  assert(longResult.ok, "a header row of long cells holds no recognised header, so it must be bounded not refused");
  assert(longMs < 5_000, `a header row of long cells must not be normalised in full, took ${longMs.toFixed(0)} ms`);

  // ---- a PADDED recognised header beyond the window is still recognised ----
  // The per-cell bound must be applied the way the header row itself is read —
  // `parseWorkbook` normalises `String(cell).trim().toLowerCase()`, so a cell
  // whose padding pushes it past the bound is still a real header once trimmed.
  // Testing the raw length instead made the two disagree: the parser saw
  // `time`, the window logic saw `""`, and the file failed as "Missing required
  // column 'time'" — the exact message this refusal exists to replace, on a
  // sheet that parsed before `F4.101` (post-merge review, C2).
  const paddedHeader: (string | number)[] = [];
  const paddedData: (string | number)[] = [];
  for (let c = 0; c <= strayColumn; c += 1) {
    paddedHeader[c] = c === 0 ? "asset_code" : c === 1 ? "point_key" : c === 2 ? "value" : `spare_${c}`;
    paddedData[c] = c === 0 ? "F19-ASSET-1" : c === 1 ? "kw" : c === 2 ? "12.5" : "";
  }
  paddedHeader[strayColumn] = `${" ".repeat(80)}time${" ".repeat(80)}`;
  paddedData[strayColumn] = "2026-08-19T10:00:00Z";
  const paddedResult = parseWorkbook(buildWorkbookBuffer([paddedHeader, paddedData]));
  assert(!paddedResult.ok, "a whitespace-padded `time` beyond the window must be refused");
  if (!paddedResult.ok) {
    // The column LETTER, not the header name: the fallback this exists to
    // replace is `Missing required column 'time'`, which also contains `'time'`
    // and so cannot tell the two refusals apart. Only the by-name refusal says
    // where the column is.
    assert(
      paddedResult.reason.includes(XLSX.utils.encode_col(strayColumn)),
      `a padded header is still that header — the refusal must say where it is, got ${paddedResult.reason}`,
    );
  }

  // ---- the asset-reference headers are recognised beyond the window too ----
  // `asset_code` and `asset_id` were in `RECOGNISED_HEADERS` but nothing
  // asserted them: removing either left the suite green while a sheet carrying
  // it beyond the window degraded to "Missing required column 'asset_code' or
  // 'asset_id'" (post-merge review, F1).
  for (const assetHeader of ["asset_code", "asset_id"]) {
    const assetRowHeader: (string | number)[] = [];
    const assetRowData: (string | number)[] = [];
    for (let c = 0; c <= strayColumn; c += 1) {
      assetRowHeader[c] = c === 0 ? "point_key" : c === 1 ? "value" : c === 2 ? "time" : `spare_${c}`;
      assetRowData[c] = c === 0 ? "kw" : c === 1 ? "12.5" : c === 2 ? "2026-08-19T10:00:00Z" : "";
    }
    assetRowHeader[strayColumn] = assetHeader;
    assetRowData[strayColumn] = "F19-ASSET-1";
    const assetResult = parseWorkbook(buildWorkbookBuffer([assetRowHeader, assetRowData]));
    assert(!assetResult.ok, `a ${assetHeader} column beyond the window must be refused`);
    if (!assetResult.ok) {
      // Again the column letter: the fallback is `Missing required column
      // 'asset_code' or 'asset_id'`, which names BOTH headers, so asserting the
      // name would pass against the defect too.
      assert(
        assetResult.reason.includes(XLSX.utils.encode_col(strayColumn)),
        `the refusal must say where ${assetHeader} is, got ${assetResult.reason}`,
      );
    }
  }

  // ---- a case-variant header beyond the window is still recognised ---------
  // `headerCellText` lower-cases; without that the refusal below degrades to
  // "Missing required column 'time'", which is the message this row exists to
  // stop the parser giving.
  const casedHeader: (string | number)[] = [];
  const casedData: (string | number)[] = [];
  for (let c = 0; c <= strayColumn; c += 1) {
    casedHeader[c] = c === 0 ? "asset_code" : c === 1 ? "point_key" : c === 2 ? "value" : `spare_${c}`;
    casedData[c] = c === 0 ? "F19-ASSET-1" : c === 1 ? "kw" : c === 2 ? "12.5" : "";
  }
  casedHeader[strayColumn] = "TiMe";
  casedData[strayColumn] = "2026-08-19T10:00:00Z";
  const casedResult = parseWorkbook(buildWorkbookBuffer([casedHeader, casedData]));
  assert(!casedResult.ok, "a case-variant `time` beyond the window must be refused");
  if (!casedResult.ok) {
    assert(
      casedResult.reason.includes("'time'"),
      `the refusal must name the column in its canonical spelling, got ${casedResult.reason}`,
    );
  }

  // ---- an OPTIONAL recognised header beyond the window is refused too ------
  // `unit` is optional, so dropping it silently would import the same rows with
  // different data rather than failing. Fail closed instead.
  const farUnitHeader: (string | number)[] = [];
  const farUnitData: (string | number)[] = [];
  for (let c = 0; c <= strayColumn; c += 1) {
    farUnitHeader[c] =
      c === 0 ? "asset_code" : c === 1 ? "point_key" : c === 2 ? "value" : c === 3 ? "time" : `spare_${c}`;
    farUnitData[c] = c === 0 ? "F19-ASSET-1" : c === 1 ? "kw" : c === 2 ? "12.5" : c === 3 ? "2026-08-19T10:00:00Z" : "";
  }
  farUnitHeader[strayColumn] = "unit";
  farUnitData[strayColumn] = "kW";
  const farUnitResult = parseWorkbook(buildWorkbookBuffer([farUnitHeader, farUnitData]));
  assert(!farUnitResult.ok, "an optional `unit` column beyond the window must be refused, not silently dropped");
  if (!farUnitResult.ok) {
    assert(farUnitResult.reason.includes("'unit'"), `the refusal must name the column, got ${farUnitResult.reason}`);
  }
}
