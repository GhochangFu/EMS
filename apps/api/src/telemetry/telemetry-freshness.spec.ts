import { expect } from "vitest";

import { telemetryFreshnessAt } from "./telemetry-freshness";

/**
 * `F3.68` (ADR 0076 decision 7, plan D9) — `telemetryFreshnessAt`, the one
 * JS-side judgement of "is this newest sample live?" that
 * `DashboardService.telemetryFreshness` and `GeneratedSiteViewService` both
 * read. The window is `LIVE_TELEMETRY_MAX_AGE_SECONDS` (25 s), inclusive.
 * Assertions live here; the sibling `.test.ts` names the cases (ADR 0014).
 */

const NOW_MS = Date.parse("2026-09-26T10:00:00.000Z");

const agedIso = (ageMs: number): string => new Date(NOW_MS - ageMs).toISOString();

/** F1 — a sample 22 s old is live. */
export function assertTwentyTwoSecondsIsLive(): void {
  expect(telemetryFreshnessAt(agedIso(22_000), NOW_MS)).toBe("live");
}

/** F2 — a sample 30 s old is stale. */
export function assertThirtySecondsIsStale(): void {
  expect(telemetryFreshnessAt(agedIso(30_000), NOW_MS)).toBe("stale");
}

/** F3 — no sample at all is `none`, not stale. */
export function assertNullIsNone(): void {
  expect(telemetryFreshnessAt(null, NOW_MS)).toBe("none");
}

/**
 * F4 — exactly 25 s is still live: the window is inclusive (`<=`), as
 * `DashboardService.telemetryFreshness` was before the extraction. F1 and F2
 * cannot tell `<` from `<=`; only the boundary can.
 */
export function assertTheBoundaryIsLive(): void {
  expect(telemetryFreshnessAt(agedIso(25_000), NOW_MS)).toBe("live");
}
