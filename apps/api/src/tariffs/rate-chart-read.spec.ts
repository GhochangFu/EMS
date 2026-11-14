import * as XLSX from "xlsx";

import { RATE_CHART_HEADER, RATE_CHART_MAX_ROWS, RATE_CHART_SHEET, parseRateChart } from "./rate-chart";
import { readRateChartRows } from "./rate-chart-read";

/** `F4.365` (security review L1, L2) — the real read path's row and column bounds. */

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const SOURCE = { workbook: "fixture.xlsx", sha256: "b".repeat(64) };

function dataRow(i: number): unknown[] {
  const base: Record<string, unknown> = {
    "Category Key": `K${i}`, "Area ID": "MH", "State / UT": "Maharashtra", "Discom(s)": "MSEDCL",
    Ownership: "Government", "Category Code": "C", Category: "Cat", Segment: "Domestic", Supply: "LT",
    "Slab No": 1, "Slab From (units)": 0, "Slab To (units)": null, "Energy Charge (Rs/unit)": 4,
    "Energy Unit": "kWh", "Fixed/Demand Charge (Rs)": 0, "Fixed Charge Basis": null,
    "Wheeling / Reg. Surcharge (Rs/unit)": 0, Notes: null, "Data Status": "Official tariff schedule/order",
    "Tariff Order": "order", "Effective From": "01-04-2026", Source: "https://example.org/o.pdf",
  };
  return RATE_CHART_HEADER.map((t) => base[t]);
}

function workbook(rows: unknown[][], ref?: string): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  if (ref) sheet["!ref"] = ref;
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, RATE_CHART_SHEET);
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function assertASheetAtTheLimitParses(): void {
  const rows = [[...RATE_CHART_HEADER], ...Array.from({ length: RATE_CHART_MAX_ROWS }, (_, i) => dataRow(i))];
  const read = readRateChartRows(workbook(rows));
  assert(read.ok, "read");
  if (!read.ok) return;
  const parsed = parseRateChart(read.rows, SOURCE);
  assert(parsed.ok && parsed.snapshot.categories.length === RATE_CHART_MAX_ROWS, `at the limit: ${parsed.ok ? "" : parsed.problems[0]}`);
}

/** L1: one row over the limit is refused, never imported cut. */
export function assertASheetOverTheLimitIsRefused(): void {
  const rows = [[...RATE_CHART_HEADER], ...Array.from({ length: RATE_CHART_MAX_ROWS + 1 }, (_, i) => dataRow(i))];
  const read = readRateChartRows(workbook(rows));
  assert(read.ok, "read");
  if (!read.ok) return;
  const parsed = parseRateChart(read.rows, SOURCE);
  assert(!parsed.ok && parsed.problems[0].includes(`more than ${RATE_CHART_MAX_ROWS}`), "over the limit must be refused");
}

/**
 * L2: a declared dimension wider than the Rate Chart is read only across its 22
 * columns. `defval: null` would fill every declared column, so an unbounded read
 * returns 52-wide rows here — and on a declared `A1:XFD…`, tens of millions of
 * cells. (A real `XFD` fixture is not built: writing one takes ~50 s.)
 */
export function assertAWideDeclaredRangeIsNotDensified(): void {
  const read = readRateChartRows(workbook([[...RATE_CHART_HEADER], dataRow(1)], "A1:AZ3"));
  assert(read.ok && read.rows.length === 2, "two rows");
  assert(read.ok && read.rows.every((r) => r.length === RATE_CHART_HEADER.length), "rows are 22 wide, not 52");
}

export function assertAMissingSheetIsNamed(): void {
  const sheet = XLSX.utils.aoa_to_sheet([["x"]]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Other");
  const read = readRateChartRows(XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer);
  assert(!read.ok && read.problem.includes(RATE_CHART_SHEET), "missing sheet");
}
