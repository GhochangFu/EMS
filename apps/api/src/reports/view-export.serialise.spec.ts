import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BadRequestException } from "@nestjs/common";
import { expect } from "vitest";
import * as XLSX from "xlsx";

import { repoRoot } from "../testing/repo-root";
import {
  assertViewExportWithinCap,
  assetHistoryExportRows,
  energyViewExportRows,
  isoInZone,
  segmentViewExportRows,
  trendStripExportRows,
  viewExportCsv,
  viewExportXlsx,
} from "./view-export.serialise";
import type { ViewExportRow } from "./view-export.serialise";

/**
 * `F4.303` U2 (ADR 0108 Amendment 6 item 3) — the pure export module: the F4.29
 * guard in both writers, the cap sentence, the zone-aware ISO writer and the four
 * row shapers. Vitest entry point: the sibling `.test.ts` (§4.6).
 */

const GUARD_ROWS: ViewExportRow[] = [["=1+1", 1, null]];

/** S1 */
export function theCsvQuotesAFormulaLeaderAndLeavesNullEmpty(): void {
  expect(viewExportCsv(GUARD_ROWS)).toBe("'=1+1,1,\n");
}

function firstSheet(buffer: Buffer): XLSX.WorkSheet {
  const book = XLSX.read(buffer, { type: "buffer" });
  return book.Sheets[book.SheetNames[0]];
}

/** S2 — the formula text is a string cell and no `<f>` formula survives the round trip. */
export function theXlsxHoldsAFormulaLeaderAsAString(): void {
  const cell = firstSheet(viewExportXlsx(GUARD_ROWS)).A1;
  expect(cell.t).toBe("s");
  expect(cell.v).toBe("=1+1");
  expect(cell.f).toBeUndefined();
}

/** S2 — one sheet, named Export. */
export function theXlsxHasOneSheetNamedExport(): void {
  const book = XLSX.read(viewExportXlsx(GUARD_ROWS), { type: "buffer" });
  expect(book.SheetNames).toEqual(["Export"]);
}

/** S3 — one claim per writer. */
export function theCsvWriterRefusesNaN(): void {
  expect(() => viewExportCsv([["x", Number.NaN]])).toThrow();
}

export function theXlsxWriterRefusesNaN(): void {
  expect(() => viewExportXlsx([["x", Number.NaN]])).toThrow();
}

/** S4 */
export function theCapSentenceIsTheOwnersAbove(): void {
  expect(() => assertViewExportWithinCap(50_001)).toThrow(
    new BadRequestException("Export would hold 50001 rows, above the 50000 row limit. Narrow the range or the points."),
  );
}

export function theCapAdmitsExactlyTheLimit(): void {
  expect(() => assertViewExportWithinCap(50_000)).not.toThrow();
}

export function theCapTakesALoweredCap(): void {
  expect(() => assertViewExportWithinCap(10, 5)).toThrow(BadRequestException);
}

/** S5 */
export function isoInZoneWritesKolkata(): void {
  expect(isoInZone("2026-11-03T00:30:00.000Z", "Asia/Kolkata")).toBe("2026-11-03T06:00:00+05:30");
}

export function isoInZoneWritesUtcAsZeroOffset(): void {
  expect(isoInZone("2026-11-03T00:30:00.000Z", "Etc/UTC")).toBe("2026-11-03T00:30:00+00:00");
}

export function isoInZoneWritesNewYorkWinter(): void {
  expect(isoInZone("2026-01-15T12:00:00.000Z", "America/New_York")).toBe("2026-01-15T07:00:00-05:00");
}

export function isoInZoneWritesMidnightAsHourZero(): void {
  expect(isoInZone("2026-11-03T00:00:00.000Z", "Etc/UTC")).toBe("2026-11-03T00:00:00+00:00");
}

// --- the shapers -----------------------------------------------------------

const HEADER_KEYS = ["zone", "level", "bucket", "from", "to"];

function expectHeaderBlock(rows: ViewExportRow[], columns: string[]): void {
  expect(rows.slice(0, 5).map((row) => row[0])).toEqual(HEADER_KEYS);
  expect(rows.slice(0, 5).every((row) => row.length === 2)).toBe(true);
  expect(rows[5]).toEqual([]);
  expect(rows[6]).toEqual(columns);
}

const T1 = "2026-11-03T00:00:00.000Z";
const T2 = "2026-11-03T01:00:00.000Z";

type EnergyArgs = Parameters<typeof energyViewExportRows>;

function energyArgs(withCompare: boolean): EnergyArgs {
  const series = [
    { t: T1, gridKw: 1, solarKw: 2, dgKw: 3 },
    { t: T2, gridKw: 4, solarKw: 5, dgKw: 6 },
  ];
  return [
    {
      timeZone: "Asia/Kolkata",
      level: "1h",
      bucket: "1h",
      current: { from: T1, to: T2, series },
      compare: withCompare ? { from: T1, to: T2, series } : null,
    },
    {
      columns: [{ kind: "site", locationId: "x", name: "Alpha" }, { kind: "other" }],
      points: [
        { t: T1, kw: [10, 20] },
        { t: T2, kw: [30, 40] },
      ],
    },
  ] as unknown as EnergyArgs;
}

