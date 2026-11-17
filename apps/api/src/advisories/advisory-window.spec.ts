import { ADVISORY_WINDOW_DAYS, BASELINE_WINDOWS } from "@bms/shared";
import { expect } from "vitest";

import type { HourlyEnergy } from "../telemetry/energy-cost-by-day";
import { advisoryWindows, hasCoverage, windowTotals } from "./advisory-window";

/**
 * `E1.6a` / ADR 0137 (plan R-a, R-b, T1.3) — the advisory window, pure.
 * Assertions live here; `advisory-window.test.ts` is the vitest entry point.
 */
const KOLKATA = "Asia/Kolkata";
const HOUR_MS = 3_600_000;
const ms = (iso: string): number => Date.parse(iso);
const hour = (iso: string, kwh = 1): HourlyEnergy => ({ assetId: "a", bucketMs: ms(iso), kwh });

/** At 00:10 local the window ends at the midnight just passed; today's hours are left out. */
export function theWindowEndsAtTheMidnightJustPassed(): void {
  // 2026-11-18 00:10 in Kolkata (UTC+05:30).
  const windows = advisoryWindows(ms("2026-11-17T18:40:00Z"), KOLKATA);
  expect(windows.days).toEqual([
    "2026-11-11",
    "2026-11-12",
    "2026-11-13",
    "2026-11-14",
    "2026-11-15",
    "2026-11-16",
    "2026-11-17",
  ]);
  expect(windows.toMs).toBe(ms("2026-11-17T18:30:00Z"));
  expect(windows.fromMs).toBe(ms("2026-11-10T18:30:00Z"));
  expect(windows.readToMs).toBe(windows.toMs);

  const totals = windowTotals(
    [hour("2026-11-17T17:30:00Z", 2), hour("2026-11-17T18:30:00Z", 5), hour("2026-11-10T17:30:00Z", 7)],
    KOLKATA,
    windows.days,
  );
  // Only the last hour of 17 Nov counts: the first hour of today and the last of 10 Nov do not.
  expect(totals).toEqual({ kwh: 2, bucketCount: 1 });
}

/** An hour starting 23:30 UTC is 05:00 the next day in Kolkata. */
export function aLateUtcHourLandsInTheNextLocalDay(): void {
  const late = [hour("2026-11-15T23:30:00Z", 3)];
  expect(windowTotals(late, KOLKATA, ["2026-11-16"])).toEqual({ kwh: 3, bucketCount: 1 });
  expect(windowTotals(late, KOLKATA, ["2026-11-15"])).toEqual({ kwh: 0, bucketCount: 0 });
}

/** 80 % of 168 is 134.4: 134 buckets fail, 135 pass. */
export function coverageNeedsEightyPercentOfTheBuckets(): void {
  expect(hasCoverage(134)).toBe(false);
  expect(hasCoverage(135)).toBe(true);
  expect(hasCoverage(24 * ADVISORY_WINDOW_DAYS)).toBe(true);
  expect(hasCoverage(0)).toBe(false);
}

/** The baseline windows sit back to back before the current one and overlap nothing. */
export function theBaselineWindowsOverlapNothing(): void {
  const windows = advisoryWindows(ms("2026-11-17T06:00:00Z"), KOLKATA);
  expect(windows.baselineDays).toHaveLength(BASELINE_WINDOWS);
  const all = [windows.days, ...windows.baselineDays].flat();
  expect(new Set(all).size).toBe(all.length);
  expect(all).toHaveLength(ADVISORY_WINDOW_DAYS * (BASELINE_WINDOWS + 1));
  expect(windows.baselineDays[0]).toEqual([
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
    "2026-11-07",
    "2026-11-08",
    "2026-11-09",
  ]);
  expect(windows.baselineDays[BASELINE_WINDOWS - 1]![0]).toBe("2026-10-13");
  // The read starts at the oldest baseline day's local midnight.
  expect(windows.readFromMs).toBe(ms("2026-10-12T18:30:00Z"));
}

/** A week with a DST change still gives 7 labels; the window is then 169 hours long. */
export function aDstWeekStillHasSevenDays(): void {
  // Europe/London fell back on 2026-10-25.
  const windows = advisoryWindows(ms("2026-10-28T12:00:00Z"), "Europe/London");
  expect(windows.days).toHaveLength(ADVISORY_WINDOW_DAYS);
  expect(windows.days[0]).toBe("2026-10-21");
  expect(windows.days[6]).toBe("2026-10-27");
  expect(windows.fromMs).toBe(ms("2026-10-20T23:00:00Z"));
  expect(windows.toMs).toBe(ms("2026-10-28T00:00:00Z"));
  expect((windows.toMs - windows.fromMs) / HOUR_MS).toBe(169);
}

/** A non-finite hour adds nothing, as in `foldCostByDay`. */
export function aNonFiniteHourIsLeftOut(): void {
  const totals = windowTotals([hour("2026-11-16T06:30:00Z", Number.NaN)], KOLKATA, ["2026-11-16"]);
  expect(totals).toEqual({ kwh: 0, bucketCount: 0 });
}
