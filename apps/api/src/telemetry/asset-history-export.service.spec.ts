import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Pool } from "pg";
import { expect } from "vitest";

import { encodePointRef, type JwtPayload, type PointAggregateResponse } from "@bms/shared";

import type { AccessControlService } from "../auth/access-control.service";
import { isoInZone } from "../reports/view-export.serialise";
import { AssetHistoryExportService, assetHistoryExportRowCount } from "./asset-history-export.service";
import { resolveAggregateRange } from "./point-aggregate-window";
import type { TelemetryService } from "./telemetry.service";

/**
 * `F4.303` U5 (ADR 0108 Amendment 6 item 3; plan C6) — `AssetHistoryExportService`
 * over three fakes: an `AccessControlService` that records `canReadAsset`, a
 * `TelemetryService` that records `pointAggregate`, and a pool that records the
 * one registration select. What the database answers is
 * `asset-history-export.integration.spec.ts`'s. Vitest entry point: the sibling
 * `.test.ts`.
 */

const USER = { sub: "11111111-1111-4111-8111-111111111111", role: "viewer" } as JwtPayload;
const ASSET = "30000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-11-03T06:00:00.000Z");
const T1 = "2026-11-03T05:00:00.000Z";
const T2 = "2026-11-03T05:01:00.000Z";
const P1 = "2026-11-03T04:00:00.000Z";
const HEADER_ROWS = 7;
const MESSAGE_403 = "Asset is outside your access scope";
const MESSAGE_404 = "A point in points is not registered on this asset";

type AggregateCall = { point: { assetId: string; pointKey: string }; options: Record<string, unknown> };

/** One point's fake answer: two current buckets (the second a gap) and, with compare, one previous bucket. */
function responseFor(pointKey: string, compare: boolean, base: number): PointAggregateResponse {
  return {
    pointRef: encodePointRef(ASSET, pointKey),
    from: "2026-11-02T06:00:00.000Z",
    to: NOW.toISOString(),
    bucketSeconds: 60,
    stats: { sum: null, average: null, min: null, max: null, peakAt: null, sampleCount: 0 },
    timeZone: "Asia/Kolkata",
    compare: compare
      ? {
          from: "2026-11-01T06:00:00.000Z",
          to: "2026-11-02T06:00:00.000Z",
          stats: { sum: null, average: null, min: null, max: null, peakAt: null, sampleCount: 0 },
          buckets: [{ t: P1, v: base + 9, min: base + 8, average: base + 9, max: base + 10, sampleCount: 4 }],
        }
      : null,
    buckets: [
      { t: T1, v: base + 1, min: base, average: base + 1, max: base + 2, sampleCount: 3 },
      { t: T2, v: null, min: null, average: null, max: null, sampleCount: 0 },
    ],
  };
}

type HarnessOptions = { allow?: boolean; registered?: { point_key: string; unit: string | null }[] };

function harness(options: HarnessOptions = {}) {
  const canRead: string[] = [];
  const statements: { text: string; params: unknown[] }[] = [];
  const aggregates: AggregateCall[] = [];
  const registered = options.registered ?? [
    { point_key: "kw", unit: "kW" },
    { point_key: "pf", unit: null },
  ];
  const access = {
    canReadAsset: async (_jwt: JwtPayload, assetId: string) => {
      canRead.push(assetId);
      return options.allow ?? true;
    },
  } as unknown as AccessControlService;
  const pool = {
    query: async (text: string, params: unknown[] = []) => {
      statements.push({ text, params });
      return { rows: registered };
    },
  } as unknown as Pool;
  const telemetry = {
    pointAggregate: async (point: { assetId: string; pointKey: string }, opts: Record<string, unknown>) => {
      aggregates.push({ point, options: opts });
      const base = point.pointKey === "kw" ? 10 : 100;
      return responseFor(point.pointKey, opts.compare === true, base);
    },
  } as unknown as TelemetryService;
  return { svc: new AssetHistoryExportService(telemetry, access, pool), canRead, statements, aggregates };
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected a rejection; it resolved");
}

/** H1 — a non-UUID asset id is a 400 before `canReadAsset`; a UUID reaches it. */
export async function aNonUuidAssetIdIsA400BeforeTheScope(): Promise<void> {
  const h = harness();
  const err = await rejection(h.svc.exportRows(USER, "not-a-uuid", { points: "kw" }, NOW));
  expect(err).toBeInstanceOf(BadRequestException);
  expect(h.canRead).toEqual([]);
  expect(h.statements).toEqual([]);
  expect(h.aggregates).toEqual([]);

  await h.svc.exportRows(USER, ASSET, { points: "kw" }, NOW);
  expect(h.canRead, "adjacent positive: a UUID reaches the scope check").toEqual([ASSET]);
}

