import { DEGRADATION_WINDOW_DAYS } from "@bms/shared";

import { midnightOf } from "../advisories/advisory-window";
import { localDay, shiftDay, windowDays } from "../telemetry/energy-cost-by-day";
import type { DailySeries, DegradationWindow } from "./degradation-engine.types";

/**
 * `E1.5a` / ADR 0138 (plan R-a, R-d, §4.2) — the window and the daily series.
 * Pure: no database and no clock.
 *
 * The window is the complete local days before today in the asset's zone; day
 * index `x` is 0 for the oldest and grows by one a day. Days are labelled with
 * `localDay`, as the advisories do.
 */

/** The window of `zone` at `nowMs`: the days before today, oldest first, and their instant range. */
export function degradationWindow(nowMs: number, zone: string): DegradationWindow {
  const today = localDay(nowMs, zone);
  const days = windowDays(shiftDay(today, -1), DEGRADATION_WINDOW_DAYS);
  return { zone, days, fromMs: midnightOf(days[0]!, zone), toMs: midnightOf(today, zone) };
}

/** The series of `days` with a value: ascending `x`, a missing day left out and its gap kept. */
export function seriesOf(days: readonly string[], valueByDay: ReadonlyMap<string, number>): DailySeries {
  const xs: number[] = [];
  const ys: number[] = [];
  days.forEach((day, x) => {
    const value = valueByDay.get(day);
    if (value === undefined) return;
    xs.push(x);
    ys.push(value);
  });
  return { xs, ys };
}
