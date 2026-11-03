import type { AggregateLevel, PointAggregateBucket, PointAggregateStats } from "@bms/shared";
import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";

import { isoInZone } from "./view-export.serialise";

/**
 * `F4.303` U13 (ADR 0108 Amendment 6 item 8, `trend_points`: "Dropped points are named",
 * "Layout"; plan C19) — the pure half of the `trend_points` report.
 *
 * **One row builder.** `trendPointsReportRows` turns the reads into the report's rows once; the
 * PDF definition (`trendPointsPdfDefinition`) and the XLSX sheet (`rows.sheet`, written by
 * `TrendPointsReportService.xlsx`) both read that one result, so the two files never disagree —
 * the `energyTable` rule (ADR 0071). `trend-points-pdf.spec.ts` pins that this file exports one
 * row builder and that the service calls it once.
 *
 * **Layout.** A title (the schedule name), the period and the schedule's zone, the level read,
 * the dropped-points sentence when a pair was left out, then one table per kept point headed
 * `<asset code> · <point code> (<unit>)` — there is no point-name column on `bms.asset_points`, so
 * the code is the point's name — with a summary row (min, average, max, samples over the period)
 * and the bucket rows; with compare the previous period's summary row and buckets follow. A
 * bucket start is printed in the schedule's zone (`isoInZone`). A gap (a bucket with no samples)
 * is `null` in the rows and the sheet, and `—` in a PDF cell — never `0`, which would read as a
 * measured zero. Every point dropped: the title, the period, the level and the sentence, and no
 * table — never a silent empty file.
 *
 * No id reaches the rows: a dropped pair is named by its asset code, or "a deleted asset" when the
 * asset row is gone or invisible to the render's tenant transaction.
 */

/** One period's read of one point: the scalar statistics and the gap-filled buckets with their statistics. */
export interface TrendPointsReportPeriodRead {
  readonly stats: PointAggregateStats;
  readonly buckets: readonly PointAggregateBucket[];
}

/** One kept point, read. */
export interface TrendPointsReportPoint {
  readonly assetCode: string;
  readonly pointKey: string;
  readonly unit: string | null;
  readonly current: TrendPointsReportPeriodRead;
  readonly previous: TrendPointsReportPeriodRead | null;
}

/** What the service hands the row builder. `total` counts every stored pair, kept or dropped. */
export interface TrendPointsReportInput {
  readonly title: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly timeZone: string;
  readonly level: AggregateLevel;
  readonly total: number;
  /** Each dropped pair as `<asset code> · <point code>`, in stored order. */
  readonly dropped: readonly string[];
  readonly points: readonly TrendPointsReportPoint[];
}

/** One cell; `null` is a gap. */
export type TrendPointsCell = string | number | null;

/** One point's table: `[period, "summary" | bucket start, min, average, max, samples]` rows. */
export interface TrendPointsTable {
  readonly heading: string;
  readonly assetCode: string;
  readonly pointKey: string;
  readonly unit: string | null;
  readonly rows: TrendPointsCell[][];
  /** The rows the PDF draws: `rows`, with a `1m` read's buckets folded to one row per hour (U17, plan C25). */
  readonly pdfRows: TrendPointsCell[][];
}

/** The report, once: what both the PDF and the XLSX read. */
export interface TrendPointsReportRows {
  readonly title: string;
  /** `Period: <start> to <end> (<zone>)`. */
  readonly period: string;
  readonly level: AggregateLevel;
  /** The dropped-points sentence, or `null` when nothing was left out. */
  readonly dropped: string | null;
  readonly tables: TrendPointsTable[];
  /** The XLSX sheet `Points`: a head block, a blank row, the column header, then one long row per table row. */
  readonly sheet: TrendPointsCell[][];
}

/** The PDF table's column header. */
export const TREND_POINTS_TABLE_HEADER = ["Period", "Bucket start", "Min", "Average", "Max", "Samples"] as const;

/** The XLSX sheet's column header: the pair, then the table row. */
export const TREND_POINTS_SHEET_HEADER = [
  "asset",
  "point",
  "unit",
  "period",
  "row",
  "bucket_start",
  "min",
  "average",
  "max",
  "samples",
] as const;

const SUMMARY = "summary";
const GAP = "—";

function heading(point: TrendPointsReportPoint): string {
  const pair = `${point.assetCode} · ${point.pointKey}`;
  return point.unit === null ? pair : `${pair} (${point.unit})`;
}

/**
 * U17 (plan C25, owner Q-D): the measured daily 8-point compare render took over 10 s, so a `1m`
 * read's PDF folds its buckets to one per hour from the period's start — min of the mins, the
 * sample-weighted average, max of the maxes, the summed samples; an hour with no samples is a gap.
 * The summary rows and the XLSX keep every bucket.
 */
const FOLD_LEVEL: AggregateLevel = "1m";
const HOUR_MS = 3_600_000;

