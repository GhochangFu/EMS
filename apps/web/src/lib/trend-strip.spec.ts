import { expect } from "vitest";

import { formatInZone } from "../components/asset-history/history-format";
import { historyHref, lastValue, sparklinePolylines, stripWindowLabel } from "./trend-strip";

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