/** H2 — `canReadAsset` false is a 403 with the `aggregate` sentence, before the registration select and any read. */
export async function aForeignAssetIsA403BeforeAnyRead(): Promise<void> {
  const h = harness({ allow: false });
  const err = await rejection(h.svc.exportRows(USER, ASSET, { points: "kw" }, NOW));
  expect(err).toBeInstanceOf(ForbiddenException);
  expect(err.message).toBe(MESSAGE_403);
  expect(h.statements).toEqual([]);
  expect(h.aggregates).toEqual([]);

  const allowed = harness();
  await allowed.svc.exportRows(USER, ASSET, { points: "kw" }, NOW);
  expect(allowed.statements, "adjacent positive: a readable asset runs the select").toHaveLength(1);
  expect(allowed.aggregates).toHaveLength(1);
}

/** H2 — the scope runs before the query: a bad query on a foreign asset is still the 403. */
export async function theScopeRunsBeforeTheQuery(): Promise<void> {
  const foreign = harness({ allow: false });
  const err = await rejection(foreign.svc.exportRows(USER, ASSET, { points: "kw", bogus: "1" }, NOW));
  expect(err).toBeInstanceOf(ForbiddenException);

  const own = harness();
  const bad = await rejection(own.svc.exportRows(USER, ASSET, { points: "kw", bogus: "1" }, NOW));
  expect(bad, "adjacent positive: a readable asset gets the query's 400").toBeInstanceOf(BadRequestException);
  expect(own.statements).toEqual([]);
}

/** H2 — the query is `assetHistoryExportQuerySchema`: a 400 with `flatten()` names the `points` field. */
export async function aBadQueryIsA400WithFlatten(): Promise<void> {
  const h = harness();
  const err = await rejection(h.svc.exportRows(USER, ASSET, { points: "kw,kw" }, NOW));
  expect(err).toBeInstanceOf(BadRequestException);
  const body = (err as BadRequestException).getResponse() as { fieldErrors?: Record<string, string[]> };
  expect(body.fieldErrors?.points).toEqual(["points names a catalog code more than once"]);
  expect(h.statements).toEqual([]);
}

/** H3 — a code the asset does not register is a 404 that names no code, and no aggregate runs. */
export async function anUnregisteredCodeIsA404NamingNoCode(): Promise<void> {
  const h = harness();
  const err = await rejection(h.svc.exportRows(USER, ASSET, { points: "kw,nope" }, NOW));
  expect(err).toBeInstanceOf(NotFoundException);
  expect(err.message).toBe(MESSAGE_404);
  expect(err.message).not.toContain("nope");
  expect(err.message).not.toContain("kw");
  expect(h.aggregates).toEqual([]);
}

/** H3 — the registration select is the asset's active rows on the bound id. */
export async function theRegistrationSelectIsTheAssetsActiveRows(): Promise<void> {
  const h = harness();
  await h.svc.exportRows(USER, ASSET, { points: "kw,pf" }, NOW);
  expect(h.statements).toHaveLength(1);
  expect(h.statements[0]?.text).toMatch(/FROM bms\.asset_points\b/);
  expect(h.statements[0]?.text).toMatch(/asset_id = \$1/);
  expect(h.statements[0]?.text).toMatch(/\bactive\b/);
  expect(h.statements[0]?.params).toEqual([ASSET]);
}

/** H4 — a lowered cap throws the owner's sentence after the select and before any aggregate call. */
export async function aLoweredCapRefusesBeforeAnyAggregate(): Promise<void> {
  const h = harness();
  const err = await rejection(h.svc.exportRows(USER, ASSET, { points: "kw,pf", windowMinutes: "60" }, NOW, 10));
  expect(err).toBeInstanceOf(BadRequestException);
  expect(err.message).toBe("Export would hold 120 rows, above the 10 row limit. Narrow the range or the points.");
  expect(h.statements).toHaveLength(1);
  expect(h.aggregates).toEqual([]);
}

const EIGHT = {
  points: "kw,pf,a1,a2,a3,a4,a5,a6",
  windowMinutes: "2880",
  compare: "true",
};
const EIGHT_REGISTERED = EIGHT.points.split(",").map((code) => ({ point_key: code, unit: null }));

/** H5 — eight points × 2 880 buckets × 2 periods = 46 080 rows passes the real cap. */
export async function theLargestHistoryPassesTheRealCap(): Promise<void> {
  const h = harness({ registered: EIGHT_REGISTERED });
  await h.svc.exportRows(USER, ASSET, EIGHT, NOW);
  expect(h.aggregates).toHaveLength(8);
}

