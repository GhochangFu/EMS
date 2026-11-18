import { expect } from "vitest";

import { TREND_VECTORS, type TrendVector, type TrendVectorExpected } from "./trend-math.fixture";
import { mannKendall, normalCdf, theilSen, Z_90 } from "./trend-math";

/**
 * `E1.5a` / ADR 0138 (plan §4.3, R-f, T1.3) — Mann–Kendall and Theil–Sen.
 * Assertions live here; `trend-math.test.ts` is the vitest entry point.
 */

/** The ids of every test vector, in the table's order. */
export const VECTOR_IDS: readonly string[] = TREND_VECTORS.map(([vector]) => vector.id);

function rowOf(id: string): readonly [TrendVector, TrendVectorExpected] {
  const row = TREND_VECTORS.find(([vector]) => vector.id === id);
  if (row === undefined) throw new Error(`no vector ${id}`);
  return row;
}

/** `S` exactly, `Var(S)` and `Z` to 4 decimals, `p` to 6 decimals (`< 1e-6` where shown). */
export function mannKendallGivesTheRow(id: string): void {
  const [vector, expected] = rowOf(id);
  const result = mannKendall(vector.ys);
  expect(result.n).toBe(expected.n);
  expect(result.s).toBe(expected.s);
  expect(result.varS).toBeCloseTo(expected.varS, 4);
  expect(result.z).toBeCloseTo(expected.z, 4);
  if (expected.p === "tiny") expect(result.p).toBeLessThan(1e-6);
  else expect(result.p).toBeCloseTo(expected.p, 6);
}

/** The median slope and Sen's 90 % interval, each to 9 decimals. */
export function theilSenGivesTheRow(id: string): void {
  const [vector, expected] = rowOf(id);
  const result = theilSen(vector.xs, vector.ys);
  const n = vector.ys.length;
  expect(result.pairs).toBe((n * (n - 1)) / 2);
  expect(result.slope).toBeCloseTo(expected.slope, 9);
  expect(result.low).toBeCloseTo(expected.low, 9);
  expect(result.high).toBeCloseTo(expected.high, 9);
}

/** `Z_90` is the 0.95 normal quantile. */
export function z90IsTheNinetyFivePercentQuantile(): void {
  expect(Z_90).toBe(1.6448536269514722);
  expect(normalCdf(Z_90)).toBeCloseTo(0.95, 6);
}

/** `Φ(0) = 0.5`, `Φ(1.959964) ≈ 0.975`, and `Φ(−x) = 1 − Φ(x)`. */
export function normalCdfHasItsKnownValues(): void {
  expect(normalCdf(0)).toBeCloseTo(0.5, 7); // the approximation is good to 7.5e-8
  expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
  expect(normalCdf(-1.959964)).toBeCloseTo(0.025, 6);
  for (const x of [0.3, 1, 1.711504, 2.952674, 4]) {
    expect(normalCdf(-x) + normalCdf(x)).toBeCloseTo(1, 12);
  }
}

/** One value, or values all equal, give `z 0` and `p 1`. */
export function oneValueOrAllEqualGivesNoTrend(): void {
  for (const ys of [[0.8], Array.from({ length: 24 }, () => 0.8)]) {
    const result = mannKendall(ys);
    expect(result.s).toBe(0);
    expect(result.z).toBe(0);
    expect(result.p).toBe(1);
  }
  const flat = theilSen(
    Array.from({ length: 24 }, (_, i) => i),
    Array.from({ length: 24 }, () => 0.8),
  );
  expect([flat.slope, flat.low, flat.high]).toEqual([0, 0, 0]);
}
