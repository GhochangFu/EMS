import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Content, ContentTable, ContentText } from "pdfmake/interfaces";

import { repoRoot } from "../testing/repo-root";
import {
  TREND_POINTS_SHEET_HEADER,
  TREND_POINTS_TABLE_HEADER,
  trendPointsPdfDefinition,
  trendPointsReportRows,
  type TrendPointsReportInput,
  type TrendPointsReportPoint,
} from "./trend-points-pdf";

/**
 * `F4.303` U13 (ADR 0108 Amendment 6 item 8, "Layout", "Dropped points are named") — the pure
 * half of the `trend_points` report: `trendPointsReportRows`, the one row builder, and the PDF
 * definition over its result. Assertions live here; `trend-points-pdf.test.ts` is the Vitest entry
 * point (§4.6). One claim per exported function.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ZONE = "Asia/Kolkata";

const STATS = { sum: 30, average: 10, min: 5, max: 15, peakAt: "2026-11-01T00:00:00.000Z", sampleCount: 3 };
const PREVIOUS_STATS = { sum: 16, average: 8, min: 4, max: 12, peakAt: "2026-10-31T00:00:00.000Z", sampleCount: 2 };

/** Two current buckets — the second a filled gap (`null` statistics, zero samples) — and one previous bucket. */
function point(overrides: Partial<TrendPointsReportPoint> = {}): TrendPointsReportPoint {
  return {
    assetCode: "A1",
    assetRtuName: "RTU 1",
    assetLocationName: "Plant",
    pointKey: "kw",
    unit: "kW",
    current: {
      stats: STATS,
      buckets: [
        { t: "2026-10-31T18:30:00.000Z", v: 10, min: 5, average: 10, max: 15, sampleCount: 3 },
        { t: "2026-10-31T18:31:00.000Z", v: null, min: null, average: null, max: null, sampleCount: 0 },
      ],
    },
    previous: null,
    ...overrides,
  };
}

function input(overrides: Partial<TrendPointsReportInput> = {}): TrendPointsReportInput {
  return {
    title: "Daily kW",
    periodStart: "2026-11-01",
    periodEnd: "2026-11-01",
    timeZone: ZONE,
    level: "1m",
    total: 1,
    dropped: [],
    points: [point()],
    ...overrides,
  };
}

const WITH_COMPARE = point({
  previous: {
    stats: PREVIOUS_STATS,
    buckets: [{ t: "2026-10-30T18:30:00.000Z", v: 8, min: 4, average: 8, max: 12, sampleCount: 2 }],
  },
});

/** Every `text` string in a pdfmake content tree, depth first. */
function texts(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(texts);
  if (typeof node === "object" && node !== null) {
    const record = node as Record<string, unknown>;
    return [
      ...(typeof record.text === "string" ? [record.text] : texts(record.text ?? [])),
      ...texts(record.table ? (record.table as { body: unknown }).body : []),
      ...texts(record.stack ?? []),
    ];
  }
  return [];
}

function tables(content: Content[]): ContentTable[] {
  return content.filter((node): node is ContentTable => typeof node === "object" && node !== null && "table" in node);
}

/**
 * P1 — one table per point, headed `<asset label> · <point name> (<unit>)` (`F4.316` PR 6, ADR 0111):
 * the label is `<code> · <RTU>`, else `<code> · <location>` — B2 has no RTU, the RTU-less twin.
 */
export function assertOneTablePerPointWithItsHeading(): void {
  const rows = trendPointsReportRows(
    input({ total: 2, points: [point(), point({ assetCode: "B2", assetRtuName: null, pointKey: "pf", unit: null })] }),
  );
  const headings = rows.tables.map((table) => table.heading);
  assert(
    JSON.stringify(headings) === JSON.stringify(["A1 · RTU 1 · kw (kW)", "B2 · Plant · pf"]),
    `expected the two headings, got ${JSON.stringify(headings)}`,
  );
}

/** P1 — a table opens with the period's summary row (min, average, max, samples), then its bucket rows. */
export function assertSummaryRowThenBucketRows(): void {
  const [table] = trendPointsReportRows(input()).tables;
  const expected = [
    ["current", "summary", 5, 10, 15, 3],
    ["current", "2026-11-01T00:00:00+05:30", 5, 10, 15, 3],
    ["current", "2026-11-01T00:01:00+05:30", null, null, null, 0],
  ];
  assert(JSON.stringify(table?.rows) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(table?.rows)}`);
}

/** P1 — with compare the previous period's summary row and buckets follow the current ones. */
export function assertComparePutsThePreviousPeriodAfter(): void {
  const [table] = trendPointsReportRows(input({ points: [WITH_COMPARE] })).tables;
  const periods = (table?.rows ?? []).map((row) => `${row[0]}:${row[1] === "summary" ? "summary" : "bucket"}`);
  const expected = ["current:summary", "current:bucket", "current:bucket", "previous:summary", "previous:bucket"];
  assert(JSON.stringify(periods) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(periods)}`);
}

