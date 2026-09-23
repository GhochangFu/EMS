import type { CalcWindowFnName } from "@bms/shared";

import type { AggregateLevel } from "../telemetry/point-aggregates";
import { bucketTimeMs } from "./calc-schedule";

/**
 * The pure half of a window read (ADR 0070 decision 5; `E4.1b` plan design
 * decisions 3, 5 and 6). Nothing here touches a clock, a database or a zone:
 * `CalcWindowsService` reads the four watermarks and the calendar bounds,
 * hands them to `planWindowSegments`, runs one statement per level the plan
 * names, and hands the rows back to `combineSegments`. This split is what
 * lets the composition rule — the row's hardest logic — be exhausted by a
 * pure spec and a seeded tiling property before a single row is read.
 *
 * **Why compose at all, when every view is `materialized_only = false`.**
 * Measured 2026-09-19 on the compose stack (plan §4): the live branch serves
 * the tail beyond a view's watermark correctly — a `this_month` read from
 * `1d` alone does NOT drop the last two days, contrary to the ADR's sentence
 * (amended at closure). Two reasons survive. **Alignment**: `time_bucket`
 * without a zone (`0027`) makes every bucket UTC-aligned, so an IST day
 * (18:30Z) or a SAST day (22:00Z) is never a whole number of `1h` or `1d`
 * buckets, and a read that ignored that would silently include an hour on
 * either side. **Cost**: a month for one pair from `1m` is 1.1 s, from `5m`
 * 121 ms, from `1h` 8–31 ms, and the live branch above a watermark is an
 * on-the-fly aggregation of raw rows. So the plan takes the coarsest level
 * that is aligned to the interval AND behind its watermark, and fills the
 * head and the tail with finer levels; `1m` always finishes, and its own
 * ≤ 2-minute live tail costs 0.7 ms per hour of raw.
 *
 * **Minute alignment is a precondition, not a check.** `windowEndMs` floors
 * the tick's bucketed timestamp to the minute and every calendar start is a
 * midnight in some zone (all of which are minute-aligned), so `1m` divides
 * both ends of every window and no aggregate window ever range-scans
 * `telemetry.point_values`; only `delta` touches it, with two `LIMIT 1`
 * probes (`tests/adr-0070` part (e) scans for that).
 */

/** Coarse to fine — the order the planner walks. `AggregateLevel` is the
 * ADR 0023 vocabulary; this tuple is that set in the planner's order. */
export const WINDOW_LEVELS: readonly AggregateLevel[] = ["1d", "1h", "5m", "1m"];

/** Bucket width per level, in milliseconds. */
export const LEVEL_MS: Readonly<Record<AggregateLevel, number>> = {
  "1d": 86_400_000,
  "1h": 3_600_000,
  "5m": 300_000,
  "1m": 60_000,
};

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/**
 * The most buckets one window read may fold (PR 2 security review M1, ruled
 * 2026-09-19: fail closed). With healthy watermarks a `366d` read is ~366
 * `1d` buckets plus a small tail; when the `1d` and `1h` policies stall (an
 * orphaned `refresh_ranges` row has blocked every later refresh on this repo
 * before) the same read falls through to `5m` (~105k buckets per pair) or
 * `1m` (~527k), every tick, for every window formula — the statement count
 * stays at seven, the row volume does not. Above this budget the read is
 * refused as `windows_unresolved` and the host warns naming the watermarks,
 * so a stalled policy stops the window formulas and never the database.
 * 20,000 admits a 366d read from `1h` (8,784) and a 60d read from `5m`
 * (17,280); it refuses a 366d read from `5m`.
 */
export const MAX_WINDOW_BUCKETS = 20_000;

/**
 * The least covered fraction of its elapsed window a window `sum` answers at
 * (ADR 0070 Amendment 3 decision 4, `E4.4`). Below it the read refuses as
 * `window_sparse`: `sum` is `avg × elapsed hours`, and a mean over the samples
 * that arrived, multiplied by every hour, extrapolates across a gap. One
 * fraction for every window kind — about 2.4 hours of a day, three days of a
 * month, 36 days of a year. `combineSegments` writes the comparison so that
 * the answering branch is `fraction >= MIN_WINDOW_COVERAGE`, the comparison
 * that is false for `NaN`: a fraction that is not a number refuses.
 */
