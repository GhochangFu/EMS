import { expect } from "vitest";

import { formatInZone } from "../components/asset-history/history-format";
import { trendStripSearch } from "../api/trend-strip";
import {
  historyHref,
  lastValue,
  pointStyleFor,
  sparklineAreas,
  sparklineBars,
  sparklinePolylines,
  strokeRoleFor,
  stripWindowLabel,
} from "./trend-strip";

/**
 * `F4.301` U4 (ADR 0108 Amendment 2, items 5, 7 and 9) — the trend strip's pure helpers.
 * Assertions live here; `trend-strip.test.ts` is the Vitest entry point (ADR 0014).
 */

const ASSET_ID = "6f1c2a8e-3b7d-4c1a-9e2f-0a1b2c3d4e5f";

function yOf(point: string): number {
  return Number(point.split(",")[1]);
}

/** A `null` bucket breaks the line: [1, 2] and [3] are two polylines. */
export function aNullBreaksThePolyline(): void {
  const lines = sparklinePolylines([{ v: 1 }, { v: 2 }, { v: null }, { v: 3 }], 120, 36);
  expect(lines).toHaveLength(2);
  expect(lines[0].split(" ")).toHaveLength(2);
  expect(lines[1].split(" ")).toHaveLength(1);
}

/** The x of each point is its bucket position, so the second polyline starts at the 4th bucket. */
export function xIsTheBucketPosition(): void {
  const lines = sparklinePolylines([{ v: 1 }, { v: 2 }, { v: null }, { v: 3 }], 120, 36);
  expect(lines[0]).toBe("0,36 40,18");
  expect(lines[1]).toBe("120,0");
}

/** All-equal values: one flat line at mid height. */
export function equalValuesDrawAFlatMidLine(): void {
  const lines = sparklinePolylines([{ v: 5 }, { v: 5 }, { v: 5 }], 120, 36);
  expect(lines).toHaveLength(1);
  expect(lines[0].split(" ").map(yOf)).toEqual([18, 18, 18]);
}

/** No value at all: nothing to draw. */
export function allNullDrawsNothing(): void {
  expect(sparklinePolylines([{ v: null }, { v: null }], 120, 36)).toEqual([]);
}

/** The click target: the renamed history route with the strip's range and point. */
export function historyHrefIsTheRenamedRoute(): void {
  expect(historyHref(ASSET_ID, "7d", "kw")).toBe(`/asset-history/${ASSET_ID}?range=7d&points=kw`);
}

/** The last non-null value of a series. */
export function lastValueIsTheLastNonNull(): void {
  expect(lastValue([{ v: 1 }, { v: 4 }, { v: null }])).toBe(4);
}

/** A series with no value has no last value. */
export function lastValueIsNullWhenNone(): void {
  expect(lastValue([{ v: null }, { v: null }])).toBeNull();
  expect(lastValue([])).toBeNull();
}

const FROM = "2026-10-31T06:30:00.000Z";
const TO = "2026-11-01T06:30:00.000Z";

/** The window line: both ends in the zone, the fold width, and the zone. */
export function theWindowLabelNames30MinBuckets(): void {
  expect(stripWindowLabel(FROM, TO, 1800, "Asia/Kolkata")).toBe(
    `${formatInZone(FROM, "Asia/Kolkata")} – ${formatInZone(TO, "Asia/Kolkata")} · 30 min buckets · Asia/Kolkata`,
  );
}

/** The 7 d fold prints as `formatBucketWidth` says: `3 hours`. */
export function theWindowLabelNames3HourBuckets(): void {
  expect(stripWindowLabel(FROM, TO, 10800, "Asia/Kolkata")).toBe(
    `${formatInZone(FROM, "Asia/Kolkata")} – ${formatInZone(TO, "Asia/Kolkata")} · 3 hours buckets · Asia/Kolkata`,
  );
}

/** A stored `UTC` is reported as `UTC` and formatted on `Etc/UTC`. */
export function aUtcZoneIsReportedAsUtc(): void {
  expect(stripWindowLabel(FROM, TO, 1800, "UTC")).toBe(
    `${formatInZone(FROM, "Etc/UTC")} – ${formatInZone(TO, "Etc/UTC")} · 30 min buckets · UTC`,
  );
}

// `F4.306` U9 (ADR 0108 Amendment 7, items 4 and 7) — the selection: the stroke role of each point
// and the two query keys the read carries.

const COLORS = { "seg-one:kw": "series-2", "seg-two:temp_c": "series-7" } as const;

