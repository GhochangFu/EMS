import type { PointAggregateResponse, TrendPointsReportParams } from "@bms/shared";

import type { BmsTx } from "../database/tenant-context";
import type { TelemetryService } from "../telemetry/telemetry.service";
import { TrendPointsReportService, type TrendPointsPlanInput } from "./trend-points-report.service";

/**
 * `F4.303` U13 (ADR 0108 Amendment 6 item 8, `trend_points`) — `TrendPointsReportService` over a
 * `TelemetryService` fake and a `tx` fake for its two selects (dispatched on the projection's
 * shape, so the fake never guesses which read it serves). Assertions live here;
 * `trend-points-report.service.test.ts` is the Vitest entry point (§4.6). Each claim builds a fresh
 * harness, so every count is per call.
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const ASSET_A = "66666666-6666-4666-8666-666666666666";
const ASSET_B = "67676767-6767-4676-8676-676767676767";
const ASSET_GONE = "68686868-6868-4686-8686-686868686868";
const NOW = new Date("2026-11-03T06:00:00.000Z");

type Registration = {
  assetId: string;
  pointKey: string;
  unit: string | null;
  assetCode: string;
  assetRtuName: string | null;
  assetLocationName: string | null;
};

/** `F4.316` PR 6: the two selects' projections (sorted keys), each now naming the RTU and location for the label. */
const KEPT_SHAPE = "assetCode,assetId,assetLocationName,assetRtuName,pointKey,unit";
const DROPPED_SHAPE = "code,id,locationName,rtuName";

type Scenario = {
  /** The active registrations the kept-pairs select answers (before its own filter). */
  registrations?: Registration[];
  /** The asset rows the dropped-names select can see. */
  visibleAssets?: { id: string; code: string; rtuName: string | null; locationName: string | null }[];
};

type AggregateCall = { point: { assetId: string; pointKey: string }; options: Record<string, unknown> };

function chain(resolve: () => Promise<unknown>): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop): unknown {
        if (prop === "then") {
          return (res: (v: unknown) => void, rej: (e: unknown) => void) => resolve().then(res, rej);
        }
        return () => proxy;
      },
    },
  );
  return proxy;
}

function response(point: { assetId: string; pointKey: string }, compare: boolean): PointAggregateResponse {
  const stats = { sum: 1, average: 1, min: 1, max: 1, peakAt: null, sampleCount: 1 };
  const buckets = [{ t: "2026-11-01T18:30:00.000Z", v: 1, min: 1, average: 1, max: 1, sampleCount: 1 }];
  return {
    pointRef: `${point.assetId}::${point.pointKey}`,
    from: "2026-11-01T18:30:00.000Z",
    to: "2026-11-02T18:30:00.000Z",
    bucketSeconds: 60,
    stats,
    timeZone: "Asia/Kolkata",
    compare: compare ? { from: "2026-10-31T18:30:00.000Z", to: "2026-11-01T18:30:00.000Z", stats, buckets } : null,
    buckets,
  };
}

function harness(scenario: Scenario = {}) {
  const aggregateCalls: AggregateCall[] = [];
  const selects: string[] = [];
  const telemetry = {
    pointAggregate: async (point: { assetId: string; pointKey: string }, options: Record<string, unknown>) => {
      aggregateCalls.push({ point, options });
      return response(point, options.compare === true);
    },
  } as unknown as TelemetryService;
  const tx = {
    select: (projection: Record<string, unknown>) => {
      const shape = Object.keys(projection).sort().join(",");
      return chain(async () => {
        selects.push(shape);
        if (shape === KEPT_SHAPE) {
          return scenario.registrations ?? [
            { assetId: ASSET_A, pointKey: "kw", unit: "kW", assetCode: "A1", assetRtuName: "RTU 1", assetLocationName: "Plant" },
            { assetId: ASSET_B, pointKey: "pf", unit: null, assetCode: "B2", assetRtuName: null, assetLocationName: "Plant" },
          ];
        }
        if (shape === DROPPED_SHAPE) {
          return scenario.visibleAssets ?? [];
        }
        throw new Error(`tx fake: unexpected select shape ${shape}`);
      });
    },
  } as unknown as BmsTx;
  return { service: new TrendPointsReportService(telemetry), aggregateCalls, selects, tx };
}

function params(overrides: Partial<TrendPointsReportParams> = {}): TrendPointsReportParams {
  return {
    points: [
      { assetId: ASSET_A, pointKey: "kw" },
      { assetId: ASSET_B, pointKey: "pf" },
    ],
    compare: false,
    ...overrides,
  };
}

