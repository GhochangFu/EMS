import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { Pool } from "pg";
import { expect } from "vitest";

import type { AggregateLevel, EnergyViewQuery, JwtPayload } from "@bms/shared";

import { siteSeriesRead } from "./energy-organization-reads";
import { energyPeriodRead } from "./energy-view-read";
import { EnergyViewExportService, energyViewExportRowCount } from "./energy-view-export.service";
import type { EnergyViewFrame } from "./energy-view.service";
import { isoInZone, viewExportCsv, type ViewExportRow } from "./view-export.serialise";

/**
 * `F4.303` U3 (ADR 0108 Amendment 6 item 3) — `EnergyViewExportService` over a
 * `frame` fake and a recording pool (the `energy-view.service.spec.ts` style).
 * The real `energyPeriodRead` and `siteSeriesRead` run against the fake pool,
 * which tells them apart by their SQL. What the database answers is
 * `energy-view.integration.spec.ts`'s. Vitest entry point: the sibling `.test.ts`.
 */

const USER = { sub: "11111111-1111-4111-8111-111111111111", role: "viewer" } as JwtPayload;
const ORG = "00000000-0000-4000-8000-0000000000aa";
const ASSET = "30000000-0000-4000-8000-000000000001";
const SITE = "40000000-0000-4000-8000-000000000001";
const START = new Date("2026-11-02T00:00:00.000Z");
const END = new Date("2026-11-03T00:00:00.000Z");
const T1 = "2026-11-02T03:00:00.000Z";
const T2 = "2026-11-02T04:00:00.000Z";
const QUERY = { range: "24h", organizationId: ORG, compare: "previous" } as EnergyViewQuery;
const HEADER_ROWS = 7;

type FrameOptions = { previous?: boolean; durationHours?: number; bucket?: AggregateLevel; level?: AggregateLevel };

function frameOf(options: FrameOptions = {}): EnergyViewFrame {
  const durationHours = options.durationHours ?? 24;
  const end = new Date(START.getTime() + durationHours * 3_600_000);
  const previousStart = new Date(START.getTime() - durationHours * 3_600_000);
  return {
    organizationId: ORG,
    assetIds: [ASSET],
    zone: { timeZone: "Asia/Kolkata", arithmeticZone: "Asia/Kolkata" },
    current: { start: START, end, durationHours },
    previous: options.previous === false ? null : { start: previousStart, end: START, durationHours },
    level: options.level ?? "1h",
    bucket: options.bucket ?? "1h",
    partial: null,
    now: END,
    floorArea: null,
  };
}

/** The `energyPeriodRead` answer: two display buckets of the source mix. */
function periodRow() {
  return {
    total_kwh: 30,
    solar_kwh: 4,
    peak_kw: 17.5,
    peak_at: T2,
    bucket_count: 2,
    series: [
      { t: T1, total_kw: 12.5, solar_kw: 2 },
      { t: T2, total_kw: 17.5, solar_kw: 2.25 },
    ],
  };
}

/** The `siteSeriesRead` answer: one site and the `other` fold, with values that round. */
function siteSeriesRow() {
  return {
    columns: [{ location_id: SITE, name: "Alpha", rn: 1 }],
    site_count: 9,
    buckets: [
      { t: T1, n: 1 },
      { t: T2, n: 1 },
    ],
    cells: [
      { t: T1, col: 1, kw: 10.234 },
      { t: T1, col: 2, kw: 2.266 },
      { t: T2, col: 1, kw: 11.111 },
      { t: T2, col: 2, kw: 6.389 },
    ],
  };
}

function isSiteSeries(text: string): boolean {
  return text.includes("site_bucket");
}

