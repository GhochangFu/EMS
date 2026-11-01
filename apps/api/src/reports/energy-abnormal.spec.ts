import { expect } from "vitest";

import { ABNORMAL_LIST_MAX, ABNORMAL_RATIO, BASELINE_WINDOWS, MIN_BASELINE_WINDOWS } from "@bms/shared";

import {
  abnormalEntries,
  baselineWindows,
  medianOf,
  orderAndTrim,
  shiftByLocalDays,
  verdictFor,
  windowsWithinHorizon,
  type AbnormalCandidate,
  type EntityWindowRow,
} from "./energy-abnormal";
import { resolveEnergyRange, zoneForArithmetic } from "./energy-view-range";

/**
 * `F4.299` U2 (ADR 0108 Amendment 1, 7.7) — the abnormal list's arithmetic,
 * pure: the baseline windows (whole local days back, the wall clock and the
 * sub-minute remainder kept), the retention horizon, the median, the verdict
 * and the order and cut of what is sent. Every expected value is an instant or
 * a figure the plan pins, never one re-derived here. The `.test.ts` wrapper
 * pins `process.env.TZ = "America/St_Johns"` (the `report-period.spec`
 * pattern), so a host-zone leak cannot pass by accident.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const SITE_ID = "40000000-0000-4000-8000-000000000001";
const ASSET_ID = "30000000-0000-4000-8000-000000000001";

function iso(date: Date): string {
  return date.toISOString();
}

// --- shiftByLocalDays -------------------------------------------------------

/** One local day back in Asia/Kolkata keeps the wall clock and the seconds and milliseconds. */
export function assertShiftKeepsTheSubMinuteRemainder(): void {
  const shifted = shiftByLocalDays(new Date("2026-11-01T05:00:17.250Z"), -1, "Asia/Kolkata");
  expect(iso(shifted)).toBe("2026-10-31T05:00:17.250Z");
}

// --- baselineWindows --------------------------------------------------------

/** `today` in Asia/Kolkata at 10:30 IST: four windows of the same 10.5 h on the four preceding days. */
export function assertTodayWindowsInKolkata(): void {
  const now = new Date("2026-11-01T05:00:00Z");
  const current = resolveEnergyRange({ range: "today" }, zoneForArithmetic("Asia/Kolkata", null), now);
  expect(iso(current.start)).toBe("2026-10-31T18:30:00.000Z");
  expect(current.durationHours).toBe(10.5);

  const { stepDays, windows } = baselineWindows(current, "Asia/Kolkata", BASELINE_WINDOWS);
  expect(stepDays).toBe(1);
  expect(windows.map((w) => w.idx)).toEqual([1, 2, 3, 4]);
  expect(windows.map((w) => iso(w.start))).toEqual([
    "2026-10-30T18:30:00.000Z",
    "2026-10-29T18:30:00.000Z",
    "2026-10-28T18:30:00.000Z",
    "2026-10-27T18:30:00.000Z",
  ]);
  for (const w of windows) expect(w.end.getTime() - w.start.getTime()).toBe(10.5 * HOUR_MS);
}

/** The step is `ceil(durationHours / 24)` for every range kind. */
export function assertStepDaysByRange(): void {
  const now = new Date("2026-11-01T05:00:00Z");
  const kolkata = zoneForArithmetic("Asia/Kolkata", null);
  const step = (range: "7d" | "30d") =>
    baselineWindows(resolveEnergyRange({ range }, kolkata, now), "Asia/Kolkata", BASELINE_WINDOWS).stepDays;
  expect(step("7d")).toBe(7);
  expect(step("30d")).toBe(30);
}

/** A month-to-date of 15 d 6 h compares with the four preceding 16-day blocks. */
export function assertThisMonthOfFifteenDaysSixHoursStepsSixteen(): void {
  const now = new Date("2026-11-16T06:00:00Z");
  const current = resolveEnergyRange({ range: "this_month" }, zoneForArithmetic("UTC", null), now);
  expect(current.durationHours).toBe(15 * 24 + 6);
  const { stepDays, windows } = baselineWindows(current, "Etc/UTC", BASELINE_WINDOWS);
  expect(stepDays).toBe(16);
  expect(iso(windows[0]!.start)).toBe("2026-10-16T00:00:00.000Z");
}

/**
 * The `America/New_York` fall-back of 2026-11-01 (02:00 EDT → 01:00 EST).
 * `today` on 11-01 starts at 00:00 EDT = `04:00Z`, and its k=1 window starts at
 * 00:00 EDT on 10-31 = `04:00Z`. `today` on 11-02 starts at 00:00 EST =
 * `05:00Z`; its k=1 window is 00:00 on 11-01, which is still EDT, so `04:00Z` —
 * the wall clock holds. A shift by 24 h of UTC would give `05:00Z`.
 */
