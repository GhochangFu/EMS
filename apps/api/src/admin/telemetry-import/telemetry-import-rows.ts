import * as XLSX from "xlsx";

import { zipInflationProblem } from "../spreadsheet-guard";

/**
 * Pure, DB-free CSV/Excel row parsing for telemetry bulk import (`F1.9`).
 *
 * Mirrors `onboarding-excel.service.ts`'s use of `XLSX.read` — the same
 * function reads both CSV and XLSX buffers, so there is one code path for
 * both formats. This module only ever inspects and validates the SHAPE of a
 * row (is `value` a finite number, is `time` parsable, is there an asset
 * reference at all). It never touches the database: asset-code resolution,
 * scope checks, catalog checks and the write itself are
 * `TelemetryImportService`'s job, which composes this with
 * `TelemetryWriteService` (Phase A, frozen).
 */

/** The row cap decided in the plan's tunables section (`F1.9`). */
export const MAX_IMPORT_ROWS = 20_000;

/**
 * How far below Excel row 1 a sheet's used range may start and still be read
 * whole (`F2.7` post-merge code review, finding 1).
 *
 * `sheetRows` counts **absolute** rows from 0, so a blank row inserted above
 * the header spends one of them. Bounded at `MAX_IMPORT_ROWS + 2` exactly, a
 * sheet whose header sits on Excel row 2 came back cut to the bound with
 * exactly `MAX_IMPORT_ROWS` data rows in it — indistinguishable from a sheet
 * that really holds the cap, so the cap could not trip and the rest of a
 * 25,000-row file was dropped in silence. The slack makes the two
 * distinguishable for a header anywhere in Excel rows 1–101 — measured, a sheet
 * at the cap whose header is on Excel row 101 ends at absolute row 20,100 and
 * is read whole, and one on row 102 ends at the bound and is refused. A header
 * below that, on a sheet at the cap, is refused rather than truncated — fail
 * closed (see {@link SHEET_ROWS_BOUND}).
 */
export const MAX_RANGE_START_ROW = 100;

/**
 * What `XLSX.read` is allowed to materialise: the header, the cap, one overflow
 * row so a file exactly one row over the cap is still seen as over it, and
 * {@link MAX_RANGE_START_ROW} rows of slack for a used range that starts below
 * row 1. Both parsers read with this bound and both refuse a sheet that
 * **reached** it — reaching the bound means the sheet may have been cut, and a
 * cut sheet must never be imported as if it were whole.
 */
export const SHEET_ROWS_BOUND = MAX_IMPORT_ROWS + 2 + MAX_RANGE_START_ROW;

/**
 * How wide a window, counted from the first column of the sheet's used range,
 * the importer reads (`F4.101`; 64 is the owner's ruling, as
 * {@link MAX_RANGE_START_ROW} was).
 *
 * `sheetRows` bounds rows only. `sheet_to_json` densifies every cell of the
 * **declared** range on both axes, and SheetJS clamps the column span solely
 * inside its row-clamp branch — which never fires for a range whose declared
 * end row is *under* {@link SHEET_ROWS_BOUND}. A workbook may therefore declare
 * `<dimension ref="A1:XFD20102"/>` while holding two real cells, cost nothing
 * to read, and cost 20,102 × 16,384 = 3.29 **billion** cells to densify.
 * Measured on the pinned xlsx 0.20.3, through the real `parseWorkbook`, from a
 * **2,668-byte** upload: the process died with `JavaScript heap out of memory`
 * after 78.9 s at a 512 MiB heap cap and after 331.9 s at 2 GiB. A larger heap
 * postpones the kill proportionally rather than preventing it — at the measured
 * ~48 bytes per cell the range needs about 150 GiB. Smaller declarations stall
 * instead of dying: 16,384 × 2,000 took 56.0 s and 1.5 GiB from 2,667 bytes.
 * The request writes nothing and is repeatable, so it is a denial of service
 * against the whole API, not against one import.
 *
 * It bounds a second path as well, which is easy to miss because the row clamp
 * looks like it already covers it: when that clamp *does* fire it sets
 * `tmpref.e.c = min(declared, refguess.e.c)`, and `refguess` is measured from
 * the cells actually present — so one real cell at XFD leaves `refguess.e.c` at
 * 16,383 and the clamped range is still 20,102 × 16,384. A declared end row
 * *over* the bound is therefore no safer than one under it.
 *
 * This parser names six columns, so 64 leaves 58 for whatever else an
 * operator's sheet carries beside them, and bounds the worst case a sheet can
 * still buy at 20,102 × 64 = 1,286,528 cells. The window is applied to the *read*,
 * and a recognised header found beyond it refuses the file by name rather than
 * being dropped — see {@link columnBoundedRange}. AGENTS.md §4.3: a size cap on
 * the upload is not a bound on the work.
 */