function planInput(overrides: Partial<TrendPointsPlanInput> = {}): TrendPointsPlanInput {
  return {
    scheduleName: "Daily kW",
    timezone: "Asia/Kolkata",
    periodStart: "2026-11-02",
    periodEnd: "2026-11-02",
    params: params(),
    assetIds: [ASSET_A, ASSET_B],
    now: NOW,
    ...overrides,
  };
}

async function readAll(scenario: Scenario, overrides: Partial<TrendPointsPlanInput> = {}) {
  const h = harness(scenario);
  const plan = await h.service.plan(planInput(overrides), h.tx);
  const rows = await h.service.read(plan);
  return { h, plan, rows };
}

/** V1 — a daily period in `Asia/Kolkata` reads from local midnight to the midnight after `periodEnd`, 1 440 minutes. */
export async function assertADailyPeriodReadsTheLocalDay(): Promise<void> {
  const { h } = await readAll({});
  const options = h.aggregateCalls[0]?.options ?? {};
  const got = `${(options.from as Date | undefined)?.toISOString()} ${(options.to as Date | undefined)?.toISOString()} ${String(options.windowMinutes)}`;
  assert(
    got === "2026-11-01T18:30:00.000Z 2026-11-02T18:30:00.000Z 1440",
    `expected the Kolkata day 2026-11-02 over 1440 minutes, got ${got}`,
  );
}

/** V1 — a daily period prints the `1m` level. */
export async function assertADailyPeriodPrintsOneMinute(): Promise<void> {
  const { plan, rows } = await readAll({});
  assert(plan.level === "1m" && rows.level === "1m", `expected 1m, got plan ${plan.level} and rows ${rows.level}`);
}

/** V1 — a weekly period prints the `1h` level. */
export async function assertAWeeklyPeriodPrintsOneHour(): Promise<void> {
  const { plan } = await readAll({}, { periodStart: "2026-10-26", periodEnd: "2026-11-01" });
  assert(plan.level === "1h", `expected 1h for a week, got ${plan.level}`);
}

/** V1 — a 30-day monthly period prints the `1h` level. */
export async function assertAMonthlyPeriodPrintsOneHour(): Promise<void> {
  const { plan } = await readAll({}, { periodStart: "2026-09-01", periodEnd: "2026-09-30", now: new Date("2026-10-01T06:00:00.000Z") });
  assert(plan.level === "1h", `expected 1h for a 30-day month, got ${plan.level}`);
}

/** V1 — `now` reaches every read, so the read's level is the one the report prints. */
export async function assertNowReachesEveryRead(): Promise<void> {
  const { h } = await readAll({});
  const nows = h.aggregateCalls.map((call) => (call.options.now as Date | undefined)?.toISOString());
  assert(nows.length === 2 && nows.every((n) => n === NOW.toISOString()), `expected now on both reads, got ${JSON.stringify(nows)}`);
}

/** V2 — `compare = params.compare` reaches every read. */
export async function assertCompareReachesEveryRead(): Promise<void> {
  const { h } = await readAll({}, { params: params({ compare: true }) });
  const compares = h.aggregateCalls.map((call) => call.options.compare);
  assert(JSON.stringify(compares) === JSON.stringify([true, true]), `expected compare true on both reads, got ${JSON.stringify(compares)}`);
}

/** V2 — positive control: without compare every read says `false`. */
export async function assertNoCompareReachesEveryRead(): Promise<void> {
  const { h } = await readAll({});
  const compares = h.aggregateCalls.map((call) => call.options.compare);
  assert(JSON.stringify(compares) === JSON.stringify([false, false]), `expected compare false on both reads, got ${JSON.stringify(compares)}`);
}

/**
 * V3 — a pair whose asset is not among the schedule's assets is dropped, named by its label
 * (`F4.316`: `<code> · <RTU>`), and never read.
 */
export async function assertAnAssetOutsideTheScheduleIsDroppedByCode(): Promise<void> {
  const { h, rows } = await readAll(
    { visibleAssets: [{ id: ASSET_B, code: "B2", rtuName: "RTU 2", locationName: "Plant" }] },
    { assetIds: [ASSET_A] },
  );
  const read = h.aggregateCalls.map((call) => call.point.assetId);
  assert(
    JSON.stringify(read) === JSON.stringify([ASSET_A]) && rows.dropped === "1 of 2 points were left out: B2 · RTU 2 · pf",
    `expected only A read and B named, got reads ${JSON.stringify(read)} and ${JSON.stringify(rows.dropped)}`,
  );
}