function fake(options: { frame?: EnergyViewFrame | Error } = {}) {
  const log: string[] = [];
  const statements: string[] = [];
  const pool = {
    query: async (text: string) => {
      statements.push(text);
      log.push(isSiteSeries(text) ? "statement:siteSeries" : "statement:period");
      return { rows: [isSiteSeries(text) ? siteSeriesRow() : periodRow()] };
    },
  } as unknown as Pool;
  const frameCalls: unknown[][] = [];
  const views = {
    frame: async (user: JwtPayload, query: EnergyViewQuery) => {
      log.push("frame");
      frameCalls.push([user, query]);
      const frame = options.frame ?? frameOf();
      if (frame instanceof Error) throw frame;
      return frame;
    },
  };
  const service = new EnergyViewExportService(pool, views);
  return { service, pool, log, statements, frameCalls };
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("resolved, expected a refusal");
}

function bodyOf(rows: ViewExportRow[]): ViewExportRow[] {
  return rows.slice(HEADER_ROWS);
}

/** E1: a frame refusal (403) propagates, and no pool statement runs. */
export async function aFrameRefusalRunsNoStatement(): Promise<void> {
  const f = fake({ frame: new ForbiddenException("organizationId is outside your access scope") });
  const err = await refusal(f.service.rows(USER, QUERY));
  expect(err).toBeInstanceOf(ForbiddenException);
  expect(f.statements).toEqual([]);
}

/** E1: the user and the parsed query reach `frame`, and it runs before any statement. */
export async function theFrameRunsFirstWithTheUserAndTheQuery(): Promise<void> {
  const f = fake();
  await f.service.rows(USER, QUERY);
  expect(f.frameCalls).toEqual([[USER, QUERY]]);
  expect(f.log[0]).toBe("frame");
}

/** E2: with compare, one `energyPeriodRead` per period and one `siteSeriesRead`, nothing else. */
export async function onePeriodReadPerPeriodAndOneSiteSeriesRead(): Promise<void> {
  const f = fake();
  await f.service.rows(USER, QUERY);
  expect(f.log).toEqual(["frame", "statement:period", "statement:period", "statement:siteSeries"]);
}

/** E2: without compare, one period read and one site-series read. */
export async function noCompareReadsOnePeriod(): Promise<void> {
  const f = fake({ frame: frameOf({ previous: false }) });
  await f.service.rows(USER, QUERY);
  expect(f.log).toEqual(["frame", "statement:period", "statement:siteSeries"]);
}

/** E3: the by-source `kw` per bucket, source and period equals `energyPeriodRead`'s series — the screen's figure. */
export async function theBySourceRowsEqualTheSeries(): Promise<void> {
  const f = fake();
  const frame = frameOf();
  const { series } = await energyPeriodRead(f.pool, {
    level: frame.level,
    bucket: frame.bucket,
    timeZone: frame.zone.arithmeticZone,
    start: frame.current.start,
    end: frame.current.end,
    assetIds: frame.assetIds,
  });
  const expected: ViewExportRow[] = [];
  for (const period of ["current", "previous"]) {
    for (const point of series) {
      const at = isoInZone(point.t, "Asia/Kolkata");
      expected.push(["source", "grid", period, at, point.gridKw]);
      expected.push(["source", "solar", period, at, point.solarKw]);
      expected.push(["source", "dg", period, at, point.dgKw]);
    }
  }
  const rows = bodyOf(await f.service.rows(USER, QUERY)).filter((row) => row[0] === "source");
  expect(series.length).toBe(2);
  expect(rows).toEqual(expected);
}

