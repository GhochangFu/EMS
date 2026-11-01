import type { TrendPointSegmentDto } from "@bms/shared";
import { expect } from "vitest";

import {
  type StripAsset,
  type StripPlan,
  type StripRegistration,
  assertSeriesRowCount,
  fitSeries,
  floorToSeconds,
  groupSeries,
  pairsFor,
  planPairs,
  seriesCount,
  stripWindow,
} from "./trend-strip.pure";

/**
 * `F4.301` U2 (ADR 0108 Amendment 2, items 1, 2, 5 and 6) — the strip's pure
 * arithmetic: the aligned window, the asset × trend-point join, the
 * deterministic trim and the row-count bound. One claim per exported function;
 * the `.test.ts` wrapper owns the `it()`s (ADR 0014, AGENTS.md §4.6). Fixtures
 * name segments by design: the ADR 0108 §5.4 guard scans runtime modules only.
 */

/** A `now` that is on no bucket boundary of any range: 2026-10-15T10:47:13.250Z. */
const NOW = new Date("2026-10-15T10:47:13.250Z");

function fail(message: string): never {
  throw new Error(message);
}

function segment(domain: string, codes: readonly string[]): TrendPointSegmentDto {
  return {
    domain,
    label: `${domain} label`,
    source: "catalog",
    points: codes.map((code) => ({ code, name: `${code} name`, unit: `${code}-u`, active: true })),
    catalogDefaults: [],
    updatedAt: null,
    updatedBy: null,
  };
}

function asset(code: string, domain: string): StripAsset {
  return { id: `id-${code}`, code, name: `${code} name`, domain };
}

function reg(assetCode: string, pointKey: string, unit: string | null = `${pointKey}-u`): StripRegistration {
  return { assetId: `id-${assetCode}`, pointKey, unit };
}

