import * as XLSX from "xlsx";

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

const REQUIRED_HEADERS = ["point_key", "value", "time"] as const;

export type ParsedImportRow = {
  /** 1-based, matching what the operator sees in Excel — header is row 1. */
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
 * Parses an uploaded CSV or XLSX buffer into accepted rows and per-row
 * rejections. Returns a discriminated result instead of throwing: a
 * genuinely unreadable buffer, a missing required column, an empty sheet, or
 * a file over the row cap are all reported the same way, as `ok: false`
 * with a human-readable `reason` — the caller (the controller) turns that
 * into a 400 without a stack trace in the response.
 */
export function parseWorkbook(buffer: Buffer): ParseWorkbookResult {
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
      // the cap only rejects it after the fact. +2 keeps the header plus one
      // overflow data row, so a file exactly one row over the cap is still
      // correctly detected as over it.
      sheetRows: MAX_IMPORT_ROWS + 2,
    });
  } catch {
    return { ok: false, reason: "Could not read the uploaded file as CSV or Excel" };
  }

  const sheetName = book.SheetNames[0];
  const sheet = sheetName ? book.Sheets[sheetName] : undefined;
  if (!sheet) {
    return { ok: false, reason: "Workbook has no sheets" };
  }

  const raw = XLSX.utils.sheet_to_json<SheetCell[]>(sheet, { header: 1, defval: "" });
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
  // this is what makes `rowNumber` (offset + 2) match the operator's actual
  // Excel row, and what makes the cap below count what the sheet counts.
  const dataRows = raw.slice(1);
  if (dataRows.length === 0 || dataRows.every(isBlankRow)) {
    return { ok: false, reason: "Sheet has a header row but no data rows" };
  }
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      reason: `File has ${dataRows.length} data rows, more than the ${MAX_IMPORT_ROWS}-row limit`,
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

  dataRows.forEach((row, offset) => {
    const rowNumber = offset + 2; // header occupies row 1; offset runs over the UNFILTERED rows
    const sheetRowIndex = offset + 1; // 0-based index into `sheet`; header consumed row index 0

    if (isBlankRow(row)) {
      return; // silently ignored — spacer rows are common in hand-edited sheets
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
      const timeRaw = rawCellText(sheet, sheetRowIndex, timeIdx) ?? cellText(row, timeIdx);
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
