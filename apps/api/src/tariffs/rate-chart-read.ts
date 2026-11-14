import * as XLSX from "xlsx";

import { RATE_CHART_HEADER, RATE_CHART_MAX_ROWS, RATE_CHART_SHEET } from "./rate-chart";

/**
 * `F4.365` (security review L1, L2) — the Rate Chart's cells, read with both of
 * the bounds a spreadsheet needs (AGENTS.md §4.3: a size cap on the file is not
 * a bound on the work):
 *
 * - **rows**: `sheetRows` is one row past the header plus the limit, so a sheet
 *   that holds more than `RATE_CHART_MAX_ROWS` data rows reaches the bound and
 *   `parseRateChart` refuses it — a sheet cut at the bound is never imported
 *   as if whole (the `F2.7` `SHEET_ROWS_BOUND` rule);
 * - **columns**: the read range is pinned to the 22 Rate Chart columns, so a
 *   declared `A1:XFD…` dimension is never densified (the `F4.101` problem).
 *
 * Formulas are not evaluated and only the one sheet is parsed.
 */
export const RATE_CHART_SHEET_ROWS = RATE_CHART_MAX_ROWS + 2;

export function readRateChartRows(buffer: Buffer): { ok: true; rows: unknown[][] } | { ok: false; problem: string } {
  const book = XLSX.read(buffer, { type: "buffer", cellFormula: false, sheetRows: RATE_CHART_SHEET_ROWS, sheets: [RATE_CHART_SHEET] });
  const sheet = book.Sheets[RATE_CHART_SHEET];
  if (!sheet) return { ok: false, problem: `no sheet named "${RATE_CHART_SHEET}"` };
  const range = { s: { r: 0, c: 0 }, e: { r: RATE_CHART_SHEET_ROWS - 1, c: RATE_CHART_HEADER.length - 1 } };
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: false, range });
  return { ok: true, rows };
}
