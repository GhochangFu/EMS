import { DEGRADATION_WINDOW_DAYS } from "@bms/shared";
import { expect } from "vitest";

import { shiftDay } from "../telemetry/energy-cost-by-day";
import { degradationWindow, seriesOf } from "./degradation-window";

/**
 * `E1.5a` / ADR 0138 (plan R-a, §4.2, T1.4) — the degradation window, pure.
 * Assertions live here; `degradation-window.test.ts` is the vitest entry point.
 */
const KOLKATA = "Asia/Kolkata";
const ms = (iso: string): number => Date.parse(iso);

/** At 00:10 local the window ends at the midnight just passed; today is not a label. */
export function theWindowEndsAtTheMidnightJustPassed(): void {
  // 2026-11-18 00:10 in Kolkata (UTC+05:30).
  const window = degradationWindow(ms("2026-11-17T18:40:00Z"), KOLKATA);
  expect(window.zone).toBe(KOLKATA);
  expect(window.days).not.toContain("2026-11-18");
  expect(window.days.at(-1)).toBe("2026-11-17");
  expect(window.toMs).toBe(ms("2026-11-17T18:30:00Z"));
  expect(window.fromMs).toBe(ms("2026-10-20T18:30:00Z"));
}

/** The window holds the window's number of labels, oldest first, one day apart. */
export function theWindowHasItsLabelsOldestFirst(): void {
  const window = degradationWindow(ms("2026-11-17T18:40:00Z"), KOLKATA);
  expect(window.days).toHaveLength(DEGRADATION_WINDOW_DAYS);
  expect(window.days[0]).toBe("2026-10-21");
  window.days.forEach((day, i) => {
    if (i > 0) expect(day).toBe(shiftDay(window.days[i - 1]!, 1));
  });
}

/** A month with a DST change still gives the full number of labels. */
export function aDstMonthStillHasEveryLabel(): void {
  // Europe/London sprang forward on 2026-03-29; the window runs 2026-03-14 … 2026-04-10.
  const window = degradationWindow(ms("2026-04-11T12:00:00Z"), "Europe/London");
  expect(window.days).toHaveLength(DEGRADATION_WINDOW_DAYS);
  expect(window.days).toContain("2026-03-29");
  expect(window.days[0]).toBe("2026-03-14");
  expect(window.days.at(-1)).toBe("2026-04-10");
  expect(window.fromMs).toBe(ms("2026-03-14T00:00:00Z"));
  expect(window.toMs).toBe(ms("2026-04-10T23:00:00Z"));
}

/** `seriesOf` drops a day with no value and keeps the gap in `x`. */
export function seriesOfDropsAMissingDayAndKeepsTheGap(): void {
  const days = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"];
  const values = new Map<string, number>([
    ["2026-11-05", 0.5],
    ["2026-11-01", 0.9],
    ["2026-11-03", 0.7],
    ["2026-10-31", 1],
  ]);
  expect(seriesOf(days, values)).toEqual({ xs: [0, 2, 4], ys: [0.9, 0.7, 0.5] });
  expect(seriesOf(days, new Map())).toEqual({ xs: [], ys: [] });
}
