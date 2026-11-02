import {
  ABNORMAL_BELOW_RATIO,
  ABNORMAL_NEAR_ZERO_FRACTION,
  ABNORMAL_RATIO,
  MIN_BASELINE_WINDOWS,
  type SegmentAbnormalEntryDto,
  type SegmentAbnormalVerdict,
} from "@bms/shared";

import { countingWindows, medianOf } from "../reports/energy-abnormal";

/**
 * `F4.302` U2 (ADR 0108 Amendment 4 item 5) — the segment view's per-point
 * abnormal list, pure (no I/O). Statement A (`segmentWindowReads`) returns one
 * row per (window, asset): `idx 0` the current period, `idx −1` the compare
 * period, `idx 1..n` the baseline windows that `F4.299`'s `baselineWindows` and
 * `windowsWithinHorizon` built. This file turns those rows into verdicts and
 * the bounded list that is sent.
 *
 * **Two-sided, and never merged with the energy rule.** The energy list stays
 * one-sided on kWh (Amendment 1 item 7); this one judges a point's weighted
 * mean against the median of its means in the counting windows: `above` at
 * `ratio ≥ ABNORMAL_RATIO`, `below` at `ratio ≤ ABNORMAL_BELOW_RATIO`. Before
 * the ratio, a baseline within `ABNORMAL_NEAR_ZERO_FRACTION` of the largest
 * counting-window magnitude (the current mean is not in the scale — owner
 * ruling 2026-11-02), or of the opposite sign to the current mean, is
 * `not_comparable` — a relative floor, so no literal per unit, and a point that
 * is zero throughout never reads `normal` by a 0 / 0. Two negatives compare by
 * magnitude (`−30 / −20 = 1.5`).
 *
 * **Advisory only (ruling 4.7).** Nothing here raises an alarm, evaluates a
 * rule or sends a notification.
 */

/** One asset's figures in one window of statement A. */
export type SegmentWindowRow = {
  readonly assetId: string;
  /** `0` current, `−1` compare, `1..n` baseline. */
  readonly idx: number;
  /** The weighted mean (ADR 0023). */
  readonly mean: number;
  readonly max: number;
  readonly maxAt: string | null;
  readonly sampleCount: number;
  /** Distinct read-level buckets with data in the window. */
  readonly bucketCount: number;
};

/** A candidate asset: one readable asset of the segment registering the point. */
export type SegmentAsset = {
  readonly assetId: string;
  readonly assetCode: string;
  readonly assetName: string;
  /** The registration's effective unit. */
  readonly unit: string | null;
};

export type SegmentVerdict = SegmentAbnormalVerdict | "normal";

/** A judged asset: the sent entry's shape, with `normal` still in it (it is counted, never sent). */
export type SegmentAbnormalCandidate = Omit<SegmentAbnormalEntryDto, "verdict"> & { readonly verdict: SegmentVerdict };

export type SegmentAbnormalList = {
  readonly entries: SegmentAbnormalEntryDto[];
  readonly normalCount: number;
  readonly truncated: boolean;
};

type Stat = { readonly mean: number; readonly bucketCount: number };

/**
 * One asset's verdict over its baseline windows (`idx ≥ 1` only). The floor
 * check is written `!(|baseline| > floor)` so it fails closed: a `NaN` baseline
 * is `not_comparable`, never a ratio.
 */