/** V4 — a pair with no active registration is dropped; an asset with no RTU is named `<code> · <location>` (the RTU-less twin). */
export async function assertARetiredRegistrationIsDropped(): Promise<void> {
  const { h, rows } = await readAll({
    registrations: [{ assetId: ASSET_A, pointKey: "kw", unit: "kW", assetCode: "A1", assetRtuName: "RTU 1", assetLocationName: "Plant" }],
    visibleAssets: [{ id: ASSET_B, code: "B2", rtuName: null, locationName: "Plant" }],
  });
  const read = h.aggregateCalls.map((call) => `${call.point.assetId}:${call.point.pointKey}`);
  assert(
    JSON.stringify(read) === JSON.stringify([`${ASSET_A}:kw`]) && rows.dropped === "1 of 2 points were left out: B2 · Plant · pf",
    `expected the retired pair dropped, got reads ${JSON.stringify(read)} and ${JSON.stringify(rows.dropped)}`,
  );
}

/** V5 — a pair whose asset row is invisible is "a deleted asset". */
export async function assertAnInvisibleAssetIsADeletedAsset(): Promise<void> {
  const { rows } = await readAll({}, { params: params({ points: [{ assetId: ASSET_A, pointKey: "kw" }, { assetId: ASSET_GONE, pointKey: "kw" }] }) });
  assert(rows.dropped === "1 of 2 points were left out: a deleted asset · kw", `expected a deleted asset, got ${JSON.stringify(rows.dropped)}`);
}

/** V6 — every point dropped: no read, and both buffers still come back with the sentence in the sheet. */
export async function assertEveryPointDroppedStillGivesBothFiles(): Promise<void> {
  const { h, rows } = await readAll({ registrations: [] }, { params: params({ points: [{ assetId: ASSET_GONE, pointKey: "kw" }] }) });
  const pdf = await h.service.pdf(rows);
  const xlsx = h.service.xlsx(rows);
  const sentence = rows.sheet.some((row) => row.includes("1 of 1 points were left out: a deleted asset · kw"));
  assert(
    h.aggregateCalls.length === 0 && pdf.subarray(0, 4).toString("latin1") === "%PDF" && xlsx.subarray(0, 2).toString("latin1") === "PK" && sentence,
    `expected no read, a PDF, an XLSX and the sentence; got ${h.aggregateCalls.length} reads, sentence ${sentence}`,
  );
}

/** V6 — every point dropped and none visible to the registration filter: the kept select still runs once, the code select once. */
export async function assertEachSelectRunsOncePerPlan(): Promise<void> {
  const { h } = await readAll({ registrations: [] });
  assert(
    JSON.stringify(h.selects) === JSON.stringify([KEPT_SHAPE, DROPPED_SHAPE]),
    `expected one kept-pairs select and one code select, got ${JSON.stringify(h.selects)}`,
  );
}

/** V7 — `bucketFunction: "avg"` and `bucketStats: true` on every read. */
export async function assertEveryReadAsksForAverageBucketsWithStats(): Promise<void> {
  const { h } = await readAll({});
  const asks = h.aggregateCalls.map((call) => `${String(call.options.bucketFunction)}/${String(call.options.bucketStats)}`);
  assert(JSON.stringify(asks) === JSON.stringify(["avg/true", "avg/true"]), `expected avg/true on both reads, got ${JSON.stringify(asks)}`);
}

/** The rows carry one table per kept point, headed by the registration's label (`F4.316`) and unit. */
export async function assertTheKeptPointsBecomeTables(): Promise<void> {
  const { rows } = await readAll({});
  const headings = rows.tables.map((table) => table.heading);
  assert(
    JSON.stringify(headings) === JSON.stringify(["A1 · RTU 1 · kw (kW)", "B2 · Plant · pf"]),
    `expected two tables, got ${JSON.stringify(headings)}`,
  );
}

/** The XLSX buffer is a workbook whose one sheet is `Points`. */
export async function assertTheWorkbookSheetIsPoints(): Promise<void> {
  const { h, rows } = await readAll({});
  const XLSX = await import("xlsx");
  const book = XLSX.read(h.service.xlsx(rows), { type: "buffer" });
  assert(JSON.stringify(book.SheetNames) === JSON.stringify(["Points"]), `expected one sheet Points, got ${JSON.stringify(book.SheetNames)}`);
}

/**
 * `F4.303` U17 (plan C25): the workbook is deflated. Uncompressed, the daily 8-point compare run
 * measured 9.9 MB beside a 3.1 MB PDF — over the 10 MB mail ceiling, so the mail dropped both
 * attachments. The first zip entry's method field (offset 8) is 8, deflate, not 0, stored.
 */
export async function assertTheWorkbookIsDeflated(): Promise<void> {
  const { h, rows } = await readAll({});
  const buffer = h.service.xlsx(rows);
  assert(buffer.readUInt16LE(8) === 8, `expected zip method 8 (deflate), got ${buffer.readUInt16LE(8)}`);
}
