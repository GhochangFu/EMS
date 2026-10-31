import { expect } from "vitest";

import { MAX_WIDGET_POINTS } from "@bms/shared";

import {
  HISTORY_PRESETS,
  MAX_HISTORY_POINTS,
  axisForUnit,
  instantToLocalInput,
  localInputToInstant,
  rangeFromSearch,
  rangeToQuery,
  rangeToSearch,
  shiftCompareBuckets,
  type HistoryRange,
} from "./asset-history-range";

/**
 * `F4.297` U4 (ADR 0108) — the asset history page's URL state, request shape and axis rules.
 * Pure: `now` is a parameter. The `.test.ts` wrapper pins `TZ=America/St_Johns` so a helper
 * that read the browser offset would give a different instant than the site zone.
 */

const NOW = Date.parse("2026-10-31T12:00:00.000Z");

const CUSTOM: HistoryRange = {
  range: "custom",
  from: "2026-10-30T00:00:00.000Z",
  to: "2026-10-31T00:00:00.000Z",
  compare: true,
  points: ["kw", "pf"],
  fn: "max",
};

/** A range written to the URL reads back equal. */
export function theRangeRoundTripsThroughTheUrl(): void {
  const preset: HistoryRange = { range: "7d", compare: true, points: ["kw"], fn: "avg" };
  expect(rangeFromSearch(rangeToSearch(preset))).toEqual(preset);
  expect(rangeFromSearch(rangeToSearch(CUSTOM))).toEqual(CUSTOM);
}

/** The five presets of the plan, with their minutes. */
export function thePresetsAreTheFivePlanned(): void {
  expect(HISTORY_PRESETS.map((p) => [p.key, p.minutes])).toEqual([
    ["15m", 15],
    ["24h", 1440],
    ["7d", 10080],
    ["30d", 43200],
    ["1y", 525600],
  ]);
}

/** A preset asks for a trailing window only. */
export function aPresetQueryIsATrailingWindow(): void {
  expect(rangeToQuery({ range: "24h", compare: false, points: [], fn: "avg" }, NOW)).toEqual({ windowMinutes: 1440 });
}

/** A custom range asks for `from`/`to` as ISO instants and no `windowMinutes`. */
export function aCustomQueryCarriesBothInstants(): void {
  const query = rangeToQuery(CUSTOM, NOW);
  expect(query).toEqual({ from: "2026-10-30T00:00:00.000Z", to: "2026-10-31T00:00:00.000Z" });
  expect("windowMinutes" in query).toBe(false);
}

/** An unknown range, and a custom range missing an end, fall back to 24 h. */
export function anUnknownOrHalfRangeFallsBackTo24h(): void {
  expect(rangeFromSearch(new URLSearchParams("range=3w")).range).toBe("24h");
  expect(rangeFromSearch(new URLSearchParams("")).range).toBe("24h");
  expect(rangeFromSearch(new URLSearchParams("from=2026-10-30T00:00:00.000Z")).range).toBe("24h");
  expect(rangeFromSearch(new URLSearchParams("from=nope&to=also")).range).toBe("24h");
  expect(rangeFromSearch(new URLSearchParams("fn=median")).fn).toBe("avg");
}

/** The cap is the widget's, imported, and the URL cannot lift it. */
export function pointsAreCappedAtTheWidgetLimit(): void {
  expect(MAX_HISTORY_POINTS).toBe(MAX_WIDGET_POINTS);
  const many = Array.from({ length: MAX_WIDGET_POINTS + 4 }, (_, i) => `p${i}`).join(",");
  const parsed = rangeFromSearch(new URLSearchParams({ points: many }));
  expect(parsed.points).toHaveLength(MAX_HISTORY_POINTS);
  expect(parsed.points[0]).toBe("p0");
}

/** A repeated key is listed once. */
export function pointsAreDeduplicated(): void {
  expect(rangeFromSearch(new URLSearchParams("points=kw,kw,pf,")).points).toEqual(["kw", "pf"]);
}

/** Each compare bucket moves by exactly the span. */
export function shiftCompareBucketsMovesByExactlyTheSpan(): void {
  const span = 3_600_000;
  const shifted = shiftCompareBuckets(
    [
      { t: "2026-10-31T09:00:00.000Z", v: 1 },
      { t: "2026-10-31T10:00:00.000Z", v: null },
    ],
    span,
  );
  expect(shifted).toEqual([
    { t: "2026-10-31T10:00:00.000Z", v: 1 },
    { t: "2026-10-31T11:00:00.000Z", v: null },
  ]);
}

/** Two units get two axes; a third distinct unit is refused. */
export function aThirdUnitIsRefused(): void {
  expect(axisForUnit([], "kW")).toBe("left");
  expect(axisForUnit(["kW"], "kW")).toBe("left");
  expect(axisForUnit(["kW"], "V")).toBe("right");
  expect(axisForUnit(["kW", "V"], "V")).toBe("right");
  expect(axisForUnit(["kW", "V", "kW"], "A")).toBe("refused");
  expect(axisForUnit(["kW"], null)).toBe("right");
}

/** The picker value is wall time in the site zone, not the browser's (TZ pinned by the wrapper). */
export function aLocalInputIsReadInTheSiteZone(): void {
  expect(localInputToInstant("2026-10-31T00:00", "Asia/Kolkata")).toBe("2026-10-30T18:30:00.000Z");
  expect(instantToLocalInput("2026-10-30T18:30:00.000Z", "Asia/Kolkata")).toBe("2026-10-31T00:00");
  expect(localInputToInstant("garbage", "Asia/Kolkata")).toBeNull();
}