export function segmentVerdictFor(
  current: Stat,
  windows: readonly Stat[],
): { verdict: SegmentVerdict; baselineMean: number | null; ratio: number | null; baselineWindows: number } {
  const counting = countingWindows(current, windows);
  if (counting.length < MIN_BASELINE_WINDOWS) {
    return { verdict: "not_enough_history", baselineMean: null, ratio: null, baselineWindows: counting.length };
  }
  const baseline = medianOf(counting.map((window) => window.mean)) as number;
  // The scale is the counting windows only (owner ruling 2026-11-02): a large
  // current mean must not push a steady baseline under its own floor.
  const scale = Math.max(...counting.map((window) => Math.abs(window.mean)));
  const notComparable = {
    verdict: "not_comparable" as const,
    baselineMean: baseline,
    ratio: null,
    baselineWindows: counting.length,
  };
  if (!(Math.abs(baseline) > ABNORMAL_NEAR_ZERO_FRACTION * scale)) {
    return notComparable;
  }
  if (current.mean !== 0 && Math.sign(current.mean) !== Math.sign(baseline)) {
    return notComparable;
  }
  const ratio = current.mean / baseline;
  const verdict: SegmentVerdict =
    ratio >= ABNORMAL_RATIO ? "above" : ratio <= ABNORMAL_BELOW_RATIO ? "below" : "normal";
  return { verdict, baselineMean: baseline, ratio, baselineWindows: counting.length };
}

/**
 * Statement A's rows → one candidate per asset with a current (`idx 0`) row; an
 * asset with none is not judged. Only `idx ≥ 1` rows are baseline windows: the
 * compare period (`idx −1`) is never one. A window with no row held no data for
 * that asset, so it does not count.
 */
export function segmentAbnormalEntries(
  assets: readonly SegmentAsset[],
  rows: readonly SegmentWindowRow[],
): SegmentAbnormalCandidate[] {
  const byAsset = new Map<string, { current: SegmentWindowRow | null; windows: SegmentWindowRow[] }>();
  for (const row of rows) {
    const entry = byAsset.get(row.assetId) ?? { current: null, windows: [] };
    if (row.idx === 0) entry.current = row;
    else if (row.idx >= 1) entry.windows.push(row);
    byAsset.set(row.assetId, entry);
  }
  const candidates: SegmentAbnormalCandidate[] = [];
  for (const asset of assets) {
    const entry = byAsset.get(asset.assetId);
    if (!entry || entry.current === null) continue;
    const verdict = segmentVerdictFor(entry.current, entry.windows);
    candidates.push({
      assetId: asset.assetId,
      assetCode: asset.assetCode,
      assetName: asset.assetName,
      unit: asset.unit,
      currentMean: entry.current.mean,
      baselineMean: verdict.baselineMean,
      ratio: verdict.ratio,
      verdict: verdict.verdict,
      baselineWindows: verdict.baselineWindows,
    });
  }
  return candidates;
}

function byCode(a: SegmentAbnormalCandidate, b: SegmentAbnormalCandidate): number {
  if (a.assetCode !== b.assetCode) return a.assetCode < b.assetCode ? -1 : 1;
  return a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0;
}

function ofVerdict(
  candidates: readonly SegmentAbnormalCandidate[],
  verdict: SegmentAbnormalVerdict,
  order: (a: SegmentAbnormalCandidate, b: SegmentAbnormalCandidate) => number,
): SegmentAbnormalEntryDto[] {
  return candidates
    .filter((candidate) => candidate.verdict === verdict)
    .sort(order)
    .map((candidate) => ({ ...candidate, verdict }));
}

/**
 * What is sent: `above` by ratio (highest first), `below` by ratio (lowest
 * first), then `not_comparable` and `not_enough_history` by code, cut to `max`
 * with `truncated`. `normal` assets are counted and never sent as rows.
 */
export function orderAndTrimSegment(candidates: readonly SegmentAbnormalCandidate[], max: number): SegmentAbnormalList {
  const all = [
    ...ofVerdict(candidates, "above", (a, b) => (b.ratio ?? 0) - (a.ratio ?? 0) || byCode(a, b)),
    ...ofVerdict(candidates, "below", (a, b) => (a.ratio ?? 0) - (b.ratio ?? 0) || byCode(a, b)),
    ...ofVerdict(candidates, "not_comparable", byCode),
    ...ofVerdict(candidates, "not_enough_history", byCode),
  ];
  const normalCount = candidates.filter((candidate) => candidate.verdict === "normal").length;
  return { entries: all.slice(0, max), normalCount, truncated: all.length > max };
}