export const MIN_WINDOW_COVERAGE = 0.9;

/**
 * The second half of the same ruling. A blocked refresh stalls ALL four
 * policies at once, and then the bucket count above never bites: the `1d`
 * view still serves the whole past and only the stalled part falls to `1m`
 * — whose rows beyond its OWN watermark are the live branch, an on-the-fly
 * aggregation of raw samples. A week of that is 10,080 "buckets" of raw
 * work per pair per tick. So the part of a window beyond the `1m` watermark
 * is bounded on its own: 180 minutes, the `1m` policy's `start_offset`
 * (`0027`), which a healthy stack never exceeds and a blocked refresh
 * exceeds within hours — refusing every aggregate window read and naming
 * the watermark, which is what surfaces the stall.
 */
export const MAX_LIVE_MINUTES = 180;

/** How many buckets a plan folds — the cost `MAX_WINDOW_BUCKETS` bounds. */
export function bucketCount(segments: readonly Segment[]): number {
  let total = 0;
  for (const segment of segments) {
    total += (segment.toMs - segment.fromMs) / LEVEL_MS[segment.level];
  }
  return total;
}

/**
 * Why a plan must not run, or `null`. Checked by the service before any
 * level statement; the text names the budget it crossed and every watermark,
 * for the host's once-per-sweep warn.
 */
export function budgetDefect(segments: readonly Segment[], watermarks: Watermarks): string | null {
  const marks = WINDOW_LEVELS.map((level) => `${level} ${new Date(watermarks[level]).toISOString()}`).join(", ");
  const buckets = bucketCount(segments);
  if (buckets > MAX_WINDOW_BUCKETS) {
    return `a window read would fold ${Math.round(buckets)} buckets over the ${MAX_WINDOW_BUCKETS} budget — a refresh policy is behind (watermarks: ${marks})`;
  }
  const liveMinutes = segments.reduce((sum, s) => (s.level === "1m" ? sum + Math.max(0, s.toMs - Math.max(s.fromMs, watermarks["1m"])) / MINUTE_MS : sum), 0);
  if (liveMinutes > MAX_LIVE_MINUTES) {
    return `a window read would aggregate ${Math.round(liveMinutes)} minutes of raw rows beyond the 1m watermark, over the ${MAX_LIVE_MINUTES} budget — the refresh policies are stalled (watermarks: ${marks})`;
  }
  return null;
}

/** Each level's `cagg_watermark`, as epoch milliseconds — the instant up to
 * which the view is materialized. Read live once per sweep, never assumed
 * from `0027`'s offsets (a manual refresh moves them). */
export type Watermarks = Readonly<Record<AggregateLevel, number>>;

/** One half-open interval `[fromMs, toMs)` read from one level's view. */
export interface Segment {
  readonly level: AggregateLevel;
  readonly fromMs: number;
  readonly toMs: number;
}

/**
 * Where a window ends: the tick's bucketed timestamp (ADR 0037 decision 8 —
 * the instant the written value carries), floored to the minute. For every
 * stock interval (a multiple of 60 s) the floor is a no-op; for a 10 s or
 * 30 s interval it is what makes `1m` divide the window (plan ruling Q9).
 */
export function windowEndMs(nowMs: number, intervalSeconds: number): number {
  return Math.floor(bucketTimeMs(nowMs, intervalSeconds) / MINUTE_MS) * MINUTE_MS;
}

/** A rolling window's start: `minutes` before its end. */
export function rollingStartMs(endMs: number, minutes: number): number {
  return endMs - minutes * MINUTE_MS;
}

/** The elapsed hours a window covers — `hours(window)`'s value, and the
 * multiplier that turns a mean into a time integral (plan ruling Q5). */
