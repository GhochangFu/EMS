import { BadRequestException } from "@nestjs/common";
import * as XLSX from "xlsx";

import type {
  AggregateLevel,
  EnergySiteTrend,
  EnergyView,
  EnergyViewPeriod,
  SiteSegmentViewsDto,
  SiteTrendStripDto,
} from "@bms/shared";

import { MAX_EXPORT_ROWS } from "../admin/audit/audit.limits";
import { csvDocument, csvNumberCell, csvTextCell } from "../serialise/csv";
import type { CsvField } from "../serialise/csv";

import { assertFiniteCells } from "./reports.serialise";

/**
 * `F4.303` U2 (ADR 0108 Amendment 6 item 3) — the pure half of the four view
 * exports: row shaping, the two writers and the row-count cap. No Nest service
 * and no database; the shape is `energyCsvDocument`'s.
 *
 * **Every file is long-format.** Each row is one value at one bucket, so the same
 * four shapers serve CSV and XLSX and a spreadsheet pivots them. A file opens with
 * a header block (`zone`, `level`, `bucket`, `from`, `to`, one two-cell row each),
 * then a blank row, then the column header.
 *
 * **The F4.29 guard holds in both formats.** CSV: every string through
 * `csvTextCell` (a leading formula leader gets a quote), every number through
 * `csvNumberCell` (it throws on `NaN`). XLSX: `aoa_to_sheet` writes no `<f>`
 * element, and the table passes `assertFiniteCells`. A `null` is an empty cell,
 * never `0`: a bucket with no samples must not read as a measured zero.
 */

/** One cell. `null` is an empty cell. */
export type ViewExportCell = string | number | null;

/** One row of the file. */
export type ViewExportRow = ViewExportCell[];

/**
 * The five facts every file's header block states. `bucket` is the width between two
 * `bucket_start` values: an aggregate level, or a fold width (`foldWidthLabel`) where the read
 * level and the bucket differ (the trend strip).
 */
export interface ViewExportMeta {
  zone: string;
  level: AggregateLevel;
  bucket: string;
  from: string;
  to: string;
}

/** A fold width in the level's own units: `30m`, `3h`, `1d`, else `<n>s`. */
export function foldWidthLabel(seconds: number): string {
  if (seconds % 86_400 === 0) {
    return `${seconds / 86_400}d`;
  }
  if (seconds % 3_600 === 0) {
    return `${seconds / 3_600}h`;
  }
  if (seconds % 60 === 0) {
    return `${seconds / 60}m`;
  }
  return `${seconds}s`;
}

/** One plotted bucket with the optional per-bucket statistics. */
export interface ViewExportBucket {
  t: string;
  v: number | null;
  min?: number | null;
  average?: number | null;
  max?: number | null;
  sampleCount?: number;
}

/** One point of the asset history export, already read. */
export interface HistoryExportPoint {
  pointKey: string;
  unit: string | null;
  current: readonly ViewExportBucket[];
  compare: readonly ViewExportBucket[] | null;
}

/**
 * One formatter per zone: building an `Intl.DateTimeFormat` costs far more than formatting with it,
 * and a daily 8-point compare `trend_points` run formats 23 000 bucket starts (`F4.303` U17).
 */
const ZONE_FORMATS = new Map<string, Intl.DateTimeFormat>();

function zoneFormat(zone: string): Intl.DateTimeFormat {
  let format = ZONE_FORMATS.get(zone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "longOffset",
    });
    ZONE_FORMATS.set(zone, format);
  }
  return format;
}

/**
 * `YYYY-MM-DDTHH:mm:ss±HH:MM` for the instant `iso` in the IANA zone `zone`.
 * `Intl` gives the offset as `GMT`, `GMT+05:30` or `GMT-5`; `GMT` becomes `+00:00`.
 */
export function isoInZone(iso: string, zone: string): string {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) {
    throw new Error(`isoInZone received an unparseable instant: ${iso}`);
  }
  const parts = zoneFormat(zone).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  const rawOffset = part("timeZoneName").replace("GMT", "");
  let offset = "+00:00";
  if (rawOffset !== "") {
    const match = /^([+-])(\d{1,2})(?::(\d{2}))?$/.exec(rawOffset);
    if (match === null) {
      throw new Error(`isoInZone received an unreadable offset: ${rawOffset}`);
    }
    offset = `${match[1]}${match[2].padStart(2, "0")}:${match[3] ?? "00"}`;
  }
  return (
    `${part("year")}-${part("month")}-${part("day")}` +
    `T${part("hour")}:${part("minute")}:${part("second")}${offset}`
  );
}

/**
 * Refuses a file of more than `cap` rows with the owner's sentence (Amendment 6
 * item 3, Q3). Never a truncation: a short file that looks complete is the outcome
 * ADR 0021 rejects. `cap` is a seam for the specs; routes pass nothing.
 */
export function assertViewExportWithinCap(rowCount: number, cap: number = MAX_EXPORT_ROWS): void {
  if (rowCount > cap) {
    throw new BadRequestException(
      `Export would hold ${rowCount} rows, above the ${cap} row limit. Narrow the range or the points.`,
    );
  }
}

function headerBlock(meta: ViewExportMeta, columns: string[]): ViewExportRow[] {
  return [
    ["zone", meta.zone],
    ["level", meta.level],
    ["bucket", meta.bucket],
    ["from", isoInZone(meta.from, meta.zone)],
    ["to", isoInZone(meta.to, meta.zone)],
    [],
    columns,
  ];
}

