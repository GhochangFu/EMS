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

  dataRows.forEach((row, offset) => {
    const rowNumber = offset + 2; // header occupies row 1; offset runs over the UNFILTERED rows

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
    if (typeof timeCell === "number") {
      // A real Excel date/time cell: a day-count serial, timezone-agnostic
      // by construction. Decode its y/m/d/H/M/S components and re-assert
      // them as UTC — the wall-clock value in the cell IS the UTC instant.
      const decoded = XLSX.SSF.parse_date_code(timeCell);
      parsedTime = decoded
        ? Date.UTC(decoded.y, decoded.m - 1, decoded.d, decoded.H, decoded.M, decoded.S, Math.round((decoded.u ?? 0) * 1000))
        : Number.NaN;
    } else {
      const timeRaw = cellText(row, timeIdx);
      parsedTime = timeRaw ? Date.parse(timeRaw) : Number.NaN;
    }
    if (Number.isNaN(parsedTime)) {
      rejected.push({ rowNumber, field: "time", reason: "time must be a parsable timestamp" });
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