export function hoursOf(startMs: number, endMs: number): number {
  return (endMs - startMs) / HOUR_MS;
}

const ceilTo = (ms: number, width: number): number => Math.ceil(ms / width) * width;
const floorTo = (ms: number, width: number): number => Math.floor(ms / width) * width;

/**
 * Tiles `[startMs, endMs)` with segments, one level each, in time order.
 *
 * At each level from `1d` down, the maximal sub-interval of every still
 * uncovered piece that is aligned to the level's bucket and ends at or before
 * the level's watermark becomes a segment; what it leaves at either side goes
 * to the next finer level. `1m` takes everything left without consulting its
 * watermark — its live branch covers the ≤ 2 minutes beyond it — which is
 * what guarantees the tiling is exact whenever both ends are minute-aligned.
 * Every width divides the coarser one, so segments never overlap. The result
 * is `[]` exactly when `startMs >= endMs`.
 */
export function planWindowSegments(args: { startMs: number; endMs: number; watermarks: Watermarks }): Segment[] {
  const segments: Segment[] = [];
  const place = (fromMs: number, toMs: number, levelIndex: number): void => {
    if (toMs <= fromMs) {
      return;
    }
    const level = WINDOW_LEVELS[levelIndex];
    const width = LEVEL_MS[level];
    const finest = levelIndex === WINDOW_LEVELS.length - 1;
    const lo = ceilTo(fromMs, width);
    const hi = finest ? floorTo(toMs, width) : floorTo(Math.min(toMs, args.watermarks[level]), width);
    if (hi <= lo) {
      if (!finest) {
        place(fromMs, toMs, levelIndex + 1);
      }
      return;
    }
    if (!finest) {
      place(fromMs, lo, levelIndex + 1);
    }
    segments.push({ level, fromMs: lo, toMs: hi });
    if (!finest) {
      place(hi, toMs, levelIndex + 1);
    }
  };
  place(args.startMs, args.endMs, 0);
  return segments.sort((a, b) => a.fromMs - b.fromMs);
}

/** The three coverage facts one level's statement returns per segment (ADR
 * 0070 Amendment 3 decision 3): how many distinct coverage units — clock days
 * on `1d`, clock hours on the other three levels — hold a bucket with
 * `sample_count > 0`, and whether the unit holding the segment's first
 * instant and the one holding its last instant are among them. */
export interface SegmentCoverageFacts {
  readonly coveredUnits: number;
  readonly headCovered: boolean;
  readonly tailCovered: boolean;
}

/**
 * The covered hours of one segment (ADR 0070 Amendment 3 decision 3, `E4.4`).
 * Three rules: a `1d` segment contributes 24 h for each day holding a
 * non-empty bucket; a `1h` segment 1 h for each such hour; a `5m` or `1m`
 * segment each distinct clock hour holding such a bucket, **clipped to the
 * segment** — the one-hour floor, because a measured point declares no
 * polling interval and a five-minute poller fills one `1m` bucket in five. A
 * covered unit that straddles the segment's start (or end) counts only the
 * part inside it. `1d` and `1h` segments are aligned to their unit by the
 * planner, so both clips are zero there and only `coveredUnits` matters. A
 * segment inside one unit counts its own length when covered, else nothing.
 *
 * **The limit, stated.** Completed days behind the `1d` watermark are served
 * from `1d` buckets, so on those days the resolution is a day: a day with one
 * sample counts as covered. A ten-day outage is caught; a twelve-hour gap
 * inside an old day is not.
 */
export function coveredHoursOf(segment: Segment, facts: SegmentCoverageFacts): number {
  const unitMs = segment.level === "1d" ? LEVEL_MS["1d"] : HOUR_MS;
  const headUnit = floorTo(segment.fromMs, unitMs);
  const tailUnit = floorTo(segment.toMs - 1, unitMs);
  if (headUnit === tailUnit) {
    return facts.coveredUnits > 0 ? (segment.toMs - segment.fromMs) / HOUR_MS : 0;
  }
  const headClip = facts.headCovered ? (segment.fromMs - headUnit) / HOUR_MS : 0;
  const tailClip = facts.tailCovered ? (tailUnit + unitMs - segment.toMs) / HOUR_MS : 0;
  return (facts.coveredUnits * unitMs) / HOUR_MS - headClip - tailClip;
}

