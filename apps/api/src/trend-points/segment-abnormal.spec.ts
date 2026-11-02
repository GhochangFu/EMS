import { expect } from "vitest";

import {
  ABNORMAL_BELOW_RATIO,
  ABNORMAL_LIST_MAX,
  ABNORMAL_NEAR_ZERO_FRACTION,
  ABNORMAL_RATIO,
  MIN_BASELINE_WINDOWS,
} from "@bms/shared";

import {
  type SegmentAbnormalCandidate,
  type SegmentWindowRow,
  orderAndTrimSegment,
  segmentAbnormalEntries,
  segmentVerdictFor,
} from "./segment-abnormal";

/**
 * `F4.302` U2 (ADR 0108 Amendment 4 item 5) — the segment view's two-sided
 * abnormal verdict, pure. Every expected value is a figure the amendment pins
 * (1.5 above, 0.5 below, a 1 % near-zero floor, three counting windows), never
 * one re-derived here. Vitest entry point: the sibling `.test.ts`.
 *
 * A spec may name a segment or a point: the ADR 0108 §5.4 guard scans runtime
 * modules only.
 */

const FULL = 10;

/** Three full baseline windows of one mean each, so the median is `mean`. */
function baseline(mean: number) {
  return [mean, mean, mean].map((value) => ({ mean: value, bucketCount: FULL }));
}

function current(mean: number) {
  return { mean, bucketCount: FULL };
}

/** `current / baseline = 1.5` exactly is `above`. */
export function assertRatioOfOnePointFiveIsAbove(): void {
  expect(ABNORMAL_RATIO).toBe(1.5);
  const verdict = segmentVerdictFor(current(30), baseline(20));
  expect(verdict.verdict).toBe("above");
  expect(verdict.ratio).toBe(1.5);
}

/** `1.49` is inside the band: `normal`. */
export function assertRatioOfOnePointFourNineIsNormal(): void {
  expect(segmentVerdictFor(current(29.8), baseline(20)).verdict).toBe("normal");
}

/** `current / baseline = 0.5` exactly is `below` (owner, 2026-11-02: −50 %). */
export function assertRatioOfOneHalfIsBelow(): void {
  expect(ABNORMAL_BELOW_RATIO).toBe(0.5);
  const verdict = segmentVerdictFor(current(10), baseline(20));
  expect(verdict.verdict).toBe("below");
  expect(verdict.ratio).toBe(0.5);
}

/** `0.51` is inside the band: `normal`. */
export function assertRatioOfPointFiveOneIsNormal(): void {
  expect(segmentVerdictFor(current(10.2), baseline(20)).verdict).toBe("normal");
}

/**
 * The floor's scale is the largest counting-window magnitude only (owner ruling
 * 2026-11-02, build review): counting windows `0.5, 0.9, 100` give a median of
 * 0.9, under 1 % of 100, so `not_comparable` with no ratio. Without the floor
 * the ratio is 111 and the verdict `above`, so the claim reddens when the
 * fraction is 0.
 */
export function assertANearZeroBaselineIsNotComparable(): void {
  expect(ABNORMAL_NEAR_ZERO_FRACTION).toBe(0.01);
  const windows = [0.5, 0.9, 100].map((mean) => ({ mean, bucketCount: FULL }));
  const verdict = segmentVerdictFor(current(100), windows);
  expect(verdict.verdict).toBe("not_comparable");
  expect(verdict.ratio).toBeNull();
  expect(verdict.baselineMean).toBe(0.9);
}

/**
 * The current mean is not in the floor's scale (owner ruling 2026-11-02): four
 * counting windows at 5 and a current mean of 600 is a ratio of 120, `above`.
 * With `|current|` in the scale the floor is 6 and the baseline of 5 under it,
 * so the claim reddens when the current mean is put back.
 */
export function assertALargeCurrentAgainstASteadyBaselineIsAbove(): void {
  const windows = [5, 5, 5, 5].map((mean) => ({ mean, bucketCount: FULL }));
  const verdict = segmentVerdictFor(current(600), windows);
  expect(verdict.verdict).toBe("above");
  expect(verdict.ratio).toBe(120);
}

/** `+5` against a baseline of `−5`: opposite signs never divide into a verdict. */
export function assertOppositeSignsAreNotComparable(): void {
  const verdict = segmentVerdictFor(current(5), baseline(-5));
  expect(verdict.verdict).toBe("not_comparable");
  expect(verdict.ratio).toBeNull();
}

/** Two negatives compare by magnitude: `−30 / −20 = 1.5` is `above`. */
export function assertTwoNegativesCompareByMagnitude(): void {
  const verdict = segmentVerdictFor(current(-30), baseline(-20));
  expect(verdict.verdict).toBe("above");
  expect(verdict.ratio).toBe(1.5);
}

/** A point that is zero throughout is `not_comparable`, never `normal` by a 0 / 0. */
export function assertAnAllZeroPointIsNotComparable(): void {
  const verdict = segmentVerdictFor(current(0), baseline(0));
  expect(verdict.verdict).toBe("not_comparable");
  expect(verdict.ratio).toBeNull();
}

