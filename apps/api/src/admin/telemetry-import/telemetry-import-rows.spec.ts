import * as XLSX from "xlsx";

import { syntheticZip } from "../../testing/synthetic-zip";
import { MAX_IMPORT_ROWS, parseWorkbook } from "./telemetry-import-rows";

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
 * The same workbook with a blank Excel row 1: the rows are written from `A2`
 * and `!ref` is hand-set to match, which is what a sheet with a row inserted
 * above the header looks like on disk (`aoa_to_sheet([[]])` alone leaves a
 * `!ref` of `A1:A1`).
 */
function buildWorkbookBufferFromRowTwo(rows: (string | number)[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([[]]);
  XLSX.utils.sheet_add_aoa(sheet, rows, { origin: "A2" });
  sheet["!ref"] = XLSX.utils.encode_range({ s: { r: 1, c: 0 }, e: { r: rows.length, c: (rows[0]?.length ?? 1) - 1 } });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Import");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
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
 * The at-cap case is asserted as `rows + rejected`, not as `rows`: this parser
 * still assumes the header is absolute row 0 when it re-reads a time cell's
 * source text, so an A2-origin data row is rejected on `time` rather than
 * accepted. That is `F1.9`'s own defect (correction 56 was never applied here)
 * and it is not this change's to fix; what matters for the cap is that all
 * 20,000 rows reached the row loop instead of being cut.
 */
export function runTelemetryImportRangeStartTests(): void {
  const overCapRows: (string | number)[][] = [HEADER];
  for (let i = 0; i < MAX_IMPORT_ROWS + 1; i += 1) {
    overCapRows.push([`F19-ASSET-${i}`, "kw", 1, "kW", "2026-08-19T10:00:00Z"]);
  }
  const overCapResult = parseWorkbook(buildWorkbookBufferFromRowTwo(overCapRows));
  assert(!overCapResult.ok, `${MAX_IMPORT_ROWS + 1} data rows under a header on Excel row 2 must be refused as over the cap`);

  const atCapRows: (string | number)[][] = [HEADER];
  for (let i = 0; i < MAX_IMPORT_ROWS; i += 1) {
    atCapRows.push([`F19-ASSET-${i}`, "kw", 1, "kW", "2026-08-19T10:00:00Z"]);
  }
  const atCapResult = parseWorkbook(buildWorkbookBufferFromRowTwo(atCapRows));
  assert(atCapResult.ok, `exactly ${MAX_IMPORT_ROWS} data rows under a header on Excel row 2 must be accepted structurally`);
  if (atCapResult.ok) {
    const seen = atCapResult.rows.length + atCapResult.rejected.length;
    assert(seen === MAX_IMPORT_ROWS, `every one of the ${MAX_IMPORT_ROWS} data rows reached the row loop, got ${seen}`);
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
