import { expect } from "vitest";

import { HEADLINE_POINT_COUNT } from "@bms/shared/contracts";
import { encodePointRef, type GeneratedSitePointDto, type GeneratedSiteViewDto } from "@bms/shared";

import {
  assetStatus,
  clampSample,
  clampSeeded,
  formatPointValue,
  headlinePoints,
  NO_SEEDED_CLAMPS,
  overlayReading,
  type ClampedLatest,
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

/** A sample already clamped, as the hook stores it. */
function clamped(value: number, time: string): ClampedLatest {
  return { value, time, atMs: Date.parse(time) };
}

const SEEDED = clamped(1, "2026-09-26T09:59:50.000Z");

/** L2a — a newer live reading replaces the seeded one. */
export function newerReadingReplaces(): void {
  const live = clamped(2, "2026-09-26T09:59:55.000Z");
  expect(overlayReading(SEEDED, live)).toEqual(live);
}

/** L2b — an older reading, or one at the same instant, leaves the seed alone. */
export function olderOrEqualReadingIsIgnored(): void {
  expect(overlayReading(SEEDED, clamped(3, "2026-09-26T09:59:40.000Z"))).toEqual(SEEDED);
  expect(overlayReading(SEEDED, clamped(4, SEEDED.time))).toEqual(SEEDED);
}

/** L2c — with no seed, any reading is taken; with no reading, the seed stands. */
export function nullSeedTakesTheReading(): void {
  const live = clamped(5, "2026-09-26T09:00:00.000Z");
  expect(overlayReading(null, live)).toEqual(live);
  expect(overlayReading(SEEDED, undefined)).toEqual(SEEDED);
}

/** L2d — a sample that cannot be dated clamps to nothing, so it is never stored. */
export function undatableReadingIsIgnored(): void {
  expect(clampSample({ value: 6, time: "not a time" }, NOW)).toBeNull();
}

/**
 * L2e — the comparison reads the clamped time: a future-dated seed clamped to
 * its arrival (NOW) gives way to a reading clamped 5 s later, although the
 * seed's raw time is still the later of the two.
 */
export function clampedTimeDecidesTheNewer(): void {
  const futureSeed = clampSample({ value: 1, time: new Date(NOW + 60_000).toISOString() }, NOW);
  const later = clampSample({ value: 2, time: new Date(NOW + 5_000).toISOString() }, NOW + 5_000);
  expect(overlayReading(futureSeed, later ?? undefined)?.value).toBe(2);
}

/** L5a — a future-dated sample is clamped to the instant it arrived. */
export function futureSampleClampsToArrival(): void {
  expect(clampSample({ value: 1, time: new Date(NOW + 60_000).toISOString() }, NOW)?.atMs).toBe(NOW);
}

/** L5b — a past sample keeps its own time. */
export function pastSampleKeepsItsTime(): void {
  expect(clampSample({ value: 1, time: new Date(NOW - 3_000).toISOString() }, NOW)?.atMs).toBe(NOW - 3_000);
}

const ASSET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function viewAt(time: string): GeneratedSiteViewDto {
  return {
    locationId: "22222222-2222-4222-8222-222222222222",
    asOf: time,
    domains: [
      {
        code: "hvac",
        label: "HVAC",
        assets: [
          {
            id: ASSET_ID,
            code: "AHU-01",
            name: "Air handler",
            domain: "hvac",
            latestTelemetryAt: time,
            freshness: "live",
            points: [{ pointKey: "kw", name: null, unit: null, headlineRank: null, latest: { value: 1, time } }],
          },
        ],
      },
    ],
  };
}

const FUTURE = new Date(NOW + 60_000).toISOString();
const KW = encodePointRef(ASSET_ID, "kw");

/** L5c — the seeded point sample is clamped at the read's arrival. */
export function seededPointClampsAtArrival(): void {
  expect(clampSeeded(viewAt(FUTURE), NOW, NO_SEEDED_CLAMPS).points.get(KW)?.atMs).toBe(NOW);
}

/** L5d — the seeded asset instant is clamped at the read's arrival. */
export function seededAssetClampsAtArrival(): void {
  expect(clampSeeded(viewAt(FUTURE), NOW, NO_SEEDED_CLAMPS).assets.get(ASSET_ID)?.atMs).toBe(NOW);
}

/** L5e — a refetch that re-supplies the same sample keeps its first clamp (point and asset). */
export function unchangedSampleKeepsItsFirstClamp(): void {
  const first = clampSeeded(viewAt(FUTURE), NOW, NO_SEEDED_CLAMPS);
  const again = clampSeeded(viewAt(FUTURE), NOW + 30_000, first);
  expect([again.points.get(KW)?.atMs, again.assets.get(ASSET_ID)?.atMs]).toEqual([NOW, NOW]);
}

/** L5f — a refetch with a new sample clamps it at the refetch's arrival. */
export function newSampleClampsAtTheNewArrival(): void {
  const first = clampSeeded(viewAt(FUTURE), NOW, NO_SEEDED_CLAMPS);
  const newer = new Date(NOW + 90_000).toISOString();
  expect(clampSeeded(viewAt(newer), NOW + 30_000, first).points.get(KW)?.atMs).toBe(NOW + 30_000);
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