/** E3: the by-site rows equal `trend.points[j].kw[i]` against `trend.columns[i]`, rounded to 2 as on screen. */
export async function theBySiteRowsEqualTheTrend(): Promise<void> {
  const f = fake();
  const frame = frameOf();
  const trend = await siteSeriesRead(f.pool, {
    level: frame.level,
    bucket: frame.bucket,
    timeZone: frame.zone.arithmeticZone,
    start: frame.current.start,
    end: frame.current.end,
    assetIds: frame.assetIds,
    siteLimit: 8,
  });
  const expected: ViewExportRow[] = [];
  for (const point of trend.points) {
    trend.columns.forEach((column, index) => {
      expected.push([
        "site",
        column.kind === "site" ? column.name : "other",
        "current",
        isoInZone(point.t, "Asia/Kolkata"),
        Math.round((point.kw[index] as number) * 100) / 100,
      ]);
    });
  }
  const rows = bodyOf(await f.service.rows(USER, QUERY)).filter((row) => row[0] === "site");
  expect(rows).toEqual(expected);
  expect(rows.map((row) => row[4])).toEqual([10.23, 2.27, 11.11, 6.39]);
}

/** E4: the row count is the frame's arithmetic: 3 × buckets × periods + (8 + 1) × buckets. */
export function theRowCountIsTheFramesArithmetic(): void {
  expect(energyViewExportRowCount(frameOf())).toBe(3 * 24 * 2 + 9 * 24);
  expect(energyViewExportRowCount(frameOf({ previous: false }))).toBe(3 * 24 + 9 * 24);
}

/** E4: a lowered cap gives the owner's 400 sentence, and no statement has run. */
export async function aLoweredCapRefusesBeforeAnyStatement(): Promise<void> {
  const f = fake();
  const err = await refusal(f.service.rows(USER, QUERY, 10));
  expect(err).toBeInstanceOf(BadRequestException);
  expect((err as BadRequestException).message).toBe(
    "Export would hold 360 rows, above the 10 row limit. Narrow the range or the points.",
  );
  expect(f.log).toEqual(["frame"]);
}

/** E4 positive: a cap of exactly the count passes and the reads run. */
export async function aCapOfExactlyTheCountPasses(): Promise<void> {
  const f = fake();
  await f.service.rows(USER, QUERY, 360);
  expect(f.statements.length).toBe(3);
}

/** E5: a 46-day custom range is exported — the view's own bound, never `energyReportRange`'s 31 days. */
export async function aFortySixDayRangeIsNotRefused(): Promise<void> {
  const f = fake({ frame: frameOf({ durationHours: 46 * 24, bucket: "1d", previous: false }) });
  const query = {
    range: "custom",
    from: START.toISOString(),
    to: new Date(START.getTime() + 46 * 86_400_000).toISOString(),
    organizationId: ORG,
  } as EnergyViewQuery;
  const rows = await f.service.rows(USER, query);
  expect(rows.length).toBeGreaterThan(HEADER_ROWS);
}

/** E6: the header block is the frame's zone, level, bucket and the current bounds in that zone. */
export async function theHeaderBlockReadsTheFrame(): Promise<void> {
  const f = fake({ frame: frameOf({ level: "1h", bucket: "1d", durationHours: 72 }) });
  const rows = await f.service.rows(USER, QUERY);
  expect(rows.slice(0, 5)).toEqual([
    ["zone", "Asia/Kolkata"],
    ["level", "1h"],
    ["bucket", "1d"],
    ["from", isoInZone(START.toISOString(), "Asia/Kolkata")],
    ["to", isoInZone(new Date(START.getTime() + 72 * 3_600_000).toISOString(), "Asia/Kolkata")],
  ]);
}

/** The CSV route's body is `viewExportCsv` over the same rows. */
export async function csvIsTheWriterOverTheRows(): Promise<void> {
  const f = fake();
  const csv = await f.service.csv(USER, QUERY);
  expect(csv).toBe(viewExportCsv(await fake().service.rows(USER, QUERY)));
}

/** The XLSX route's body is a zip (the `PK` signature) of the same rows. */
export async function xlsxIsAWorkbook(): Promise<void> {
  const f = fake();
  const body = await f.service.xlsx(USER, QUERY);
  expect(body.subarray(0, 2).toString("latin1")).toBe("PK");
  expect(f.log).toEqual(["frame", "statement:period", "statement:period", "statement:siteSeries"]);
}
