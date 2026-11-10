import { expect } from "vitest";

import { telemetryFreshnessAt } from "./telemetry-freshness";

/**
 * `F3.68` (ADR 0076 decision 7, plan D9) — `telemetryFreshnessAt`, the one
 * JS-side judgement of "is this newest sample live?" that
 * `DashboardService.telemetryFreshness` and `GeneratedSiteViewService` both
 * read. The window is the caller's `windowSeconds` (the asset's own RTU window since `F4.350`), inclusive.
 * Assertions live here; the sibling `.test.ts` names the cases (ADR 0014).
 */

const NOW_MS = Date.parse("2026-09-26T10:00:00.000Z");

const agedIso = (ageMs: number): string => new Date(NOW_MS - ageMs).toISOString();

/** F1 — a sample 22 s old is live. */
export function assertTwentyTwoSecondsIsLive(): void {
  expect(telemetryFreshnessAt(agedIso(22_000), NOW_MS, 25)).toBe("live");
}

/** F2 — a sample 30 s old is stale. */
export function assertThirtySecondsIsStale(): void {
  expect(telemetryFreshnessAt(agedIso(30_000), NOW_MS, 25)).toBe("stale");
}

/** F3 — no sample at all is `none`, not stale. */
export function assertNullIsNone(): void {
  expect(telemetryFreshnessAt(null, NOW_MS, 25)).toBe("none");
}

/**
 * F4 — exactly 25 s is still live: the window is inclusive (`<=`), as
 * `DashboardService.telemetryFreshness` was before the extraction. F1 and F2
 * cannot tell `<` from `<=`; only the boundary can.
 */
export function assertTheBoundaryIsLive(): void {
  expect(telemetryFreshnessAt(agedIso(25_000), NOW_MS, 25)).toBe("live");
}

/**
 * F5 (`F4.350`) — the window is the caller's: a 60 s device (window 150 s) is live at 55 s and
 * stale at 160 s, where the old fixed 25 s read it stale from 26 s on; a 2 s device (floor 25 s)
 * is stale at 30 s.
 */
export function assertTheWindowIsTheCallers(): void {
  expect(telemetryFreshnessAt(agedIso(55_000), NOW_MS, 150)).toBe("live");
  expect(telemetryFreshnessAt(agedIso(150_000), NOW_MS, 150)).toBe("live");
  expect(telemetryFreshnessAt(agedIso(160_000), NOW_MS, 150)).toBe("stale");
  expect(telemetryFreshnessAt(agedIso(30_000), NOW_MS, 25)).toBe("stale");
}
