import { expect } from "vitest";

import { priorInstantIso } from "./prior-instant";

/**
 * `F3.28` task 2.6 — `priorInstantIso`: floor to the minute, then minus 24 h.
 *
 * The key-stability case is the load-bearing one: `usePriorPointValues`
 * depends on two calls inside the same minute producing the identical string,
 * or its TanStack Query key would churn every render.
 */

/** A mid-minute instant floors to `:00.000` before the 24 h subtraction. */
export function pinsExactOutputForAMidMinuteInput(): void {
  // 2026-09-24T10:15:37.842Z
  const nowMs = Date.UTC(2026, 8, 24, 10, 15, 37, 842);
  expect(priorInstantIso(nowMs)).toBe("2026-09-23T10:15:00.000Z");
}

/** Two inputs inside the same minute give the same string. */
export function isStableForTwoInputsInTheSameMinute(): void {
  const a = Date.UTC(2026, 8, 24, 10, 15, 0, 0);
  const b = Date.UTC(2026, 8, 24, 10, 15, 59, 999);
  expect(priorInstantIso(a)).toBe(priorInstantIso(b));
}

/** A minute-boundary instant (`:00.000`) is unaffected by the floor. */
export function handlesAMinuteBoundaryInput(): void {
  const nowMs = Date.UTC(2026, 8, 24, 10, 16, 0, 0);
  expect(priorInstantIso(nowMs)).toBe("2026-09-23T10:16:00.000Z");
}
