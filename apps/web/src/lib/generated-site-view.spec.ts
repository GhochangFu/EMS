import { expect } from "vitest";

import { HEADLINE_POINT_COUNT } from "@bms/shared/contracts";
import type { GeneratedSitePointDto } from "@bms/shared";

import {
  assetStatus,
  formatPointValue,
  headlinePoints,
  overlayReading,
} from "./generated-site-view";
import { FRESH_MS } from "./schematic-telemetry";

/**
 * `F3.68` U6 — the pure half of `GeneratedSiteView` (ADR 0076 decision 7),
 * rows L1–L4. The plan names the four helpers and not their cases; the cases
 * here are this unit's reading of D1, D3 and D6.
 *
 * The staleness boundary is read from `FRESH_MS` rather than restated, so a
 * change to the shared window moves these cases with it (ADR 0027 decision 6).
 */

const NOW = Date.parse("2026-09-26T10:00:00.000Z");

function point(pointKey: string): GeneratedSitePointDto {
  return { pointKey, name: null, unit: null, headlineRank: null, latest: null };
}

const SIX = ["f", "a", "e", "b", "d", "c"].map(point);

/** L1a — the card shows the first `HEADLINE_POINT_COUNT`, in server order. */
export function headlineSliceKeepsServerOrder(): void {
  expect(headlinePoints(SIX, false).map((p) => p.pointKey)).toEqual(["f", "a", "e", "b"]);
  expect(HEADLINE_POINT_COUNT).toBe(4);
}

/** L1b — expanded, every point, in server order (OQ2). */
export function expandedShowsEveryPoint(): void {
  expect(headlinePoints(SIX, true).map((p) => p.pointKey)).toEqual(["f", "a", "e", "b", "d", "c"]);
}

const SEEDED = { value: 1, time: "2026-09-26T09:59:50.000Z" };

/** L2a — a newer live reading replaces the seeded one. */
export function newerReadingReplaces(): void {
  const live = { value: 2, time: "2026-09-26T09:59:55.000Z" };
  expect(overlayReading(SEEDED, live)).toEqual(live);
}

/** L2b — an older reading, or one at the same instant, leaves the seed alone. */
export function olderOrEqualReadingIsIgnored(): void {
  expect(overlayReading(SEEDED, { value: 3, time: "2026-09-26T09:59:40.000Z" })).toEqual(SEEDED);
  expect(overlayReading(SEEDED, { value: 4, time: SEEDED.time })).toEqual(SEEDED);
}

/** L2c — with no seed, any dated reading is taken; with no reading, the seed stands. */
export function nullSeedTakesTheReading(): void {
  const live = { value: 5, time: "2026-09-26T09:00:00.000Z" };
  expect(overlayReading(null, live)).toEqual(live);
  expect(overlayReading(SEEDED, undefined)).toEqual(SEEDED);
}

/** L2d — a reading that cannot be dated is no evidence; the seed stands. */
export function undatableReadingIsIgnored(): void {
  expect(overlayReading(SEEDED, { value: 6, time: "not a time" })).toEqual(SEEDED);
  expect(overlayReading(null, { value: 6, time: "not a time" })).toBeNull();
}

/** L3a — no sample at all is `none`, not `stale` (D3). */
export function noSampleIsNone(): void {
  expect(assetStatus(null, NOW)).toBe("none");
}

/** L3b — a sample inside the shared window is `live`; the window's edge is still live. */
export function sampleInsideTheWindowIsLive(): void {
  expect(assetStatus(NOW - 1_000, NOW)).toBe("live");
  expect(assetStatus(NOW - FRESH_MS, NOW)).toBe("live");
}

/** L3c — a sample past the shared window is `stale`; so is one from the future (`isStale`). */
export function samplePastTheWindowIsStale(): void {
  expect(assetStatus(NOW - FRESH_MS - 1, NOW)).toBe("stale");
  expect(assetStatus(NOW - 30_000, NOW)).toBe("stale");
  expect(assetStatus(NOW + 1_000, NOW)).toBe("stale");
}

/** L4a — `null` prints the shared dash. */
export function nullValuePrintsTheDash(): void {
  expect(formatPointValue(null)).toBe("—");
}

/** L4b — zero is a value, not an absence. */
export function zeroPrintsZero(): void {
  expect(formatPointValue(0)).toBe("0");
}

/** L4c — integers print whole; fractions round to two places. */
export function valuesRoundToTwoPlaces(): void {
  expect(formatPointValue(230)).toBe("230");
  expect(formatPointValue(0.987)).toBe("0.99");
  expect(formatPointValue(49.95)).toBe("49.95");
  expect(formatPointValue(-12.5)).toBe("-12.5");
}
