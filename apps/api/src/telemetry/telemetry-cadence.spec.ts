import { expect } from "vitest";

import {
  ASSET_WINDOW_SECONDS_SQL,
  FRESHNESS_CAP_SECONDS,
  FRESHNESS_FLOOR_SECONDS,
  FRESHNESS_INTERVAL_FACTOR,
  LIVE_ASSETS_CTE_SQL,
  windowSecondsFor,
} from "./telemetry-cadence";

/**
 * `F4.350` (ADR 0075 Amendment 3) — the window rule, `clamp(2.5 x interval, 25 s, 900 s)`.
 * Assertions live here; the sibling `.test.ts` names the cases (ADR 0014).
 */

/** C1 — the constants are the ruled ones. */
export function assertTheRuledConstants(): void {
  expect([FRESHNESS_FLOOR_SECONDS, FRESHNESS_CAP_SECONDS, FRESHNESS_INTERVAL_FACTOR]).toEqual([25, 900, 2.5]);
}

/** C2 — a 60 s device gets 150 s: one missed report still counts, two do not. */
export function assertSixtySecondsIsOneFifty(): void {
  expect(windowSecondsFor(60)).toBe(150);
}

/** C3 — a 1-5 s simulator device keeps the floor (2.5 x 5 = 12.5 < 25). */
export function assertFastDevicesKeepTheFloor(): void {
  expect([windowSecondsFor(1), windowSecondsFor(5), windowSecondsFor(10)]).toEqual([25, 25, 25]);
}

/** C4 — the floor/linear boundary: 10 s is exactly 25, 11 s is 28 (ceil of 27.5). */
export function assertTheFloorBoundary(): void {
  expect([windowSecondsFor(10), windowSecondsFor(11)]).toEqual([25, 28]);
}

/** C5 — a slow device is capped: 360 s is exactly the cap, 600 s is clamped to it. */
export function assertTheCap(): void {
  expect([windowSecondsFor(360), windowSecondsFor(361), windowSecondsFor(600), windowSecondsFor(86_400)]).toEqual([
    900, 900, 900, 900,
  ]);
}

/** C6 — an unknown, zero, negative or non-finite interval is the floor (the unknown-cadence fallback). */
export function assertUnknownIntervalIsTheFloor(): void {
  for (const bad of [null, undefined, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(windowSecondsFor(bad), String(bad)).toBe(25);
  }
}

/** C7 — the window is a whole number of seconds (the SQL form uses CEIL, so the two agree). */
export function assertTheWindowIsWhole(): void {
  expect(windowSecondsFor(12.2)).toBe(31);
  expect(Number.isInteger(windowSecondsFor(37.3))).toBe(true);
}

/** C8 — the SQL form states the same constants as the pure rule, as plan-time literals. */
export function assertTheSqlStatesTheSameRule(): void {
  expect(ASSET_WINDOW_SECONDS_SQL).toContain("LEAST(900, GREATEST(25, CEIL(2.5 *");
  expect(ASSET_WINDOW_SECONDS_SQL).toContain("r.expected_interval_seconds");
  expect(ASSET_WINDOW_SECONDS_SQL).toContain("l.interval_seconds");
  expect(LIVE_ASSETS_CTE_SQL).toContain("pv.time > now() - interval '900 seconds'");
  expect(LIVE_ASSETS_CTE_SQL).toContain("telemetry.point_values_1h");
  // Configured wins over learned: expected_interval first in the COALESCE.
  expect(ASSET_WINDOW_SECONDS_SQL.indexOf("r.expected_interval_seconds")).toBeLessThan(
    ASSET_WINDOW_SECONDS_SQL.indexOf("l.interval_seconds"),
  );
}