/** What one level's statement returns per segment: the four aggregate
 * columns folded over the segment's buckets, and the segment's covered hours
 * (`coveredHoursOf`). Every value is `null`, the count `0` and the covered
 * hours `0` when no bucket exists in the range. */
export interface SegmentRow {
  readonly sumValue: number | null;
  readonly sampleCount: number;
  readonly minValue: number | null;
  readonly maxValue: number | null;
  readonly coveredHours: number;
}

export type WindowValue = { ok: true; value: number } | { ok: false; reason: "window_empty" | "window_sparse" };

/**
 * Folds the per-segment rows into the window's value (plan design decision
 * 6). `avg` is `Σ sum_value / Σ sample_count` — the only correct mean over
 * unequal buckets (`point-aggregates.ts` reason 1). **`sum` is `avg ×
 * elapsedHours`, the time integral** (ADR 0070 decision 5, ruled at Q6): a kW
 * point gives kWh over the window. `Σ sum_value` — a sum of raw samples that
 * scales with the polling rate — is never returned.
 *
 * **A `sum` refuses `window_sparse` below `MIN_WINDOW_COVERAGE`** (ADR 0070
 * Amendment 3, `E4.4`): the rows' `coveredHours` over `elapsedHours` must be
 * at least the threshold, because the mean covers only the samples that
 * arrived while the multiplier is every elapsed hour. The answering branch is
 * the `>=` comparison, so a `NaN` fraction refuses. `Σ sample_count === 0` is
 * `window_empty` and is decided first — a window with no sample is empty, not
 * sparse. `avg`, `min` and `max` do not extrapolate and ignore coverage.
 */
export function combineSegments(
  fn: Exclude<CalcWindowFnName, "delta">,
  rows: readonly SegmentRow[],
  elapsedHours: number,
): WindowValue {
  let sum = 0;
  let count = 0;
  let covered = 0;
  let min: number | null = null;
  let max: number | null = null;
  for (const row of rows) {
    covered += row.coveredHours;
    if (row.sampleCount > 0 && row.sumValue !== null) {
      sum += row.sumValue;
      count += row.sampleCount;
    }
    if (row.minValue !== null) {
      min = min === null ? row.minValue : Math.min(min, row.minValue);
    }
    if (row.maxValue !== null) {
      max = max === null ? row.maxValue : Math.max(max, row.maxValue);
    }
  }
  if (count === 0 || min === null || max === null) {
    return { ok: false, reason: "window_empty" };
  }
  switch (fn) {
    case "avg":
      return { ok: true, value: sum / count };
    case "sum": {
      const fraction = covered / elapsedHours;
      if (fraction >= MIN_WINDOW_COVERAGE) {
        return { ok: true, value: (sum / count) * elapsedHours };
      }
      return { ok: false, reason: "window_sparse" };
    }
    case "min":
      return { ok: true, value: min };
    case "max":
      return { ok: true, value: max };
  }
}

/** One raw sample, as the two `delta` probes return it. */
export interface Sample {
  readonly timeMs: number;
  readonly value: number;
}

/**
 * `delta` — the last sample minus the first inside the window (ADR 0070
 * decision 5). One sample or none is `window_empty`: the two probes return
 * the same row when only one exists, and a delta of one reading means
 * nothing. A negative delta (a counter reset) is returned as it is — that is
 * the author's rule to write, not this function's refusal.
 */
export function deltaOf(first: Sample | null, last: Sample | null): WindowValue {
  if (first === null || last === null || first.timeMs === last.timeMs) {
    return { ok: false, reason: "window_empty" };
  }
  return { ok: true, value: last.value - first.value };
}