/** H5 — the count is exactly 46 080: a cap one below refuses with that number. */
export async function theLargestHistoryCountsExactly46080(): Promise<void> {
  expect(assetHistoryExportRowCount(8, 2_880, "1m", true)).toBe(46_080);
  const h = harness({ registered: EIGHT_REGISTERED });
  const err = await rejection(h.svc.exportRows(USER, ASSET, EIGHT, NOW, 46_079));
  expect(err.message).toBe("Export would hold 46080 rows, above the 46079 row limit. Narrow the range or the points.");
  expect(h.aggregates).toEqual([]);
}

/** H6 — each point's call carries `bucketStats: true`, the query's function and compare, and the one resolved range. */
export async function eachAggregateCallCarriesTheQuery(): Promise<void> {
  const h = harness();
  await h.svc.exportRows(USER, ASSET, { points: "kw,pf", windowMinutes: "1440", compare: "true", bucketFunction: "max" }, NOW);
  const range = resolveAggregateRange({ windowMinutes: 1_440 }, NOW);
  expect(h.aggregates.map((c) => c.point)).toEqual([
    { assetId: ASSET, pointKey: "kw" },
    { assetId: ASSET, pointKey: "pf" },
  ]);
  for (const call of h.aggregates) {
    expect(call.options).toEqual({
      from: range.from,
      to: range.to,
      windowMinutes: 1_440,
      compare: true,
      bucketFunction: "max",
      bucketStats: true,
      now: NOW,
    });
  }
}

/** H6 — a custom `from`/`to` reaches every call as the same two dates; `bucketFunction` defaults to avg. */
export async function aCustomRangeReachesEveryCall(): Promise<void> {
  const h = harness();
  const from = "2026-11-01T00:00:00.000Z";
  const to = "2026-11-02T00:00:00.000Z";
  await h.svc.exportRows(USER, ASSET, { points: "kw,pf", from, to }, NOW);
  for (const call of h.aggregates) {
    expect(call.options.from).toEqual(new Date(from));
    expect(call.options.to).toEqual(new Date(to));
    expect(call.options.windowMinutes).toBe(1_440);
    expect(call.options.compare).toBe(false);
    expect(call.options.bucketFunction).toBe("avg");
  }
}

/** H7 — the rows carry the fake buckets: value, min, average, max, samples; a gap is `null` cells. */
export async function theRowsCarryTheResponseBuckets(): Promise<void> {
  const h = harness();
  const rows = await h.svc.exportRows(USER, ASSET, { points: "kw,pf", compare: "true" }, NOW);
  const zone = "Asia/Kolkata";
  expect(rows[HEADER_ROWS - 1]).toEqual(["point", "unit", "period", "bucket_start", "value", "min", "average", "max", "samples"]);
  expect(rows.slice(HEADER_ROWS)).toEqual([
    ["kw", "kW", "current", isoInZone(T1, zone), 11, 10, 11, 12, 3],
    ["kw", "kW", "current", isoInZone(T2, zone), null, null, null, null, 0],
    ["kw", "kW", "previous", isoInZone(P1, zone), 19, 18, 19, 20, 4],
    ["pf", null, "current", isoInZone(T1, zone), 101, 100, 101, 102, 3],
    ["pf", null, "current", isoInZone(T2, zone), null, null, null, null, 0],
    ["pf", null, "previous", isoInZone(P1, zone), 109, 108, 109, 110, 4],
  ]);
}

/** H8 — the header block: the response's zone, the level the cap used, the range ends in that zone. */
export async function theHeaderBlockReadsTheResponseZone(): Promise<void> {
  const h = harness();
  const rows = await h.svc.exportRows(USER, ASSET, { points: "kw", windowMinutes: "1440" }, NOW);
  const range = resolveAggregateRange({ windowMinutes: 1_440 }, NOW);
  expect(rows.slice(0, 6)).toEqual([
    ["zone", "Asia/Kolkata"],
    ["level", "1m"],
    ["bucket", "1m"],
    ["from", isoInZone(range.from.toISOString(), "Asia/Kolkata")],
    ["to", isoInZone(range.to.toISOString(), "Asia/Kolkata")],
    [],
  ]);
}

/** The CSV and XLSX writers run over the same rows. */
export async function csvAndXlsxAreTheWritersOverTheRows(): Promise<void> {
  const h = harness();
  const csv = await h.svc.exportCsv(USER, ASSET, { points: "kw" });
  expect(csv.startsWith("zone,Asia/Kolkata\n")).toBe(true);
  expect(csv).toContain("\npoint,unit,period,bucket_start,value,min,average,max,samples\n");
  const xlsx = await h.svc.exportXlsx(USER, ASSET, { points: "kw" });
  expect(xlsx.subarray(0, 2).toString("latin1")).toBe("PK");
}