export const MAX_HEADER_COLUMNS = 64;

/**
 * How far right {@link columnBoundedRange} looks for a misplaced header. The
 * XLSX format stops at 16,384 columns (XFD), so this only bounds the scan of a
 * *malformed* `<dimension>` that declares more than the format allows.
 */
const HEADER_SCAN_COLUMN_CEILING = 16_384;

const REQUIRED_HEADERS = ["point_key", "value", "time"] as const;

/**
 * Every header this parser reads — the three required ones, the two that
 * satisfy the asset reference, and optional `unit`. A recognised header outside
 * the read window is refused rather than ignored: dropping `unit` silently
 * would change the imported data, and dropping a required one would blame the
 * operator's file for a bound they cannot see.
 */
const RECOGNISED_HEADERS: ReadonlySet<string> = new Set([...REQUIRED_HEADERS, "asset_code", "asset_id", "unit"]);

export type ParsedImportRow = {
  /**
   * 1-based, matching what the operator sees in Excel. The header is the first
   * row of the sheet's **used range**, which is Excel row 1 only when nothing
   * sits above it; a workbook saved with a blank row inserted above the header
   * has its header on row 2 and its first data row on row 3.
   */
  readonly rowNumber: number;
  readonly assetId?: string;
  readonly assetCode?: string;
  readonly pointKey: string;
  readonly value: number;
  readonly unit?: string;
  /** ISO-8601, normalised from whatever the sheet cell parsed to. */
  readonly time: string;
};

export type ImportRowRejection = {
  readonly rowNumber: number;
  readonly field: string | null;
  readonly reason: string;
};

export type ParseWorkbookResult =
  | { readonly ok: true; readonly rows: ParsedImportRow[]; readonly rejected: ImportRowRejection[] }
  | { readonly ok: false; readonly reason: string };

type SheetCell = string | number | boolean;

function cellText(row: SheetCell[], index: number): string {
  if (index < 0) {
    return "";
  }
  const cell = row[index];
  return cell === undefined || cell === null ? "" : String(cell).trim();
}

function isBlankRow(row: SheetCell[]): boolean {
  return row.every((cell) => String(cell ?? "").trim() === "");
}

/**
 * Matches ISO-8601 only: `YYYY-MM-DD` optionally followed by a `T`/space
 * time-of-day and an optional `Z`/numeric offset. Deliberately rejects every
 * other shape — `DD/MM/YYYY`, `MM/DD/YYYY`, `DD-MM-YYYY` and similar are
 * locale-ambiguous and must fail closed, never guessed.
 */
const ISO_8601_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/**
 * Parses `text` as strict ISO-8601, UTC-safe on every host. An offset/`Z`
 * suffix is handed to `Date.parse` (spec-correct for that shape); a bare
 * date or date-time with no offset is explicitly asserted as UTC via
 * `Date.UTC` rather than `Date.parse`, which treats an offset-less
 * date-TIME string as local time per ECMA-262 — the same host-dependent
 * shift this module exists to avoid. Returns `NaN` for anything else,
 * including every locale-ambiguous separator shape.
 */