/** S6 */
export function energyRowsOpenWithTheHeaderBlock(): void {
  expectHeaderBlock(energyViewExportRows(...energyArgs(false)), ["grouping", "name", "period", "bucket_start", "kw"]);
}

export function energyRowsHaveThreeSourceRowsPerBucketPerPeriod(): void {
  const rows = energyViewExportRows(...energyArgs(true)).slice(7);
  const bySource = rows.filter((row) => row[0] === "source");
  expect(bySource).toHaveLength(2 * 3 * 2);
  expect(bySource.filter((row) => row[2] === "previous")).toHaveLength(6);
}

export function energyRowsHaveOneSiteRowPerColumnPerBucketForCurrentOnly(): void {
  const rows = energyViewExportRows(...energyArgs(true)).slice(7);
  const bySite = rows.filter((row) => row[0] === "site");
  expect(bySite).toEqual([
    ["site", "Alpha", "current", "2026-11-03T05:30:00+05:30", 10],
    ["site", "other", "current", "2026-11-03T05:30:00+05:30", 20],
    ["site", "Alpha", "current", "2026-11-03T06:30:00+05:30", 30],
    ["site", "other", "current", "2026-11-03T06:30:00+05:30", 40],
  ]);
}

type SegmentArg = Parameters<typeof segmentViewExportRows>[0];

export function segmentRowsOpenWithTheHeaderBlock(): void {
  expectHeaderBlock(segmentViewExportRows(segmentView()), [
    "asset_code",
    "asset_name",
    "asset_label",
    "point",
    "unit",
    "period",
    "bucket_start",
    "mean",
  ]);
}

function segmentView(): SegmentArg {
  return {
    timeZone: "Etc/UTC",
    level: "1h",
    bucket: "1h",
    current: { from: T1, to: T2, durationHours: 1 },
    point: { code: "kw" },
    ranking: [
      { assetCode: "A1", assetRtuName: "RTU 1", assetLocationName: "Plant", assetName: "One", unit: "kW", buckets: [{ t: T1, v: 5 }], compareBuckets: [{ t: T1, v: 4 }] },
      { assetCode: "A2", assetRtuName: null, assetLocationName: "Plant", assetName: "Two", unit: "kW", buckets: null, compareBuckets: null },
    ],
  } as unknown as SegmentArg;
}

export function segmentRowsHoldOnlyDrawnEntries(): void {
  const rows = segmentViewExportRows(segmentView()).slice(7);
  expect(rows).toEqual([
    ["A1", "One", "A1 · RTU 1", "kw", "kW", "current", "2026-11-03T00:00:00+00:00", 5],
    ["A1", "One", "A1 · RTU 1", "kw", "kW", "previous", "2026-11-03T00:00:00+00:00", 4],
  ]);
}

type StripArg = Parameters<typeof trendStripExportRows>[0];

function strip(): StripArg {
  return {
    timeZone: "Etc/UTC",
    level: "1h",
    from: T1,
    to: T2,
    segments: [
      {
        domain: "hvac",
        points: [
          {
            code: "temp",
            assets: [
              { assetCode: "A1", assetRtuName: "RTU 1", assetLocationName: "Plant", assetName: "One", unit: "C", buckets: [{ t: T1, v: 20 }, { t: T2, v: null }] },
              { assetCode: "A2", assetRtuName: null, assetLocationName: "Plant", assetName: "Two", unit: "C", buckets: [{ t: T1, v: 22 }] },
            ],
          },
        ],
      },
    ],
  } as unknown as StripArg;
}

export function stripRowsOpenWithTheHeaderBlock(): void {
  expectHeaderBlock(trendStripExportRows(strip()), [
    "segment",
    "point",
    "asset_code",
    "asset_name",
    "asset_label",
    "unit",
    "bucket_start",
    "mean",
  ]);
}

export function stripRowsHoldOnePerSegmentPointAssetBucket(): void {
  const rows = trendStripExportRows(strip()).slice(7);
  expect(rows.map((row) => [row[0], row[1], row[2], row[6]])).toEqual([
    ["hvac", "temp", "A1", "2026-11-03T00:00:00+00:00"],
    ["hvac", "temp", "A1", "2026-11-03T01:00:00+00:00"],
    ["hvac", "temp", "A2", "2026-11-03T00:00:00+00:00"],
  ]);
}

/**
 * The strip reads at one level and folds into wider buckets (`TREND_STRIP_RANGES`: 24 h reads
 * `5m` into 1 800 s), so the header's `bucket` is the fold width, never the read level: it must
 * equal the gap between consecutive `bucket_start` values.
 */