/** P2 — a gap is `—` in the PDF cell (a `5m` read, which the PDF does not fold). */
export function assertAGapIsADashInThePdf(): void {
  const definition = trendPointsPdfDefinition(trendPointsReportRows(input({ level: "5m" })));
  const [table] = tables(definition.content as Content[]);
  const gapRow = (table?.table.body ?? [])[3] as { text: string }[] | undefined;
  const cells = (gapRow ?? []).map((cell) => cell.text);
  assert(
    JSON.stringify(cells) === JSON.stringify(["current", "2026-11-01T00:01:00+05:30", "—", "—", "—", "0"]),
    `expected the gap row with dashes, got ${JSON.stringify(cells)}`,
  );
}

/** P2 — the same gap is `null` in the long (XLSX) row. */
export function assertAGapIsNullInTheLongRow(): void {
  const rows = trendPointsReportRows(input());
  const gap = rows.sheet.find((row) => row[6] === "2026-11-01T00:01:00+05:30");
  assert(
    JSON.stringify(gap) === JSON.stringify(["A1", "A1 · RTU 1", "kw", "kW", "current", "bucket", "2026-11-01T00:01:00+05:30", null, null, null, 0]),
    `expected the gap's long row with nulls, got ${JSON.stringify(gap)}`,
  );
}

/** P3 — the dropped sentence names each left-out pair by asset code and point code, a vanished asset as "a deleted asset". */
export function assertTheDroppedSentenceNamesThePairs(): void {
  const rows = trendPointsReportRows(input({ total: 4, dropped: ["A1 · kw", "a deleted asset · pf"] }));
  assert(
    rows.dropped === "2 of 4 points were left out: A1 · kw, a deleted asset · pf",
    `expected the dropped sentence, got ${JSON.stringify(rows.dropped)}`,
  );
}

/** P3 — positive control: with nothing left out there is no sentence. */
export function assertNoSentenceWhenNothingIsLeftOut(): void {
  const rows = trendPointsReportRows(input());
  assert(rows.dropped === null, `expected no sentence, got ${JSON.stringify(rows.dropped)}`);
}

/** P4 — every point dropped: the PDF holds the title, the period, the level and the sentence, and no table. */
export function assertEveryPointDroppedLeavesNoTable(): void {
  const definition = trendPointsPdfDefinition(
    trendPointsReportRows(input({ total: 1, dropped: ["a deleted asset · kw"], points: [] })),
  );
  const content = definition.content as Content[];
  const all = texts(content);
  const wanted = ["Daily kW", "Period: 2026-11-01 to 2026-11-01 (Asia/Kolkata)", FOLDED_LEVEL, "1 of 1 points were left out: a deleted asset · kw"];
  const missing = wanted.filter((text) => !all.includes(text));
  assert(missing.length === 0 && tables(content).length === 0, `expected ${JSON.stringify(wanted)} and no table, got ${JSON.stringify(all)}`);
}

/** P4 — positive control: with one kept point the definition holds one table whose header is the column names. */
export function assertAKeptPointDrawsOneTable(): void {
  const content = trendPointsPdfDefinition(trendPointsReportRows(input())).content as Content[];
  const found = tables(content);
  const header = ((found[0]?.table.body ?? [])[0] as ContentText[] | undefined)?.map((cell) => cell.text);
  assert(
    found.length === 1 && JSON.stringify(header) === JSON.stringify(TREND_POINTS_TABLE_HEADER),
    `expected one table with the header row, got ${found.length} and ${JSON.stringify(header)}`,
  );
}

/** The XLSX sheet holds the same data rows as the PDF tables, in order, with the pair in front. */
export function assertTheSheetReadsTheTablesRows(): void {
  const rows = trendPointsReportRows(input({ points: [WITH_COMPARE] }));
  const fromTables = rows.tables.flatMap((table) =>
    table.rows.map((row) => [table.assetCode, table.assetLabel, table.pointKey, table.unit, row[0], row[1] === "summary" ? "summary" : "bucket", row[1] === "summary" ? null : row[1], ...row.slice(2)]),
  );
  const headerAt = rows.sheet.findIndex((row) => row[0] === "asset");
  const data = rows.sheet.slice(headerAt + 1);
  assert(headerAt > 0 && JSON.stringify(data) === JSON.stringify(fromTables), `the sheet's rows differ from the tables': ${JSON.stringify(data)}`);
}

/** `F4.316` PR 6 (ADR 0111 decision 4) — the sheet keeps the code column `asset` and adds `asset_label` right after it. */
export function assertTheSheetHeaderAddsTheLabelAfterTheCode(): void {
  const header = trendPointsReportRows(input()).sheet.find((row) => row[0] === "asset");
  assert(
    JSON.stringify(header?.slice(0, 3)) === JSON.stringify(["asset", "asset_label", "point"]) &&
      JSON.stringify(header) === JSON.stringify(TREND_POINTS_SHEET_HEADER),
    `the sheet header must be asset, asset_label, point, …, got ${JSON.stringify(header)}`,
  );
}