function parseStrictIsoUtc(text: string): number {
  const m = ISO_8601_RE.exec(text);
  if (!m) {
    return Number.NaN;
  }
  const [, y, mo, d, h, mi, s, frac, zone] = m;
  if (zone) {
    return Date.parse(text);
  }
  return Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    h ? Number(h) : 0,
    mi ? Number(mi) : 0,
    s ? Number(s) : 0,
    frac ? Math.round(Number(frac) * 1000) : 0,
  );
}

/**
 * Whether `book` came from a genuine binary spreadsheet format (XLSX, XLS,
 * XLSB, ODS, …) rather than CSV/plain text. SheetJS sets `bookType` for the
 * former and leaves it `undefined` for the latter — checked empirically
 * against the installed xlsx build (ADR 0035), not assumed. Only a genuine
 * binary date-serial cell is timezone-agnostic and safe to trust
 * numerically; a CSV cell that merely *looks* like a date to SheetJS's own
 * type-guessing (e.g. `03/08/2026`) is not — see `ISO_8601_RE` above.
 */
function isBinarySpreadsheet(book: XLSX.WorkBook): boolean {
  return book.bookType !== undefined && book.bookType !== "csv" && book.bookType !== "txt";
}

/**
 * The exact original text SheetJS read for a cell, bypassing whatever type
 * it guessed the value into (`.v`) — SheetJS preserves the source text on
 * `.w` even for a CSV cell it silently converted to a numeric date serial.
 */
function rawCellText(sheet: XLSX.WorkSheet, sheetRowIndex: number, colIndex: number): string | undefined {
  if (colIndex < 0) {
    return undefined;
  }
  const addr = XLSX.utils.encode_cell({ r: sheetRowIndex, c: colIndex });
  return sheet[addr]?.w;
}

/**
 * How much of one header cell is normalised before it is compared.
 *
 * Bounding the scanned *width* is not enough on its own. SheetJS dedupes shared
 * strings, so one long string referenced from every column of the header row
 * multiplies its own length by the column count, and neither
 * `zipInflationProblem` (64 MiB declared) nor `MAX_IMPORT_FILE_BYTES` (5 MiB)
 * bounds that product — 16,320 columns sharing a 131,068-character string took
 * 204 s to normalise, measured. `toLowerCase` is the expensive half, because
 * some code points (`U+0130`) expand as it copies.
 *
 * 1,024 is far past any legible header — the longest this parser recognises is
 * `asset_code`, at ten characters — and it leaves room for a header a person
 * has padded with whitespace, which {@link headerCellText} must still read as
 * that header.
 */
const MAX_HEADER_CELL_SCAN_CHARS = 1_024;

/**
 * A header cell, addressed absolutely and normalised **exactly the way
 * `parseWorkbook` normalises `headerRow`** — `String(cell).trim().toLowerCase()`
 * — because the two are compared against the same set and a disagreement
 * between them is a defect, not a nuance.
 *
 * The `slice` bounds the work to a constant per cell without changing that
 * normalisation for any legible header. It comes *before* `trim` deliberately:
 * an earlier version tested the raw, untrimmed length instead and returned `""`
 * for anything longer, so a `time` header padded with 61 or more characters of
 * whitespace read as `time` to the parser and as `""` here. The file then failed
 * as `Missing required column 'time'` — the very message
 * {@link columnBoundedRange}'s by-name refusal exists to replace — on a sheet
 * that parsed before `F4.101` (post-merge review, C2).
 *
 * Reads `.v` rather than `rawCellText`'s `.w` because `sheet_to_json` is called
 * with no `raw` key, which SheetJS resolves to `raw: true` — so `raw[0]` holds
 * `.v` too, and comparing `.v` here is comparing like with like. (`.w` is the
 * formatted source text, which the time column needs and a header does not, and
 * a cell can carry one without the other.) Mirrors `F2.7`'s sibling
 * `cellText(sheet, r, c)`.
 */
