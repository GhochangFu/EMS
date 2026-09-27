import { expect } from "vitest";

import { inscribedWindowIsEmpty } from "./refresh-aggregates";

/** Vitest entry point lives in the sibling `.test.ts` (ADR 0014). */

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;

/** The CI signature (M4): a run at 03:01:41Z the day `_1h` opened its chunk. */
export function assertTheCiInstantIsEmpty(): void {
  const from = Date.parse("2026-09-04T00:00:00.000Z");
  const now = Date.parse("2026-09-04T03:01:41.000Z");
  expect(inscribedWindowIsEmpty(from, now, DAY_MS)).toBe(true);
}

/** A day plus one minute covers a full day-bucket past `from`. */
export function assertADayAndOneMinuteIsNotEmpty(): void {
  const from = Date.parse("2026-09-04T00:00:00.000Z");
  const now = from + DAY_MS + 60_000;
  expect(inscribedWindowIsEmpty(from, now, DAY_MS)).toBe(false);
}

/**
 * `from` sits 30 minutes into its day, `now` is 24h10m later — a plain
 * `now - from < w` sees a 24h10m span against a 24h width and calls it
 * non-empty (`false`). The inscribed window is what Timescale actually
 * checks: `ceil(from, w)` rounds `from` up to the NEXT day boundary, and
 * `floor(now, w)` rounds `now` down to the day boundary it just crossed —
 * the same instant. `floor(now) <= ceil(from)` is true, so the window holds
 * no complete bucket even though it spans more than one bucket-width.
 */
export function assertAMisalignedWindowCanBeEmptyEvenWhenWiderThanABucket(): void {
  const from = Date.parse("2026-09-04T00:30:00.000Z");
  const now = from + DAY_MS + 10 * 60_000;
  expect(inscribedWindowIsEmpty(from, now, DAY_MS)).toBe(true);
}

/** A 1-hour-level window that has not yet reached the hour boundary. */
export function assertAnHourLevelWindowShortOfTheBoundaryIsEmpty(): void {
  const from = Date.parse("2026-09-04T00:00:00.000Z");
  const now = Date.parse("2026-09-04T00:59:00.000Z");
  expect(inscribedWindowIsEmpty(from, now, HOUR_MS)).toBe(true);
}

/** The same 1-hour-level window at the boundary holds one complete bucket. */
export function assertAnHourLevelWindowAtTheBoundaryIsNotEmpty(): void {
  const from = Date.parse("2026-09-04T00:00:00.000Z");
  const now = Date.parse("2026-09-04T01:00:00.000Z");
  expect(inscribedWindowIsEmpty(from, now, HOUR_MS)).toBe(false);
}
