import * as XLSX from "xlsx";

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

const HEADER = ["asset_code", "point_key", "value", "unit", "time"];

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
}
