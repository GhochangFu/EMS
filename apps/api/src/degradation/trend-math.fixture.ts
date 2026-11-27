/**
 * `E1.5a` / ADR 0138 (plan §4.3, T1.3) — the math test vectors V1–V11 and the
 * figures each must give. `x` is `0..n−1` unless the vector gives it. The
 * expected rows are the plan's second table of §4.3, worked by hand and
 * against `scipy`'s Mann–Kendall and Theil–Sen.
 */

/** One test series. */
export interface TrendVector {
  readonly id: string;
  readonly xs: readonly number[];
  readonly ys: readonly number[];
}

/** The figures a vector must give. `p: "tiny"` means `p < 1e-6`. */
export interface TrendVectorExpected {
  readonly n: number;
  readonly s: number;
  readonly varS: number;
  readonly z: number;
  readonly p: number | "tiny";
  readonly slope: number;
  readonly low: number;
  readonly high: number;
}

const indexes = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
const vector = (id: string, ys: readonly number[], xs: readonly number[] = indexes(ys.length)): TrendVector => ({
  id,
  xs,
  ys,
});

/** A straight fall of 0.005 a day from 0.9, rounded to 3 decimals. */
export const V1 = vector(
  "V1",
  indexes(28).map((i) => Number((0.9 - 0.005 * i).toFixed(3))),
);

/** A noisy fall with seven days missing. */
export const V2 = vector(
  "V2",
  [0.93, 0.95, 0.91, 0.92, 0.9, 0.94, 0.89, 0.9, 0.87, 0.88, 0.86, 0.89, 0.84, 0.85, 0.83, 0.84, 0.8, 0.82, 0.79, 0.8, 0.77],
  [0, 1, 2, 4, 5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 20, 21, 23, 24, 26, 27],
);

/** Ties and the continuity correction. */
export const V3 = vector("V3", [5, 5, 4, 4, 4, 3, 5, 2, 2, 1, 3, 1]);

/** No trend: `1, 2` alternating. */
export const V4 = vector(
  "V4",
  indexes(22).map((i) => (i % 2 === 0 ? 1 : 2)),
);

/** One bad day changes nothing. */
export const V5 = vector(
  "V5",
  indexes(24).map((i) => (i === 11 ? 0.2 : 0.8)),
);

/** The test passes and the interval still holds 0. */
export const V6 = vector("V6", [...Array.from({ length: 18 }, () => 1), 0.99, 0.98, 0.97, 0.96, 0.95, 0.94]);

/** A rise with gaps and an odd number of pair slopes. */
export const V7 = vector(
  "V7",
  [4.1, 4.3, 4.0, 4.4, 4.6, 4.5, 4.9, 4.7, 5.0, 5.2, 5.1, 5.5, 5.4, 5.8, 5.6, 6.0, 6.1, 6.4, 6.2, 6.6, 6.9, 6.8],
  [0, 1, 2, 3, 5, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18, 20, 21, 22, 24, 26, 27],
);

/** The test passes and the interval still holds 0, with many ties. */
export const V9 = vector(
  "V9",
  [90, 91, 91, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 90, 89, 89, 89, 88, 88, 87, 87],
);

/** An even number of pair slopes whose two middle values differ. */
export const V10 = vector("V10", [0, 1, 3, 4]);

/** `p` between 0.05 and 0.10 with an interval that excludes 0. */
export const V11 = vector(
  "V11",
  [
    76.9, 77.9, 78.7, 83.9, 82.8, 83, 80.8, 76, 79, 74.8, 80.5, 83.1, 78.9, 76.7, 74.3, 79.1, 73.6, 76.5, 73.4, 80.7, 74,
    80.9, 79.6, 73.1,
  ],
);

/** Each vector with its expected row (plan §4.3, second table). */
export const TREND_VECTORS: readonly (readonly [TrendVector, TrendVectorExpected])[] = [
  [V1, { n: 28, s: -378, varS: 2562, z: -7.448208, p: "tiny", slope: -0.005, low: -0.005, high: -0.005 }],
  [
    V2,
    {
      n: 21,
      s: -176,
      varS: 1092.6667,
      z: -5.294125,
      p: "tiny",
      slope: -0.0058823529,
      low: -0.0065217391,
      high: -0.005,
    },
  ],
  [V3, { n: 12, s: -43, varS: 202.3333, z: -2.952674, p: 0.00315, slope: -0.375, low: -0.5, high: -0.2222222222 }],
  [V4, { n: 22, s: 11, varS: 927.6667, z: 0.328325, p: 0.742666, slope: 0, low: 0, high: 0 }],
  [V5, { n: 24, s: 1, varS: 191.6667, z: 0, p: 1, slope: 0, low: 0, high: 0 }],
  [V6, { n: 24, s: -123, varS: 928.3333, z: -4.004127, p: 0.000062, slope: 0, low: -0.0011111111, high: 0 }],
  [V7, { n: 22, s: 213, varS: 1257.6667, z: 5.977961, p: "tiny", slope: 0.105, low: 0.1, high: 0.1111111111 }],
  [
    V9,
    {
      n: 24,
      s: -161,
      varS: 1210.3333,
      z: -4.599043,
      p: 0.000004,
      slope: -0.0909090909,
      low: -0.1304347826,
      high: 0,
    },
  ],
  [V10, { n: 4, s: 6, varS: 8.6667, z: 1.698416, p: 0.089429, slope: 1.4166666667, low: 1, high: 2 }],
  [
    V11,
    {
      n: 24,
      s: -70,
      varS: 1625.3333,
      z: -1.711504,
      p: 0.086988,
      slope: -0.1873015873,
      low: -0.3833333333,
      high: -0.0153846154,
    },
  ],
];
