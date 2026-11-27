/**
 * `E1.5a` / ADR 0138 (plan §4.3, R-f) — Mann–Kendall and Theil–Sen. Pure and
 * import-free: numbers in, numbers out, no clock and no database.
 *
 * Mann–Kendall uses the tie correction and the continuity correction with the
 * normal approximation. Theil–Sen takes the median of every pair slope; the
 * interval is Sen's rank interval with `scipy`'s index rule.
 */

/** The 0.95 normal quantile, for a two-sided 90 % interval. */
export const Z_90 = 1.6448536269514722;

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** The standard normal distribution function, Abramowitz–Stegun 26.2.17 (|error| < 7.5e-8). */
export function normalCdf(x: number): number {
  const a = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * a);
  const density = Math.exp((-a * a) / 2) / SQRT_2PI;
  const upper =
    density * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - upper : upper;
}

/** The Mann–Kendall test of `ys` in time order. */
export function mannKendall(ys: readonly number[]): { n: number; s: number; varS: number; z: number; p: number } {
  const n = ys.length;
  let s = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) s += Math.sign(ys[j]! - ys[i]!);
  }
  const groups = new Map<number, number>();
  for (const y of ys) groups.set(y, (groups.get(y) ?? 0) + 1);
  let ties = 0;
  for (const t of groups.values()) ties += t * (t - 1) * (2 * t + 5);
  const varS = (n * (n - 1) * (2 * n + 5) - ties) / 18;
  const z = s === 0 || varS <= 0 ? 0 : (s - Math.sign(s)) / Math.sqrt(varS);
  const p = varS <= 0 ? 1 : 2 * (1 - normalCdf(Math.abs(z)));
  return { n, s, varS, z, p };
}

/** The variance of Mann–Kendall's `S` with the tie correction, from the values alone. */
function varianceOfS(ys: readonly number[]): number {
  return mannKendall(ys).varS;
}

/** The Theil–Sen slope of `ys` over `xs` and Sen's 90 % interval. */
export function theilSen(
  xs: readonly number[],
  ys: readonly number[],
): { pairs: number; slope: number; low: number; high: number } {
  const slopes: number[] = [];
  for (let i = 0; i < xs.length; i += 1) {
    for (let j = i + 1; j < xs.length; j += 1) slopes.push((ys[j]! - ys[i]!) / (xs[j]! - xs[i]!));
  }
  slopes.sort((a, b) => a - b);
  const pairs = slopes.length;
  if (pairs === 0) return { pairs, slope: 0, low: 0, high: 0 };
  const middle = Math.floor(pairs / 2);
  const slope = pairs % 2 === 1 ? slopes[middle]! : (slopes[middle - 1]! + slopes[middle]!) / 2;
  const c = Z_90 * Math.sqrt(Math.max(varianceOfS(ys), 0));
  const low = slopes[Math.max(Math.round((pairs - c) / 2) - 1, 0)]!;
  const high = slopes[Math.min(Math.round((pairs + c) / 2), pairs - 1)]!;
  return { pairs, slope, low, high };
}