function headerCellText(sheet: XLSX.WorkSheet, r: number, c: number): string {
  const cell = sheet[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
  if (cell === undefined || cell.v === undefined || cell.v === null) {
    return "";
  }
  return String(cell.v).slice(0, MAX_HEADER_CELL_SCAN_CHARS).trim().toLowerCase();
}

/**
 * The range `sheet_to_json` may densify, or the sentence that refuses the sheet
 * (`F4.101`).
 *
 * Bounds the **column** span to {@link MAX_HEADER_COLUMNS} counted from the
 * range's own first column, which is what stops a declared-but-empty range from
 * costing billions of cells. Two properties matter and each is load-bearing:
 *
 * - **`s` is copied unchanged.** `sheet_to_json` indexes `raw` from the range
 *   it is given, on both axes, so `F4.100`'s `headerSheetRowIndex` /
 *   `firstSheetColIndex` arithmetic stays correct only while the range handed
 *   to it starts exactly where `!ref` does. Snapping `s.c` to 0 shifts every
 *   index out of `raw` one column right on a B-origin sheet while
 *   `firstSheetColIndex` still counts from `!ref`, so the absolute address
 *   lands one column past `time`.
 *
 *   `F4.100`'s four-origin suite does **not** catch that — measured. The two
 *   shifts cancel for everything read out of `raw`, and the absolute read is
 *   rescued by `rawCellText`'s `?? cellText(row, timeIdx)` fallback whenever
 *   the column it lands on is empty, which it is in those fixtures. It would
 *   stop being rescued the moment that column held an ISO timestamp — exactly
 *   the silent corruption `F4.100` closed. So the invariant is asserted
 *   directly instead, on the returned range.
 * - **A recognised header beyond the window refuses the file, by name.** The
 *   scan is `sheet[addr]` lookups over the header row only, so it is bounded by
 *   the declared width and costs microseconds — nothing is densified to run it.
 *   Without it the file would fail later as `Missing required column 'time'`,
 *   blaming the operator's sheet for a bound this parser imposes. A header that
 *   also appears **inside** the window is not a problem: `indexOf` takes the
 *   first, so the in-window one is the one that would have been read anyway.
 */
export function columnBoundedRange(
  sheet: XLSX.WorkSheet,
  range: XLSX.Range,
): { readonly ok: true; readonly range: XLSX.Range } | { readonly ok: false; readonly reason: string } {
  const lastReadableColumn = range.s.c + MAX_HEADER_COLUMNS - 1;

  const insideWindow = new Set<string>();
  for (let c = range.s.c; c <= Math.min(range.e.c, lastReadableColumn); c += 1) {
    insideWindow.add(headerCellText(sheet, range.s.r, c));
  }

  const scanTo = Math.min(range.e.c, range.s.c + HEADER_SCAN_COLUMN_CEILING - 1);
  for (let c = lastReadableColumn + 1; c <= scanTo; c += 1) {
    const text = headerCellText(sheet, range.s.r, c);
    if (RECOGNISED_HEADERS.has(text) && !insideWindow.has(text)) {
      return {
        ok: false,
        // `text` is NOT echoed sheet text despite reading like it: the branch
        // is reached only when `RECOGNISED_HEADERS.has(text)`, and `Set.has`
        // is SameValueZero, not a property lookup, so `text` is provably one of
        // the six literals in that set. That is why `spreadsheet-guard.ts`'s
        // `quoteCell` is not applied here — the membership test is the stronger
        // bound. Apply `quoteCell` if this message ever interpolates a cell the
        // set does not vouch for.
        reason:
          `Column '${text}' is at ${XLSX.utils.encode_col(c)}, beyond the ${MAX_HEADER_COLUMNS} columns ` +
          `read from the start of the sheet's used range; move the import columns to the left of the sheet`,
      };
    }
  }

  return {
    ok: true,
    range: { s: { r: range.s.r, c: range.s.c }, e: { r: range.e.r, c: Math.min(range.e.c, lastReadableColumn) } },
  };
}

/**
 * Parses an uploaded CSV or XLSX buffer into accepted rows and per-row
 * rejections. Returns a discriminated result instead of throwing: a
 * genuinely unreadable buffer, a missing required column, an empty sheet, or
 * a file over the row cap are all reported the same way, as `ok: false`
 * with a human-readable `reason` — the caller (the controller) turns that
 * into a 400 without a stack trace in the response.
 */
export function parseWorkbook(buffer: Buffer): ParseWorkbookResult {
  // What the zip *declares* it will unpack to, read from its central directory
  // before a byte is inflated. `sheetRows` below bounds row materialisation
  // only; the shared-string table is inflated whole, and the F2.7 security
  // review took the process to 2.5 GB RSS with a 1.3 MB file through this same
  // `XLSX.read` shape (`spreadsheet-guard.ts`).
  //
  // Three guards, and each bounds something the other two do not: this one the
  // declared inflation, `sheetRows` the row count, and `MAX_HEADER_COLUMNS` the
  // column span. A workbook can satisfy the first two and still declare
  // 16,384 columns — that is `F4.101`, and it killed the process from 2,668
  // bytes.
  const inflation = zipInflationProblem(buffer);
  if (inflation !== null) {
    return { ok: false, reason: inflation };
  }

  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(buffer, {
      type: "buffer",
      // Deliberately NOT `cellDates: true`. SheetJS's `Date`-object
      // construction (both for a real XLSX date-serial cell and for a CSV
      // cell whose text merely looks like a date) reinterprets the value
      // using this host's local timezone, silently shifting it by the host's
      // UTC offset. A date-typed cell is read as a raw numeric serial
      // instead and decoded ourselves with `XLSX.SSF.parse_date_code`, which
      // recovers the wall-clock components UTC-safely; a text cell is parsed
      // with `Date.parse`, which honours an explicit `Z`/offset the same way
      // on every host. See the time-cell handling below.
      // Bounds how many rows SheetJS materializes before the row-cap check
      // below ever runs — without this, a small compressed file that
      // inflates to a huge sheet is fully parsed into a JS array first and
      // the cap only rejects it after the fact. `SHEET_ROWS_BOUND` keeps the
      // header, one overflow data row and the start slack; the cap check
      // below refuses a sheet that reached it, because such a sheet may have
      // been cut here rather than being this short.
      sheetRows: SHEET_ROWS_BOUND,
    });
  } catch {
    return { ok: false, reason: "Could not read the uploaded file as CSV or Excel" };
  }

  const sheetName = book.SheetNames[0];
  const sheet = sheetName ? book.Sheets[sheetName] : undefined;
  if (!sheet) {
    return { ok: false, reason: "Workbook has no sheets" };
  }

  // The declared used range, decoded BEFORE anything densifies it. A sheet with
  // no `!ref` produces no rows at all — `sheet_to_json` iterates the range — so
  // it is the empty sheet the next check used to name after the fact.
  const ref = sheet["!ref"];
  if (ref === undefined) {
    return { ok: false, reason: "Sheet is empty" };
  }
  const range = XLSX.utils.decode_range(ref);
  // `F4.101`: bound the column span first. `sheetRows` above bounded rows only,
  // and a declared range costs its full area to densify whether or not a cell
  // is really there.
  const bounded = columnBoundedRange(sheet, range);
  if (!bounded.ok) {
    return { ok: false, reason: bounded.reason };
  }

  const raw = XLSX.utils.sheet_to_json<SheetCell[]>(sheet, { header: 1, defval: "", range: bounded.range });
  if (raw.length === 0 || raw.every(isBlankRow)) {
    return { ok: false, reason: "Sheet is empty" };
  }

  const headerRow = (raw[0] ?? []).map((cell) => String(cell ?? "").trim().toLowerCase());
  for (const required of REQUIRED_HEADERS) {
    if (!headerRow.includes(required)) {
      return { ok: false, reason: `Missing required column '${required}'` };
    }
  }
  const hasAssetCode = headerRow.includes("asset_code");
  const hasAssetId = headerRow.includes("asset_id");
  if (!hasAssetCode && !hasAssetId) {
    return { ok: false, reason: "Missing required column 'asset_code' or 'asset_id'" };
  }

  // Everything after the header, in original sheet order, blanks included —
  // this is what keeps `rowNumber` aligned with the operator's actual Excel
  // row, and what makes the cap below count what the sheet counts.
  const dataRows = raw.slice(1);
  if (dataRows.length === 0 || dataRows.every(isBlankRow)) {
    return { ok: false, reason: "Sheet has a header row but no data rows" };
  }
  // Two ways to be over the cap: more data rows than it allows, or a used range
  // that reached the reading bound — in which case `dataRows` is what survived
  // the cut, not what the file holds, and is not a number to trust.
  // The TRUE declared end row, not the bounded range's — the column bound never
  // moves it, and this check is about what the reading may have cut.
  const cutAtTheReadingBound = range.e.r + 1 >= SHEET_ROWS_BOUND;
  if (cutAtTheReadingBound || dataRows.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      // Which of the two fired decides what can honestly be said. When the
      // sheet was cut, `dataRows.length` is the size of the cut and not the
      // size of the file — quoting it read "File has 19901 data rows, more than
      // the 20000-row limit", which contradicts itself.
      reason: cutAtTheReadingBound
        ? `The sheet was cut at the reading bound of ${SHEET_ROWS_BOUND} rows; the file has more than the ${MAX_IMPORT_ROWS}-row limit`
        : `File has ${dataRows.length} data rows, more than the ${MAX_IMPORT_ROWS}-row limit`,
    };
  }

  const assetCodeIdx = headerRow.indexOf("asset_code");
  const assetIdIdx = headerRow.indexOf("asset_id");
  const pointKeyIdx = headerRow.indexOf("point_key");
  const valueIdx = headerRow.indexOf("value");
  const unitIdx = headerRow.indexOf("unit");
  const timeIdx = headerRow.indexOf("time");

  const rows: ParsedImportRow[] = [];
  const rejected: ImportRowRejection[] = [];
  const seenAt = new Map<string, number>();
  const trustNumericDateSerial = isBinarySpreadsheet(book);

  // `sheet_to_json` indexes BOTH axes from the used range, not from A1 —
  // `raw[0]` is the range's first row and `raw[n][0]` its first column, both
  // measured. Every index derived from `raw` is therefore range-relative,
  // while `sheet[...]` is addressed absolutely, so the two are reconciled here
  // once (`F4.100`; `F2.7`'s sibling parser anchors the same way, as `r + 1`
  // and `range.s.c + c`). `F4.101` hands `sheet_to_json` a column-bounded
  // range, which is why that range keeps `!ref`'s own `s` untouched: `raw` is
  // indexed from whatever range it was given, so these two would silently go
  // wrong if the bound moved the origin.
  const headerSheetRowIndex = range.s.r;
  const firstSheetColIndex = range.s.c;
  // `time` is a required header, so `timeIdx` is never -1 here; the guard keeps
  // `rawCellText`'s own "no such column" contract intact rather than letting the
  // offset turn a -1 into a real, wrong cell.
  const timeSheetColIndex = timeIdx >= 0 ? firstSheetColIndex + timeIdx : -1;

  dataRows.forEach((row, offset) => {
    // 0-based absolute index into `sheet`; the header consumed the range's
    // first row, and `offset` runs over the UNFILTERED rows after it.
    const sheetRowIndex = headerSheetRowIndex + offset + 1;
    // Excel numbers its rows from 1, so the operator's row is the absolute
    // index plus one — never the offset within the used range.
    const rowNumber = sheetRowIndex + 1;

    if (isBlankRow(row)) {
      // Silently ignored — spacer rows are common in hand-edited sheets. Since
      // `F4.101` `row` is the row within the read window, so a row whose only
      // content sits beyond `MAX_HEADER_COLUMNS` is blank here too. It was
      // previously rejected as "Row must include asset_code or asset_id"; it
      // never held data this importer reads, under a column it never read.
      return;
    }

    const assetCode = hasAssetCode ? cellText(row, assetCodeIdx) : "";
    const assetId = hasAssetId ? cellText(row, assetIdIdx) : "";
    if (!assetCode && !assetId) {
      rejected.push({ rowNumber, field: "assetCode", reason: "Row must include asset_code or asset_id" });
      return;
    }

    const pointKey = cellText(row, pointKeyIdx);
    if (!pointKey) {
      rejected.push({ rowNumber, field: "pointKey", reason: "point_key is required" });
      return;
    }

    const valueRaw = cellText(row, valueIdx);
    const value = Number(valueRaw);
    if (valueRaw === "" || !Number.isFinite(value)) {
      rejected.push({ rowNumber, field: "value", reason: "value must be a finite number" });
      return;
    }

    const timeCell = timeIdx >= 0 ? row[timeIdx] : undefined;
    let parsedTime: number;
    if (trustNumericDateSerial && typeof timeCell === "number") {
      // A real Excel date/time cell: a day-count serial, timezone-agnostic
      // by construction. Decode its y/m/d/H/M/S components and re-assert
      // them as UTC — the wall-clock value in the cell IS the UTC instant.
      // Only trusted for a genuine binary spreadsheet — a CSV cell can be
      // type-guessed into an identical-looking number by SheetJS's own
      // locale-ambiguous date detection (see `isBinarySpreadsheet`).
      const decoded = XLSX.SSF.parse_date_code(timeCell);
      parsedTime = decoded
        ? Date.UTC(decoded.y, decoded.m - 1, decoded.d, decoded.H, decoded.M, decoded.S, Math.round((decoded.u ?? 0) * 1000))
        : Number.NaN;
    } else {
      // The cell's original text, not `cellText(row, timeIdx)` — for a CSV
      // cell SheetJS type-guessed into a number, `row[timeIdx]` is already
      // that number, and stringifying it would parse the wrong value.
      // `timeIdx` came from `raw`, so it counts columns from the range's first
      // one; the address is absolute, which is what `timeSheetColIndex` adds.
      const timeRaw = rawCellText(sheet, sheetRowIndex, timeSheetColIndex) ?? cellText(row, timeIdx);
      parsedTime = timeRaw ? parseStrictIsoUtc(timeRaw) : Number.NaN;
    }
    if (Number.isNaN(parsedTime)) {
      rejected.push({
        rowNumber,
        field: "time",
        reason: "time must be an ISO-8601 timestamp (e.g. 2026-08-19T10:00:00Z)",
      });
      return;
    }
    const time = new Date(parsedTime).toISOString();

    const unit = unitIdx >= 0 ? cellText(row, unitIdx) : "";

    const dupKey = `${assetId || assetCode}|${pointKey}|${parsedTime}`;
    const firstSeenAt = seenAt.get(dupKey);
    if (firstSeenAt !== undefined) {
      rejected.push({
        rowNumber,
        field: null,
        reason: `Duplicate of row ${firstSeenAt} — same asset, point key and time within this file`,
      });
      return;
    }
    seenAt.set(dupKey, rowNumber);

    rows.push({
      rowNumber,
      ...(assetId ? { assetId } : {}),
      ...(assetCode ? { assetCode } : {}),
      pointKey,
      value,
      ...(unit ? { unit } : {}),
      time,
    });
  });

  return { ok: true, rows, rejected };
}