function foldToHours(buckets: readonly PointAggregateBucket[]): PointAggregateBucket[] {
  const first = buckets[0];
  if (first === undefined) return [];
  const start = Date.parse(first.t);
  const hours = new Map<number, PointAggregateBucket[]>();
  for (const bucket of buckets) {
    const hour = Math.floor((Date.parse(bucket.t) - start) / HOUR_MS);
    const group = hours.get(hour);
    if (group === undefined) hours.set(hour, [bucket]);
    else group.push(bucket);
  }
  return [...hours.values()].map((group): PointAggregateBucket => {
    const measured = group.filter((bucket) => (bucket.sampleCount ?? 0) > 0);
    const samples = measured.reduce((total, bucket) => total + (bucket.sampleCount ?? 0), 0);
    const t = group[0]?.t ?? first.t;
    if (samples === 0) return { t, v: null, min: null, average: null, max: null, sampleCount: 0 };
    const weighted = measured.reduce((total, bucket) => total + (bucket.average ?? 0) * (bucket.sampleCount ?? 0), 0);
    const average = weighted / samples;
    return {
      t,
      v: average,
      min: Math.min(...measured.map((bucket) => bucket.min ?? Infinity)),
      average,
      max: Math.max(...measured.map((bucket) => bucket.max ?? -Infinity)),
      sampleCount: samples,
    };
  });
}

function periodRows(
  period: "current" | "previous",
  read: TrendPointsReportPeriodRead,
  zone: string,
  fold = false,
): TrendPointsCell[][] {
  const { stats } = read;
  const buckets = fold ? foldToHours(read.buckets) : read.buckets;
  return [
    [period, SUMMARY, stats.min, stats.average, stats.max, stats.sampleCount],
    ...buckets.map((bucket): TrendPointsCell[] => [
      period,
      isoInZone(bucket.t, zone),
      bucket.min ?? null,
      bucket.average ?? null,
      bucket.max ?? null,
      bucket.sampleCount ?? null,
    ]),
  ];
}

/** The one row builder: the head facts, one table per kept point, and the long sheet over the same rows. */
export function trendPointsReportRows(input: TrendPointsReportInput): TrendPointsReportRows {
  const dropped =
    input.dropped.length === 0
      ? null
      : `${input.dropped.length} of ${input.total} points were left out: ${input.dropped.join(", ")}`;
  const period = `Period: ${input.periodStart} to ${input.periodEnd} (${input.timeZone})`;
  const fold = input.level === FOLD_LEVEL;
  const tableRows = (point: TrendPointsReportPoint, folded: boolean): TrendPointsCell[][] => [
    ...periodRows("current", point.current, input.timeZone, folded),
    ...(point.previous === null ? [] : periodRows("previous", point.previous, input.timeZone, folded)),
  ];
  const tables = input.points.map((point): TrendPointsTable => {
    const rows = tableRows(point, false);
    return {
      heading: heading(point),
      assetCode: point.assetCode,
      pointKey: point.pointKey,
      unit: point.unit,
      rows,
      pdfRows: fold ? tableRows(point, true) : rows,
    };
  });
  const sheet: TrendPointsCell[][] = [
    ["Report", input.title],
    ["Period", `${input.periodStart} to ${input.periodEnd}`],
    ["Zone", input.timeZone],
    ["Level", input.level],
    ...(dropped === null ? [] : [["Left out", dropped]]),
    [],
    [...TREND_POINTS_SHEET_HEADER],
    ...tables.flatMap((table) =>
      table.rows.map((row): TrendPointsCell[] => {
        const isSummary = row[1] === SUMMARY;
        return [
          table.assetCode,
          table.pointKey,
          table.unit,
          row[0] ?? null,
          isSummary ? SUMMARY : "bucket",
          isSummary ? null : (row[1] ?? null),
          ...row.slice(2),
        ];
      }),
    ),
  ];
  return { title: input.title, period, level: input.level, dropped, tables, sheet };
}

const numberFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

function pdfCell(cell: TrendPointsCell): TableCell {
  if (cell === null) {
    return { text: GAP, alignment: "right" };
  }
  if (typeof cell === "number") {
    return { text: numberFormat.format(cell), alignment: "right" };
  }
  return { text: cell };
}

function pdfTable(table: TrendPointsTable): Content[] {
  return [
    { text: table.heading, bold: true, margin: [0, 6, 0, 4] },
    {
      table: {
        headerRows: 1,
        widths: ["auto", "*", "auto", "auto", "auto", "auto"],
        body: [TREND_POINTS_TABLE_HEADER.map((text): TableCell => ({ text, bold: true })), ...table.pdfRows.map((row) => row.map(pdfCell))],
      },
      margin: [0, 0, 0, 10],
    },
  ];
}

function levelLine(level: AggregateLevel): string {
  return level === FOLD_LEVEL ? `Level: ${level}, folded to 1h in this PDF (the XLSX keeps every ${level} bucket)` : `Level: ${level}`;
}

/** Pure — the PDF definition over the one row builder's result (Standard-14 Helvetica, rendered by `renderPdf`). */
export function trendPointsPdfDefinition(rows: TrendPointsReportRows): TDocumentDefinitions {
  const content: Content[] = [
    { text: rows.title, fontSize: 16, bold: true, margin: [0, 0, 0, 2] },
    { text: rows.period, fontSize: 9, margin: [0, 0, 0, 2] },
    { text: levelLine(rows.level), fontSize: 9, margin: [0, 0, 0, rows.dropped === null ? 10 : 2] },
    ...(rows.dropped === null ? [] : [{ text: rows.dropped, fontSize: 9, margin: [0, 0, 0, 10] } as Content]),
    ...rows.tables.flatMap(pdfTable),
  ];
  return {
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: 40,
    defaultStyle: { font: "Helvetica", fontSize: 8 },
    content,
    footer: (currentPage: number, pageCount: number) => ({
      text: `${currentPage} / ${pageCount}`,
      alignment: "center",
      fontSize: 8,
    }),
  };
}