/** A `colors` entry for `<domain>:<code>` is that point's stroke role. */
export function aColorsHitReturnsItsRole(): void {
  expect(strokeRoleFor(COLORS, "seg-one", "kw")).toBe("series-2");
  expect(strokeRoleFor(COLORS, "seg-two", "temp_c")).toBe("series-7");
}

/** A point with no entry draws `accent`, the `F4.305` stroke. */
export function aColorsMissReturnsAccent(): void {
  expect(strokeRoleFor(COLORS, "seg-one", "kwh")).toBe("accent");
}

/** No `colors` at all draws `accent`. */
export function undefinedColorsReturnAccent(): void {
  expect(strokeRoleFor(undefined, "seg-one", "kw")).toBe("accent");
}

/** The key is the segment's own: the same code in another segment draws `accent`. */
export function anotherSegmentsKeyReturnsAccent(): void {
  expect(strokeRoleFor(COLORS, "seg-two", "kw")).toBe("accent");
}

/** No selection is exactly `range=24h`: the bytes every stored `F4.305` widget sends. */
export function noSelectionSearchIsTheF4305Bytes(): void {
  expect(trendStripSearch({ range: "24h", assetGroupId: null }).toString()).toBe("range=24h");
}

/** `segments` and `points` go comma-joined, one key each. */
export function aSelectionSearchCarriesSegmentsAndPoints(): void {
  const params = trendStripSearch({ range: "24h", assetGroupId: null, segments: ["a", "b"], points: ["a:x"] });
  expect(params.toString()).toBe("range=24h&segments=a%2Cb&points=a%3Ax");
  expect(params.get("segments")).toBe("a,b");
  expect(params.get("points")).toBe("a:x");
}

/** An empty list sends no key: the route's `.min(1)` would refuse an empty one. */
export function anEmptyListSendsNoKey(): void {
  const params = trendStripSearch({ range: "7d", assetGroupId: null, segments: [], points: [] });
  expect(params.has("segments")).toBe(false);
  expect(params.has("points")).toBe(false);
  expect(params.toString()).toBe("range=7d");
}

// ---- `F4.322` PR 3 (ADR 0108 Amendment 8) — the area and bar styles -------------------------

/** An area is each polyline run closed down to the bottom; a `null` still breaks it. */
export function anAreaClosesEachRunToTheBottom(): void {
  const areas = sparklineAreas([{ v: 1 }, { v: 2 }, { v: null }, { v: 3 }], 120, 36);
  expect(areas).toEqual(["0,36 0,36 40,18 40,36", "120,36 120,0 120,36"]);
  expect(sparklineAreas([{ v: null }], 120, 36)).toEqual([]);
}

/** One bar per non-null bucket, from the zero line, inside its slot. */
export function barsStandOnTheZeroLine(): void {
  expect(sparklineBars([{ v: 2 }, { v: null }, { v: 4 }], 120, 36)).toEqual([
    { x: 4, y: 18, width: 32, height: 18 },
    { x: 84, y: 0, width: 32, height: 36 },
  ]);
  expect(sparklineBars([{ v: null }], 120, 36)).toEqual([]);
}

/** A negative value hangs below the zero line; the lowest value is never an invisible bar. */
export function aNegativeBarHangsBelowZero(): void {
  expect(sparklineBars([{ v: -2 }, { v: 2 }], 120, 36)).toEqual([
    { x: 6, y: 18, width: 48, height: 18 },
    { x: 66, y: 0, width: 48, height: 18 },
  ]);
  // A constant export of -12 kW still draws: full height down from the zero line at the top.
  expect(sparklineBars([{ v: -12 }, { v: -12 }], 120, 36).map((b) => b.height)).toEqual([36, 36]);
}

/** A zero reading is data: a 1 px bar on the baseline, not a gap. */
export function aZeroBarIsStillDrawn(): void {
  expect(sparklineBars([{ v: 0 }, { v: 0 }], 120, 36).map((b) => [b.y, b.height])).toEqual([
    [35, 1],
    [35, 1],
  ]);
}

/** The style of one point, keyed like `colors`; absent is `line`. */
export function pointStyleDefaultsToLine(): void {
  expect(pointStyleFor({ "hvac:kw": "bar" }, "hvac", "kw")).toBe("bar");
  expect(pointStyleFor({ "hvac:kw": "bar" }, "electrical", "kw")).toBe("line");
  expect(pointStyleFor(undefined, "hvac", "kw")).toBe("line");
}