export function stripHeaderBucketIsTheFoldWidth(): void {
  const t0 = "2026-11-03T00:00:00.000Z";
  const t1 = "2026-11-03T00:30:00.000Z";
  const rows = trendStripExportRows({
    ...strip(),
    level: "5m",
    bucketSeconds: 1800,
    segments: [
      {
        domain: "hvac",
        points: [
          {
            code: "temp",
            assets: [{ assetCode: "A1", assetRtuName: "RTU 1", assetLocationName: "Plant", assetName: "One", unit: "C", buckets: [{ t: t0, v: 1 }, { t: t1, v: 2 }] }],
          },
        ],
      },
    ],
  } as unknown as StripArg);
  const gapSeconds = (Date.parse(String(rows[8]?.[6])) - Date.parse(String(rows[7]?.[6]))) / 1000;
  expect(gapSeconds).toBe(1800);
  expect(rows[2]).toEqual(["bucket", "30m"]);
}

/** The fold width is written in the level's own units: minutes, hours, days, else seconds. */
export function stripHeaderBucketNamesHoursAndDays(): void {
  const header = (bucketSeconds: number) =>
    trendStripExportRows({ ...strip(), bucketSeconds, segments: [] } as unknown as StripArg)[2];
  expect([header(10_800), header(43_200), header(86_400), header(90)]).toEqual([
    ["bucket", "3h"],
    ["bucket", "12h"],
    ["bucket", "1d"],
    ["bucket", "90s"],
  ]);
}

const META = { zone: "Etc/UTC", level: "1h", bucket: "1h", from: T1, to: T2 } as const;

export function historyRowsOpenWithTheHeaderBlock(): void {
  expectHeaderBlock(assetHistoryExportRows(META, []), [
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
}

export function historyRowsCarryTheBucketStatistics(): void {
  const rows = assetHistoryExportRows(META, [
    {
      pointKey: "kw",
      unit: "kW",
      current: [{ t: T1, v: 5, min: 1, average: 5.5, max: 9, sampleCount: 12 }],
      compare: null,
    },
  ]).slice(7);
  expect(rows).toEqual([["kw", "kW", "current", "2026-11-03T00:00:00+00:00", 5, 1, 5.5, 9, 12]]);
}

/** S7 — a bucket with no samples is an empty cell, never a measured zero. */
export function aNullValueIsANullCellNotZero(): void {
  const rows = assetHistoryExportRows(META, [
    { pointKey: "kw", unit: null, current: [{ t: T1, v: null, min: null, sampleCount: 0 }], compare: null },
  ]).slice(7);
  expect(rows[0].slice(4)).toEqual([null, null, null, null, 0]);
}

export function aNullMeanInASegmentRowIsANullCell(): void {
  const view = segmentView();
  (view.ranking[0].buckets as { t: string; v: number | null }[])[0].v = null;
  expect(segmentViewExportRows(view)[7][7]).toBeNull();
}

/**
 * Q1 (U2) — the aggregate range rules have ONE copy in `telemetry-queries.ts`, so
 * the history export query cannot drift from the aggregate read. Reads the source
 * (the `report-file-store.spec.ts` shape); `@bms/shared` has no node types.
 */
export function theRangeRulesHaveOneCopyInTheSource(): void {
  const source = readFileSync(join(repoRoot(), "packages/shared/src/contracts/telemetry-queries.ts"), "utf8");
  expect(source.split("from and to must be given together")).toHaveLength(2);
}

// `F4.316` PR 6 (ADR 0111 decision 4) — the segment and trend-strip rows keep `asset_code` and add
// `asset_label` (`<code> · <RTU>`, else `<code> · <location>`) after `asset_name`. One claim each.

/** L1 — a trend-strip asset under an RTU is labelled `<code> · <RTU>`. */
export function stripRowsCarryTheRtuLabel(): void {
  const rows = trendStripExportRows(strip()).slice(7);
  expect(rows[0]?.slice(2, 5)).toEqual(["A1", "One", "A1 · RTU 1"]);
}

/** L2 — the RTU-less twin: a trend-strip asset with no RTU is labelled by its location. */
export function stripRowsLabelAnRtulessAssetByItsLocation(): void {
  const rows = trendStripExportRows(strip()).slice(7);
  expect(rows[2]?.slice(2, 5)).toEqual(["A2", "Two", "A2 · Plant"]);
}

/** L3 — the RTU-less twin on the segment rows (A2 is not drawn, so give A1 no RTU). */
export function segmentRowsLabelAnRtulessAssetByItsLocation(): void {
  const view = segmentView();
  (view.ranking[0] as { assetRtuName: string | null }).assetRtuName = null;
  expect(segmentViewExportRows(view)[7]?.slice(0, 3)).toEqual(["A1", "One", "A1 · Plant"]);
}

/**
 * L4 (security) — the label is tenant text (code plus an RTU or location display name), so its CSV
 * cell is guarded like every string: a label led by `=` arrives with the apostrophe.
 */
export function aCsvLabelLedByAFormulaLeaderIsGuarded(): void {
  const view = segmentView();
  (view.ranking[0] as { assetCode: string }).assetCode = "=1+1";
  const line = viewExportCsv(segmentViewExportRows(view)).split("\n")[7] ?? "";
  expect(line.split(",")[2]).toBe("'=1+1 · RTU 1");
}