export function assertWindowsHoldTheWallClockAcrossFallBack(): void {
  const newYork = zoneForArithmetic("America/New_York", null);

  const first = resolveEnergyRange({ range: "today" }, newYork, new Date("2026-11-01T15:00:00Z"));
  expect(iso(first.start)).toBe("2026-11-01T04:00:00.000Z");
  expect(iso(baselineWindows(first, "America/New_York", 1).windows[0]!.start)).toBe("2026-10-31T04:00:00.000Z");

  const second = resolveEnergyRange({ range: "today" }, newYork, new Date("2026-11-02T15:00:00Z"));
  expect(iso(second.start)).toBe("2026-11-02T05:00:00.000Z");
  const window = baselineWindows(second, "America/New_York", 1).windows[0]!;
  expect(iso(window.start)).toBe("2026-11-01T04:00:00.000Z");
  // The end holds 10:00 local too, so the window is the 25-hour day's 11 h.
  expect(iso(window.end)).toBe("2026-11-01T15:00:00.000Z");
}

// --- windowsWithinHorizon -----------------------------------------------------

function windowEndingDaysBack(idx: number, now: Date, startDaysBack: number, endDaysBack: number) {
  return {
    idx,
    start: new Date(now.getTime() - startDaysBack * DAY_MS),
    end: new Date(now.getTime() - endDaysBack * DAY_MS),
  };
}

/** At `5m` (735 d retention) a window starting 736 d back is dropped; one starting 734 d back is kept. */
export function assertHorizonDropsByTheWindowStart(): void {
  const now = new Date("2026-11-01T05:00:00Z");
  // The dropped window ends 734 d back: a check on `end` would keep it.
  const old = windowEndingDaysBack(1, now, 736, 734);
  const young = windowEndingDaysBack(2, now, 734, 732);
  expect(windowsWithinHorizon([old, young], "5m", now).map((w) => w.idx)).toEqual([2]);
}

/** `1h` is never dropped: every window is kept. */
export function assertHorizonKeepsEverythingAtOneHour(): void {
  const now = new Date("2026-11-01T05:00:00Z");
  const windows = [windowEndingDaysBack(1, now, 3_000, 2_998), windowEndingDaysBack(2, now, 10, 8)];
  expect(windowsWithinHorizon(windows, "1h", now).map((w) => w.idx)).toEqual([1, 2]);
}

// --- medianOf ---------------------------------------------------------------

export function assertMedianOfOddCount(): void {
  expect(medianOf([3, 1, 2])).toBe(2);
}

export function assertMedianOfEvenCount(): void {
  expect(medianOf([1, 2, 3, 4])).toBe(2.5);
}

export function assertMedianOfNothingIsNull(): void {
  expect(medianOf([])).toBeNull();
}

// --- verdictFor ---------------------------------------------------------------

const FULL = 10;

function windows(...kwh: number[]) {
  return kwh.map((value) => ({ kwh: value, bucketCount: FULL }));
}

/** Two counting windows are fewer than `MIN_BASELINE_WINDOWS`: not enough history. */
export function assertTwoCountingWindowsAreNotEnoughHistory(): void {
  expect(MIN_BASELINE_WINDOWS).toBe(3);
  const verdict = verdictFor({ kwh: 100, bucketCount: FULL }, windows(10, 10));
  expect(verdict.verdict).toBe("not_enough_history");
  expect(verdict.baselineWindows).toBe(2);
  expect(verdict.ratio).toBeNull();
}

/** Median 10, current 15: ratio 1.5, `above`. */
export function assertRatioOfOnePointFiveIsAbove(): void {
  expect(ABNORMAL_RATIO).toBe(1.5);
  const verdict = verdictFor({ kwh: 15, bucketCount: FULL }, windows(9, 10, 11, 10));
  expect(verdict.verdict).toBe("above");
  expect(verdict.baselineKwh).toBe(10);
  expect(verdict.ratio).toBe(1.5);
  expect(verdict.baselineWindows).toBe(4);
}

/** Median 10, current 14.9: `normal`. */
export function assertRatioBelowOnePointFiveIsNormal(): void {
  const verdict = verdictFor({ kwh: 14.9, bucketCount: FULL }, windows(10, 10, 10));
  expect(verdict.verdict).toBe("normal");
  expect(verdict.ratio).toBeCloseTo(1.49, 10);
}

/**
 * A window with fewer than half the current period's buckets does not count:
 * three windows of which one holds 4 of 10 buckets leave two, so not enough
 * history; the same three at 5 of 10 count, and the verdict is reached.
 */
export function assertAThinWindowDoesNotCount(): void {
  const thin = verdictFor({ kwh: 15, bucketCount: FULL }, [
    { kwh: 10, bucketCount: FULL },
    { kwh: 10, bucketCount: FULL },
    { kwh: 10, bucketCount: 4 },
  ]);
  expect(thin.verdict).toBe("not_enough_history");
  expect(thin.baselineWindows).toBe(2);

  const half = verdictFor({ kwh: 15, bucketCount: FULL }, [
    { kwh: 10, bucketCount: FULL },
    { kwh: 10, bucketCount: FULL },
    { kwh: 10, bucketCount: 5 },
  ]);
  expect(half.verdict).toBe("above");
  expect(half.baselineWindows).toBe(3);
}