/** The part of one `EnergyViewPeriod` the export reads: its bounds and its source-mix series. */
export type EnergyExportPeriod = Pick<EnergyViewPeriod, "from" | "to" | "series">;

/**
 * Energy view: by source (grid, solar, dg) for each period, and by site for the current one.
 * `F4.303` U3: the periods are {@link EnergyExportPeriod}, not whole `EnergyViewPeriod`s — the
 * export reads the series and the trend only, never the KPIs.
 */
export function energyViewExportRows(
  view: Pick<EnergyView, "timeZone" | "level" | "bucket"> & {
    current: EnergyExportPeriod;
    compare: EnergyExportPeriod | null;
  },
  trend: EnergySiteTrend,
): ViewExportRow[] {
  const zone = view.timeZone;
  const rows = headerBlock(
    { zone, level: view.level, bucket: view.bucket, from: view.current.from, to: view.current.to },
    ["grouping", "name", "period", "bucket_start", "kw"],
  );
  const periods = [
    ["current", view.current.series],
    ...(view.compare === null ? [] : [["previous", view.compare.series] as const]),
  ] as const;
  for (const [period, series] of periods) {
    for (const point of series) {
      const at = isoInZone(point.t, zone);
      rows.push(["source", "grid", period, at, point.gridKw]);
      rows.push(["source", "solar", period, at, point.solarKw]);
      rows.push(["source", "dg", period, at, point.dgKw]);
    }
  }
  for (const point of trend.points) {
    const at = isoInZone(point.t, zone);
    trend.columns.forEach((column, index) => {
      rows.push(["site", column.kind === "site" ? column.name : "other", "current", at, point.kw[index] ?? null]);
    });
  }
  return rows;
}

/** Segment sub-tab: one row per drawn ranking entry per bucket per period. */
export function segmentViewExportRows(
  view: Pick<SiteSegmentViewsDto, "timeZone" | "level" | "bucket" | "current" | "ranking" | "point">,
): ViewExportRow[] {
  const zone = view.timeZone;
  const rows = headerBlock(
    { zone, level: view.level, bucket: view.bucket, from: view.current.from, to: view.current.to },
    ["asset_code", "asset_name", "point", "unit", "period", "bucket_start", "mean"],
  );
  const pointCode = view.point?.code ?? "";
  for (const entry of view.ranking) {
    for (const [period, buckets] of [
      ["current", entry.buckets],
      ["previous", entry.compareBuckets],
    ] as const) {
      for (const bucket of buckets ?? []) {
        rows.push([entry.assetCode, entry.assetName, pointCode, entry.unit, period, isoInZone(bucket.t, zone), bucket.v]);
      }
    }
  }
  return rows;
}

/**
 * Trend strip: one row per (segment, point, asset) per bucket. The strip reads at `level` and
 * folds into `bucketSeconds` (`TREND_STRIP_RANGES`), so the header's `bucket` is the fold width.
 */
export function trendStripExportRows(
  strip: Pick<SiteTrendStripDto, "timeZone" | "level" | "bucketSeconds" | "from" | "to" | "segments">,
): ViewExportRow[] {
  const zone = strip.timeZone;
  const rows = headerBlock(
    { zone, level: strip.level, bucket: foldWidthLabel(strip.bucketSeconds), from: strip.from, to: strip.to },
    ["segment", "point", "asset_code", "asset_name", "unit", "bucket_start", "mean"],
  );
  for (const segment of strip.segments) {
    for (const point of segment.points) {
      for (const asset of point.assets) {
        for (const bucket of asset.buckets) {
          rows.push([
            segment.domain,
            point.code,
            asset.assetCode,
            asset.assetName,
            asset.unit,
            isoInZone(bucket.t, zone),
            bucket.v,
          ]);
        }
      }
    }
  }
  return rows;
}

/** Asset history: one row per point per bucket per period, with the bucket statistics. */
export function assetHistoryExportRows(
  meta: ViewExportMeta,
  points: readonly HistoryExportPoint[],
): ViewExportRow[] {
  const rows = headerBlock(meta, [
    "point",
    "unit",
    "period",
    "bucket_start",
    "value",
    "min",
    "average",
    "max",
    "samples",
  ]);
  for (const point of points) {
    for (const [period, buckets] of [
      ["current", point.current],
      ["previous", point.compare ?? []],
    ] as const) {
      for (const bucket of buckets) {
        rows.push([
          point.pointKey,
          point.unit,
          period,
          isoInZone(bucket.t, meta.zone),
          bucket.v,
          bucket.min ?? null,
          bucket.average ?? null,
          bucket.max ?? null,
          bucket.sampleCount ?? null,
        ]);
      }
    }
  }
  return rows;
}

function csvCell(cell: ViewExportCell): CsvField {
  if (cell === null) {
    return csvTextCell("");
  }
  return typeof cell === "number" ? csvNumberCell(cell) : csvTextCell(cell);
}

/** The CSV document: LF line endings, a final newline, the F4.29 guard on every cell. */
export function viewExportCsv(rows: readonly ViewExportRow[]): string {
  return csvDocument(rows.map((row) => row.map(csvCell)));
}

/** The XLSX workbook, one sheet `Export`. A `null` is an empty string cell. */
export function viewExportXlsx(rows: readonly ViewExportRow[]): Buffer {
  const table = assertFiniteCells(rows.map((row) => row.map((cell) => cell ?? "")));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(table), "Export");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