/** U17 (plan C25, owner Q-D): the sentence a folded PDF prints for its level. */
const FOLDED_LEVEL = "Level: 1m, folded to 1h in this PDF (the XLSX keeps every 1m bucket)";

/**
 * Two hours of minute buckets from the period's start (00:00 in the zone): minute 0 holds 3 samples
 * (5, 10, 15), minute 1 one sample (2, 20, 30), every other minute is a gap.
 */
function twoHoursOfMinutes(): TrendPointsReportPoint {
  const start = Date.parse("2026-10-31T18:30:00.000Z");
  const buckets = Array.from({ length: 120 }, (_, i) => {
    const t = new Date(start + i * 60_000).toISOString();
    if (i === 0) return { t, v: 10, min: 5, average: 10, max: 15, sampleCount: 3 };
    if (i === 1) return { t, v: 20, min: 2, average: 20, max: 30, sampleCount: 1 };
    return { t, v: null, min: null, average: null, max: null, sampleCount: 0 };
  });
  return point({ current: { stats: STATS, buckets } });
}

/** U17 F1 — a `1m` read's PDF rows are one per hour: min of mins, sample-weighted average, max of maxes, summed samples; an hour of gaps is a gap. */
export function assertA1mReadFoldsToHoursInThePdf(): void {
  const [table] = trendPointsReportRows(input({ points: [twoHoursOfMinutes()] })).tables;
  const expected = [
    ["current", "summary", 5, 10, 15, 3],
    ["current", "2026-11-01T00:00:00+05:30", 2, 12.5, 30, 4],
    ["current", "2026-11-01T01:00:00+05:30", null, null, null, 0],
  ];
  assert(JSON.stringify(table?.pdfRows) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(table?.pdfRows)}`);
}

/** U17 F2 — the table rows and the XLSX sheet keep every minute bucket (Q-D: the XLSX keeps every bucket). */
export function assertTheSheetKeepsEveryMinuteBucket(): void {
  const rows = trendPointsReportRows(input({ points: [twoHoursOfMinutes()] }));
  const bucketRows = rows.sheet.filter((row) => row[5] === "bucket").length;
  assert(rows.tables[0]?.rows.length === 121 && bucketRows === 120, `expected 121 table rows and 120 bucket rows, got ${rows.tables[0]?.rows.length} and ${bucketRows}`);
}

/** U17 F3 — positive control: a `5m` read is not folded; the PDF rows are the table rows. */
export function assertA5mReadIsNotFolded(): void {
  const [table] = trendPointsReportRows(input({ level: "5m", points: [twoHoursOfMinutes()] })).tables;
  assert(JSON.stringify(table?.pdfRows) === JSON.stringify(table?.rows), `expected the PDF rows to be the table rows, got ${table?.pdfRows.length} of ${table?.rows.length}`);
}

/** U17 F4 — the folded PDF draws the hour rows and says so on its level line. */
export function assertTheFoldedPdfSaysSo(): void {
  const content = trendPointsPdfDefinition(trendPointsReportRows(input({ points: [twoHoursOfMinutes()] }))).content as Content[];
  const body = tables(content)[0]?.table.body ?? [];
  assert(texts(content).includes(FOLDED_LEVEL) && body.length === 4, `expected the folded level line and 1 + 3 rows, got ${body.length} rows`);
}

const PDF_SOURCE = join(repoRoot(), "apps/api/src/reports/trend-points-pdf.ts");
const SERVICE_SOURCE = join(repoRoot(), "apps/api/src/reports/trend-points-report.service.ts");

/** Strips `//` line and block comments, so prose naming a function cannot satisfy a scan. */
function code(path: string): string {
  return readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** P5 — `trend-points-pdf.ts` exports exactly one row builder (the `energyTable` rule). */
export function assertExactlyOneRowBuilderIsExported(): void {
  const builders = [...code(PDF_SOURCE).matchAll(/export function (\w*Rows)\b/g)].map((m) => m[1]);
  assert(JSON.stringify(builders) === JSON.stringify(["trendPointsReportRows"]), `expected one exported row builder, got ${JSON.stringify(builders)}`);
}

/** P5 — the service calls the row builder once, and the PDF definition takes its result, not the reads. */
export function assertTheServiceCallsTheBuilderOnce(): void {
  const calls = [...code(SERVICE_SOURCE).matchAll(/\btrendPointsReportRows\(/g)].length;
  const pdfTakesRows = /export function trendPointsPdfDefinition\(\s*rows:\s*TrendPointsReportRows\s*\)/.test(code(PDF_SOURCE));
  assert(calls === 1 && pdfTakesRows, `expected one call in the service (got ${calls}) and a definition over the rows (got ${pdfTakesRows})`);
}