/** Two counting windows are fewer than `MIN_BASELINE_WINDOWS`. */
export function assertTwoCountingWindowsAreNotEnoughHistory(): void {
  expect(MIN_BASELINE_WINDOWS).toBe(3);
  const verdict = segmentVerdictFor(current(100), baseline(10).slice(0, 2));
  expect(verdict.verdict).toBe("not_enough_history");
  expect(verdict.baselineMean).toBeNull();
  expect(verdict.ratio).toBeNull();
  expect(verdict.baselineWindows).toBe(2);
}

/** A window at exactly half the current bucket count counts (the shared `countingWindows`). */
export function assertAWindowAtHalfTheBucketsCounts(): void {
  const half = [20, 20, 20].map((mean) => ({ mean, bucketCount: FULL / 2 }));
  const verdict = segmentVerdictFor(current(30), half);
  expect(verdict.verdict).toBe("above");
  expect(verdict.baselineWindows).toBe(3);
}

function uuid(n: number): string {
  return `30000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

function row(assetId: string, idx: number, mean: number): SegmentWindowRow {
  return { assetId, idx, mean, max: mean, maxAt: null, sampleCount: FULL, bucketCount: FULL };
}

/** The compare period (`idx −1`) is never a baseline window: with it counted, the asset has three windows. */
export function assertTheCompareRowIsNotABaselineWindow(): void {
  const id = uuid(1);
  const [entry] = segmentAbnormalEntries(
    [{ assetId: id, assetCode: "A1", assetName: "A1", unit: "kW" }],
    [row(id, 0, 30), row(id, -1, 20), row(id, 1, 20), row(id, 2, 20)],
  );
  expect(entry?.verdict).toBe("not_enough_history");
  expect(entry?.baselineWindows).toBe(2);
}

/** An asset with no current (`idx 0`) row is not judged; one with a row is. */
export function assertOnlyAssetsWithACurrentRowAreJudged(): void {
  const [a, b] = [uuid(1), uuid(2)];
  const entries = segmentAbnormalEntries(
    [
      { assetId: a, assetCode: "A1", assetName: "A1", unit: "kW" },
      { assetId: b, assetCode: "B1", assetName: "B1", unit: "kW" },
    ],
    [row(a, 0, 30), row(a, 1, 20), row(a, 2, 20), row(a, 3, 20), row(b, 1, 20), row(b, 2, 20), row(b, 3, 20)],
  );
  expect(entries.map((e) => [e.assetId, e.verdict, e.currentMean])).toEqual([[a, "above", 30]]);
}

function candidate(over: Partial<SegmentAbnormalCandidate> & { assetCode: string }): SegmentAbnormalCandidate {
  return {
    assetId: uuid(Number.parseInt(over.assetCode.replace(/\D/g, "") || "0", 10)),
    assetName: over.assetCode,
    unit: "kW",
    currentMean: 1,
    baselineMean: 1,
    ratio: 1,
    verdict: "normal",
    baselineWindows: 3,
    ...over,
  };
}

/** Above by ratio descending, below by ratio ascending, then not comparable and not enough history by code. */
export function assertTheListOrder(): void {
  const list = orderAndTrimSegment(
    [
      candidate({ assetCode: "N9", verdict: "not_enough_history", ratio: null, baselineMean: null }),
      candidate({ assetCode: "B2", verdict: "below", ratio: 0.4 }),
      candidate({ assetCode: "A1", verdict: "above", ratio: 1.6 }),
      candidate({ assetCode: "C8", verdict: "not_comparable", ratio: null }),
      candidate({ assetCode: "B1", verdict: "below", ratio: 0.1 }),
      candidate({ assetCode: "N1", verdict: "not_enough_history", ratio: null, baselineMean: null }),
      candidate({ assetCode: "A2", verdict: "above", ratio: 3 }),
      candidate({ assetCode: "C1", verdict: "not_comparable", ratio: null }),
    ],
    ABNORMAL_LIST_MAX,
  );
  expect(list.entries.map((e) => e.assetCode)).toEqual(["A2", "A1", "B1", "B2", "C1", "C8", "N1", "N9"]);
}

/** `normal` is counted, never sent. */
export function assertNormalIsCountedNotSent(): void {
  const list = orderAndTrimSegment(
    [
      candidate({ assetCode: "A1", verdict: "above", ratio: 2 }),
      candidate({ assetCode: "M1" }),
      candidate({ assetCode: "M2" }),
    ],
    ABNORMAL_LIST_MAX,
  );
  expect(list.entries.map((e) => e.assetCode)).toEqual(["A1"]);
  expect(list.normalCount).toBe(2);
  expect(list.truncated).toBe(false);
}

/** 101 entries are cut to 100 with `truncated`; exactly 100 are not. */
export function assertTruncatedAtOneHundredAndOne(): void {
  const many = (count: number) =>
    Array.from({ length: count }, (_, i) => candidate({ assetCode: `X${i + 1}`, verdict: "above", ratio: 2 + i }));
  const cut = orderAndTrimSegment(many(ABNORMAL_LIST_MAX + 1), ABNORMAL_LIST_MAX);
  expect(cut.entries).toHaveLength(100);
  expect(cut.truncated).toBe(true);
  expect(cut.entries.map((e) => e.ratio)).not.toContain(2);

  const exact = orderAndTrimSegment(many(ABNORMAL_LIST_MAX), ABNORMAL_LIST_MAX);
  expect(exact.entries).toHaveLength(100);
  expect(exact.truncated).toBe(false);
}