/** A hand-built plan: `segments` × `points` × `assets` series, each point with no asset beyond its list. */
function plan(segments: number, points: number, assets: number): StripPlan {
  return {
    assetsPerPoint: 6,
    pointsPerSegment: points,
    trimmed: false,
    segments: Array.from({ length: segments }, (_, s) => ({
      domain: `seg-${s}`,
      label: `Segment ${s}`,
      source: "catalog" as const,
      points: Array.from({ length: points }, (_, p) => ({
        code: `p${p}`,
        name: `Point ${p}`,
        unit: null,
        moreAssets: 0,
        assets: Array.from({ length: assets }, (_, a) => ({
          assetId: `a-${s}-${p}-${a}`,
          assetCode: `A${String(a).padStart(2, "0")}`,
          assetName: `Asset ${a}`,
          unit: null,
        })),
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// stripWindow / floorToSeconds
// ---------------------------------------------------------------------------

export function assertTheDayWindowIsAlignedToHalfHours(): void {
  const w = stripWindow("24h", NOW);
  expect(w.to.toISOString()).toBe(floorToSeconds(NOW, 1800).toISOString());
  expect(w.to.toISOString()).toBe("2026-10-15T10:30:00.000Z");
  expect(w.to.getTime() - w.from.getTime()).toBe(86_400_000);
}

export function assertTheDayWindowReadsFiveMinuteRows(): void {
  const w = stripWindow("24h", NOW);
  expect({ level: w.level, bucketSeconds: w.bucketSeconds, buckets: w.buckets }).toEqual({
    level: "5m",
    bucketSeconds: 1800,
    buckets: 48,
  });
}

export function assertTheWeekWindowReadsHourRowsInThreeHourFolds(): void {
  const w = stripWindow("7d", NOW);
  expect({ level: w.level, bucketSeconds: w.bucketSeconds, buckets: w.buckets }).toEqual({
    level: "1h",
    bucketSeconds: 10800,
    buckets: 56,
  });
}

export function assertTheMonthWindowReadsHourRowsInHalfDayFolds(): void {
  const w = stripWindow("30d", NOW);
  expect({ level: w.level, bucketSeconds: w.bucketSeconds, buckets: w.buckets }).toEqual({
    level: "1h",
    bucketSeconds: 43200,
    buckets: 60,
  });
}

export function assertEveryWindowEdgeIsABucketMultiple(): void {
  for (const range of ["24h", "7d", "30d"] as const) {
    const w = stripWindow(range, NOW);
    const step = w.bucketSeconds * 1000;
    expect(w.from.getTime() % step, `${range} from`).toBe(0);
    expect(w.to.getTime() % step, `${range} to`).toBe(0);
    expect(w.to.getTime(), `${range} to is not after now`).toBeLessThanOrEqual(NOW.getTime());
  }
}

// ---------------------------------------------------------------------------
// pairsFor
// ---------------------------------------------------------------------------

export function assertAPairNeedsTheDomainListAndARegistration(): void {
  const result = pairsFor(
    [asset("X1", "x")],
    [segment("x", ["kw", "pf"])],
    [reg("X1", "kw"), reg("X1", "volts")],
    { overview: false },
  );
  expect(planPairs(result)).toEqual([{ assetId: "id-X1", pointKey: "kw" }]);
}

export function assertACodeRegisteredOnAnotherDomainYieldsNothing(): void {
  const result = pairsFor(
    [asset("X1", "x"), asset("Y1", "y")],
    [segment("x", ["kw"]), segment("y", ["temp"])],
    [reg("Y1", "kw")],
    { overview: false },
  );
  expect(planPairs(result)).toEqual([]);
}

export function assertTheOverviewKeepsThreePointsPerSegment(): void {
  const codes = ["c1", "c2", "c3", "c4", "c5"];
  const result = pairsFor(
    [asset("X1", "x")],
    [segment("x", codes)],
    codes.map((code) => reg("X1", code)),
    { overview: true },
  );
  expect(result.segments[0]?.points.map((p) => p.code)).toEqual(["c1", "c2", "c3"]);
  expect(result.pointsPerSegment).toBe(3);
}

export function assertAGroupTabKeepsTheFullList(): void {
  const codes = ["c1", "c2", "c3", "c4", "c5"];
  const result = pairsFor(
    [asset("X1", "x")],
    [segment("x", codes)],
    codes.map((code) => reg("X1", code)),
    { overview: false },
  );
  expect(result.segments[0]?.points.map((p) => p.code)).toEqual(codes);
}

export function assertTheSeventhAssetIsCountedNotPaired(): void {
  // Given out of code order, so the cap must sort by code before it cuts.
  const codes = ["A7", "A3", "A1", "A6", "A2", "A5", "A4"];
  const result = pairsFor(
    codes.map((code) => asset(code, "x")),
    [segment("x", ["kw"])],
    codes.map((code) => reg(code, "kw")),
    { overview: false },
  );
  const point = result.segments[0]?.points[0] ?? fail("no point");
  expect(point.assets.map((a) => a.assetCode)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);
  expect(point.moreAssets).toBe(1);
  expect(planPairs(result).some((p) => p.assetId === "id-A7")).toBe(false);
}

export function assertASegmentWithNoPairIsAbsent(): void {
  const result = pairsFor(
    [asset("X1", "x")],
    [segment("x", ["kw"]), segment("y", ["temp"])],
    [reg("X1", "kw")],
    { overview: false },
  );
  expect(result.segments.map((s) => s.domain)).toEqual(["x"]);
}

export function assertTheInputSegmentOrderIsKept(): void {
  // `forSite` order (sort_order, then code) — deliberately not alphabetical.
  const result = pairsFor(
    [asset("Z1", "zeta"), asset("A1", "alpha"), asset("M1", "mu")],
    [segment("zeta", ["kw"]), segment("alpha", ["kw"]), segment("mu", ["kw"])],
    [reg("A1", "kw"), reg("M1", "kw"), reg("Z1", "kw")],
    { overview: false },
  );
  expect(result.segments.map((s) => s.domain)).toEqual(["zeta", "alpha", "mu"]);
}

export function assertTheSeriesCarriesTheRegistrationUnit(): void {
  const result = pairsFor([asset("X1", "x")], [segment("x", ["kw"])], [reg("X1", "kw", "MW")], { overview: false });
  const point = result.segments[0]?.points[0] ?? fail("no point");
  expect(point.unit).toBe("kw-u");
  expect(point.assets[0]?.unit).toBe("MW");
}

// ---------------------------------------------------------------------------
// fitSeries
// ---------------------------------------------------------------------------

export function assertAnOverBoundPlanLowersAssetsPerPoint(): void {
  const fitted = fitSeries(plan(3, 12, 6), 180);
  expect(seriesCount(plan(3, 12, 6))).toBe(216);
  expect({ assetsPerPoint: fitted.assetsPerPoint, trimmed: fitted.trimmed, series: seriesCount(fitted) }).toEqual({
    assetsPerPoint: 5,
    trimmed: true,
    series: 180,
  });
  expect(fitted.segments[0]?.points[0]?.moreAssets).toBe(1);
}

export function assertAPlanWithinTheBoundIsUnchanged(): void {
  const input = plan(8, 3, 6);
  const fitted = fitSeries(input, 180);
  expect(seriesCount(input)).toBe(144);
  expect(fitted).toEqual(input);
  expect(fitted.trimmed).toBe(false);
}

export function assertAnAbsurdPlanStillFitsWithEverySegment(): void {
  const fitted = fitSeries(plan(200, 3, 1), 180);
  expect(seriesCount(fitted)).toBeLessThanOrEqual(180);
  expect(fitted.segments).toHaveLength(200);
  expect(fitted.trimmed).toBe(true);
  // The trim drops points from the last segments: the first ones keep theirs.
  expect(fitted.segments[0]?.points).toHaveLength(1);
  expect(fitted.segments[199]?.points).toEqual([]);
}

// ---------------------------------------------------------------------------
// assertSeriesRowCount / groupSeries
// ---------------------------------------------------------------------------

export function assertARowPastTheBoundThrows(): void {
  expect(() => assertSeriesRowCount(5, 4)).toThrow(/bucket width/);
}

export function assertARowCountAtTheBoundPasses(): void {
  expect(() => assertSeriesRowCount(4, 4)).not.toThrow();
}

export function assertGroupSeriesGapFillsEveryPair(): void {
  const w = stripWindow("24h", NOW);
  const p = pairsFor(
    [asset("X1", "x"), asset("X2", "x")],
    [segment("x", ["kw"])],
    [reg("X1", "kw"), reg("X2", "kw")],
    { overview: false },
  );
  const at = new Date(w.from.getTime() + 3 * 1_800_000).toISOString();
  const segments = groupSeries(p, [{ assetId: "id-X1", pointKey: "kw", t: at, v: 2.5 }], w);
  const assets = segments[0]?.points[0]?.assets ?? fail("no assets");
  expect(assets.map((a) => a.buckets.length)).toEqual([48, 48]);
  expect(assets[0]?.buckets[0]?.t).toBe(w.from.toISOString());
  expect(assets[0]?.buckets[3]?.v).toBe(2.5);
  expect(assets[1]?.buckets.every((b) => b.v === null)).toBe(true);
}