/** A zero baseline never divides: not enough history, ratio `null`, never `Infinity`. */
export function assertAZeroBaselineIsNotEnoughHistory(): void {
  const verdict = verdictFor({ kwh: 15, bucketCount: FULL }, windows(0, 0, 0, 0));
  expect(verdict.verdict).toBe("not_enough_history");
  expect(verdict.baselineKwh).toBe(0);
  expect(verdict.ratio).toBeNull();
}

// --- abnormalEntries ------------------------------------------------------------

function row(over: Partial<EntityWindowRow>): EntityWindowRow {
  return {
    kind: "asset",
    id: ASSET_ID,
    locationId: SITE_ID,
    code: "M-1",
    name: "Meter 1",
    siteName: "Site 1",
    idx: 0,
    kwh: 15,
    bucketCount: FULL,
    ...over,
  };
}

/**
 * The rows of one statement become one candidate per entity with a current
 * row: an asset `above` over four windows, and a site with no current row is
 * not judged at all.
 */
export function assertEntriesJudgeEveryEntityWithACurrentRow(): void {
  const rows: EntityWindowRow[] = [
    row({ idx: 0, kwh: 15 }),
    ...[1, 2, 3, 4].map((idx) => row({ idx, kwh: 10 })),
    // The site has baseline rows but no current row: it is not judged.
    ...[1, 2, 3].map((idx) =>
      row({ kind: "site", id: SITE_ID, code: null, name: "Site 1", siteName: null, idx, kwh: 30 }),
    ),
  ];
  const candidates = abnormalEntries(rows);
  expect(candidates).toHaveLength(1);
  expect(candidates[0]).toEqual({
    kind: "asset",
    id: ASSET_ID,
    code: "M-1",
    name: "Meter 1",
    siteName: "Site 1",
    currentKwh: 15,
    baselineKwh: 10,
    ratio: 1.5,
    verdict: "above",
    baselineWindows: 4,
  });
}

/** A window absent from the rows (no data in it) does not count: two of four is not enough history. */
export function assertAnAbsentWindowDoesNotCount(): void {
  const rows = [row({ idx: 0 }), row({ idx: 1, kwh: 10 }), row({ idx: 3, kwh: 10 })];
  const [candidate] = abnormalEntries(rows);
  expect(candidate?.verdict).toBe("not_enough_history");
  expect(candidate?.baselineWindows).toBe(2);
}

// --- orderAndTrim -----------------------------------------------------------------

function candidate(over: Partial<AbnormalCandidate>): AbnormalCandidate {
  return {
    kind: "asset",
    id: ASSET_ID,
    code: "M-1",
    name: "Meter",
    siteName: "Site 1",
    currentKwh: 15,
    baselineKwh: 10,
    ratio: 1.5,
    verdict: "above",
    baselineWindows: 4,
    ...over,
  };
}

function uuid(n: number): string {
  return `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** `above` by ratio desc, then not-enough-history by name; `normal` is counted per kind, never sent. */
export function assertOrderAboveThenNotEnoughHistoryNormalCounted(): void {
  const trimmed = orderAndTrim(
    [
      candidate({ id: uuid(1), name: "Zulu", verdict: "not_enough_history", ratio: null, baselineKwh: null }),
      candidate({ id: uuid(2), name: "Low", ratio: 1.6 }),
      candidate({ id: uuid(3), name: "Alpha", verdict: "not_enough_history", ratio: null, baselineKwh: null }),
      candidate({ id: uuid(4), name: "High", ratio: 3 }),
      candidate({ id: uuid(5), name: "Fine", verdict: "normal", ratio: 1.1 }),
      candidate({ id: uuid(6), kind: "site", name: "Fine site", verdict: "normal", ratio: 0.9 }),
      candidate({ id: uuid(7), kind: "site", name: "Fine site 2", verdict: "normal", ratio: 1 }),
    ],
    ABNORMAL_LIST_MAX,
  );
  expect(trimmed.entries.map((e) => e.name)).toEqual(["High", "Low", "Alpha", "Zulu"]);
  expect(trimmed.entries.map((e) => e.verdict)).not.toContain("normal");
  expect(trimmed.normalCount).toEqual({ sites: 2, assets: 1 });
  expect(trimmed.truncated).toBe(false);
}

/** 101 `above` entries are cut to 100 with `truncated`; exactly 100 are not truncated. */
export function assertTruncatedAtOneHundredAndOne(): void {
  const many = (count: number) =>
    Array.from({ length: count }, (_, i) => candidate({ id: uuid(i + 1), name: `M${i}`, ratio: 2 + i }));
  const cut = orderAndTrim(many(ABNORMAL_LIST_MAX + 1), ABNORMAL_LIST_MAX);
  expect(cut.entries).toHaveLength(100);
  expect(cut.truncated).toBe(true);
  // The highest ratio is kept; the lowest is the one cut.
  expect(cut.entries[0]?.ratio).toBe(2 + ABNORMAL_LIST_MAX);
  expect(cut.entries.map((e) => e.ratio)).not.toContain(2);

  const exact = orderAndTrim(many(ABNORMAL_LIST_MAX), ABNORMAL_LIST_MAX);
  expect(exact.entries).toHaveLength(100);
  expect(exact.truncated).toBe(false);
}
