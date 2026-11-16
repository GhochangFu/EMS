import { expect } from "vitest";

import type { ForecastBucket } from "@bms/shared";

import type { HistoryRange } from "./asset-history-range";
import {
  FORECAST_BAND_NAME,
  FORECAST_P50_NAME,
  clipForecastToAxis,
  forecastApplies,
  forecastAxisMax,
  forecastIsLive,
  forecastLegendEntries,
  forecastNames,
  FORECAST_REFETCH_MS,
  liveWindowRefetchMs,
  forecastSeries,
  modelLabel,
  PAST_FORECAST_CAPTION,
  PAST_FORECAST_NAME,
  pastForecastApplies,
  pastForecastName,
  pastForecastSeries,
  pastForecastWindow,
} from "./forecast-series";

/**
 * `E1.4a` / ADR 0135 Amendment 3 ruling 4, R-d, C2 (plan R7, R8, R9, R15) — the forecast's
 * ECharts series and the axis rule, pure. Assertions live here; `forecast-series.test.ts` is the
 * Vitest entry point (ADR 0014).
 */
const HOUR = 3_600_000;
const NOW = Date.parse("2026-11-16T10:20:00.000Z");
const HOUR_0 = Date.parse("2026-11-16T10:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();

/** `count` hourly buckets from the current hour, p50 = `p50(i)`, the band ±1 around it. */
const buckets = (count: number, p50: (i: number) => number = (i) => 10 + i): ForecastBucket[] =>
  Array.from({ length: count }, (_, i) => ({ t: iso(HOUR_0 + i * HOUR), p10: p50(i) - 1, p50: p50(i), p90: p50(i) + 1 }));

const COLOUR = "rgb(10, 20, 30)";

type Series = {
  name: string;
  type: string;
  stack?: string;
  stackStrategy?: string;
  yAxisIndex: number;
  lineStyle?: { color?: string; type?: string; opacity?: number };
  areaStyle?: { color?: string };
  tooltip?: { show?: boolean; valueFormatter?: (value: unknown, dataIndex: number) => string };
  data: [string, number][];
};

const build = (input: ForecastBucket[]): Series[] =>
  forecastSeries({ buckets: input, colour: COLOUR, yAxisIndex: 1, names: forecastNames(null), stackId: "s" }) as unknown as Series[];

const range = (over: Partial<HistoryRange> = {}): HistoryRange => ({
  range: "24h",
  compare: false,
  points: [],
  fn: "avg",
  ...over,
});

/** The band over negative values (a cold room): lower is p10, upper is p90 − p10, stacked with strategy "all". */
export function theBandStacksAcrossSigns(): void {
  const series = build([{ t: iso(HOUR_0), p10: -20, p50: -18, p90: -16 }]);
  expect(series).toHaveLength(3);
  const [lower, upper, p50] = series as [Series, Series, Series];
  expect(lower.data).toEqual([[iso(HOUR_0), -20]]);
  expect(upper.data).toEqual([[iso(HOUR_0), 4]]);
  for (const band of [lower, upper]) {
    expect(band.stack).toBe("s");
    expect(band.stackStrategy).toBe("all");
    expect(band.lineStyle?.opacity).toBe(0);
  }
  expect(upper.areaStyle?.color).toBe("rgba(10, 20, 30, 0.18)");
  expect(lower.areaStyle).toBeUndefined();
  expect(p50.data).toEqual([[iso(HOUR_0), -18]]);
  expect(p50.stack).toBeUndefined();
  for (const s of series) expect(s.yAxisIndex).toBe(1);
}

/** The p50 is dashed in the point's own colour; the band's tooltip prints the true p10 – p90. */
export function theP50IsDashedAndTheBandTooltipIsTheTrueRange(): void {
  const [lower, upper, p50] = build([
    { t: iso(HOUR_0), p10: -20, p50: -18, p90: -16 },
    { t: iso(HOUR_0 + HOUR), p10: 1.234, p50: 2, p90: 3.5 },
  ]) as [Series, Series, Series];
  expect(p50.name).toBe(FORECAST_P50_NAME);
  expect(p50.lineStyle).toMatchObject({ color: COLOUR, type: "dashed" });
  expect(lower.tooltip?.show, "the hidden lower series is not in the tooltip").toBe(false);
  expect(upper.name).toBe(FORECAST_BAND_NAME);
  expect(lower.name, "one legend entry toggles both band series").toBe(FORECAST_BAND_NAME);
  const format = upper.tooltip?.valueFormatter;
  expect(format?.([iso(HOUR_0), 4], 0)).toBe("-20 – -16");
  expect(format?.([iso(HOUR_0 + HOUR), 2.266], 1)).toBe("1.23 – 3.5");
}

/** Names carry the point key when more than one point has a forecast (R9). */
export function namesAreSuffixedForMoreThanOnePoint(): void {
  expect(forecastNames(null)).toEqual({ p50: "Forecast p50", band: "Forecast p10–p90" });
  expect(forecastNames("kw")).toEqual({ p50: "Forecast p50 · kw", band: "Forecast p10–p90 · kw" });
}

/** R8: the last bucket on a 24 h span, `to + span` on a 15 min span, and `to` with no forecast. */
export function theAxisMaxFollowsTheCap(): void {
  const to = NOW;
  const last = HOUR_0 + 47 * HOUR;
  expect(forecastAxisMax({ from: to - 24 * HOUR, to, lastBucketMs: last })).toBe(last);
  expect(forecastAxisMax({ from: to - 30 * 24 * HOUR, to, lastBucketMs: last })).toBe(last);
  expect(forecastAxisMax({ from: to - 15 * 60_000, to, lastBucketMs: last })).toBe(to + 15 * 60_000);
  expect(forecastAxisMax({ from: to - 24 * HOUR, to, lastBucketMs: null })).toBe(to);
  // A forecast that ends before `to` never pulls the axis in.
  expect(forecastAxisMax({ from: to - 24 * HOUR, to, lastBucketMs: to - HOUR })).toBe(to);
  // The cap is 48 h past `to`, even for a longer forecast.
  expect(forecastAxisMax({ from: to - 24 * HOUR, to, lastBucketMs: to + 60 * HOUR })).toBe(to + 48 * HOUR);
}

/** Buckets past the axis are dropped except the first, so the line runs to the edge and is clipped there. */
export function onePastTheAxisIsKeptAndTheRestDropped(): void {
  const all = buckets(5);
  const xMax = HOUR_0 + 2 * HOUR + 15 * 60_000;
  expect(clipForecastToAxis(all, xMax).map((b) => b.t)).toEqual([0, 1, 2, 3].map((i) => iso(HOUR_0 + i * HOUR)));
  expect(clipForecastToAxis(all, HOUR_0 + 10 * HOUR)).toEqual(all);
  expect(clipForecastToAxis([], xMax)).toEqual([]);
}

/** R7 and R-d before the fetch: a preset with avg, never a past custom range, never max (N11: the browser clock). */
export function forecastAppliesToALiveAverage(): void {
  expect(forecastApplies(range(), NOW)).toBe(true);
  expect(forecastApplies(range({ range: "15m" }), NOW)).toBe(true);
  expect(forecastApplies(range({ fn: "max" }), NOW)).toBe(false);
  expect(forecastApplies(range({ fn: "sum" }), NOW)).toBe(false);
  const custom = (toMs: number) => range({ range: "custom", from: iso(toMs - 24 * HOUR), to: iso(toMs) });
  expect(forecastApplies(custom(NOW - 2 * HOUR), NOW), "a custom range that ended 2 h ago").toBe(false);
  expect(forecastApplies(custom(NOW - 30 * 60_000), NOW), "one that ended 30 min ago").toBe(true);
}

/** N11 after the fetch: the server's `asOf` decides whether the window is live. */
export function theServerClockDecidesLiveness(): void {
  const asOf = NOW;
  expect(forecastIsLive(asOf, asOf)).toBe(true);
  expect(forecastIsLive(asOf - HOUR, asOf)).toBe(true);
  expect(forecastIsLive(asOf - HOUR - 1, asOf)).toBe(false);
  expect(forecastIsLive(asOf - 1, null)).toBe(false);
}

/** R15: the two Hub names map to their labels; anything else is shown as stored. */
export function theModelLabelMapsTheKnownNames(): void {
  expect(modelLabel("amazon/chronos-2")).toBe("Chronos-2");
  expect(modelLabel("amazon/chronos-bolt-small")).toBe("Chronos-Bolt");
  expect(modelLabel("acme/forecaster-9")).toBe("acme/forecaster-9");
}

/** A live preset's own reads refresh at the forecast's pace; a custom range and a `max` page do not. */
export function aLivePresetRefreshesAtTheForecastsPace(): void {
  expect(FORECAST_REFETCH_MS).toBe(900_000);
  expect(liveWindowRefetchMs(range(), NOW)).toBe(FORECAST_REFETCH_MS);
  expect(liveWindowRefetchMs(range({ fn: "max" }), NOW)).toBe(false);
  expect(liveWindowRefetchMs(range({ range: "custom", from: iso(NOW - HOUR), to: iso(NOW) }), NOW)).toBe(false);
}

/** The band's legend entry is a shaded swatch in the point's colour. */
export function theBandsLegendEntryIsAShadedSwatch(): void {
  expect(forecastLegendEntries(forecastNames(null), COLOUR)).toEqual([
    "Forecast p50",
    { name: "Forecast p10–p90", icon: "roundRect", itemStyle: { color: "rgba(10, 20, 30, 0.36)" } },
  ]);
}

/**
 * `E1.4e` (ADR 0135 Amendment 4 ruling 2): the past forecast is one dashed p50 line in the colour
 * it is given. An hour the API left out (no forecast made 1 h ahead) is a `null`, so ECharts
 * breaks the line there instead of joining across the gap.
 */
export function thePastForecastIsADashedLineThatBreaksAtAMissingHour(): void {
  const [line] = pastForecastSeries({
    buckets: [
      { t: "2026-10-31T00:00:00.000Z", p50: 1 },
      { t: "2026-10-31T01:00:00.000Z", p50: 2 },
      { t: "2026-10-31T03:00:00.000Z", p50: 4 },
    ],
    colour: "#123456",
    yAxisIndex: 1,
    name: PAST_FORECAST_NAME,
  });
  expect(line).toMatchObject({
    name: "Past forecast (1 h ahead)",
    yAxisIndex: 1,
    showSymbol: false,
    connectNulls: false,
    itemStyle: { color: "#123456" },
    lineStyle: { color: "#123456", type: "dashed" },
  });
  expect(line?.data).toEqual([
    ["2026-10-31T00:00:00.000Z", 1],
    ["2026-10-31T01:00:00.000Z", 2],
    ["2026-10-31T02:00:00.000Z", null],
    ["2026-10-31T03:00:00.000Z", 4],
  ]);
  expect(pastForecastSeries({ buckets: [], colour: "#123456", yAxisIndex: 0, name: "x" })).toEqual([]);
}

/** Named by point when more than one point has one (R9), and captioned without a number (ruling 3). */
export function thePastForecastIsNamedAndCaptionedWithoutANumber(): void {
  expect(pastForecastName(null)).toBe("Past forecast (1 h ahead)");
  expect(pastForecastName("kw")).toBe("Past forecast (1 h ahead) · kw");
  expect(PAST_FORECAST_CAPTION).toBe("Past forecast: made 1 h ahead of each hour · advisory");
  expect(PAST_FORECAST_CAPTION).not.toMatch(/\d+\s*%|error|accura/i);
}

/** Beside the hourly mean only, as the live forecast; but on any window, a past custom range too. */
export function thePastForecastAppliesBesideAvgOnAnyWindow(): void {
  const base = { points: ["kw"], compare: false } as const;
  expect(pastForecastApplies({ ...base, range: "24h", fn: "avg" } as HistoryRange)).toBe(true);
  expect(
    pastForecastApplies({
      ...base,
      range: "custom",
      fn: "avg",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-02T00:00:00.000Z",
    } as HistoryRange),
  ).toBe(true);
  expect(pastForecastApplies({ ...base, range: "24h", fn: "max" } as HistoryRange)).toBe(false);
  expect(pastForecastApplies({ ...base, range: "24h", fn: "sum" } as HistoryRange)).toBe(false);
}

/**
 * The window a past read is asked for: `from` floored and `to` raised to whole UTC hours. The
 * server answers the same buckets for either form, and a live window's 15-minute moves stay inside
 * one query key, so the line does not blink out on every refresh (PR #1365 code review).
 */
export function thePastWindowIsRoundedToWholeHours(): void {
  expect(pastForecastWindow({ from: "2026-11-15T10:20:00.000Z", to: "2026-11-16T10:20:00.000Z" })).toEqual({
    from: "2026-11-15T10:00:00.000Z",
    to: "2026-11-16T11:00:00.000Z",
  });
  expect(pastForecastWindow({ from: "2026-11-15T10:00:00.000Z", to: "2026-11-16T10:00:00.000Z" })).toEqual({
    from: "2026-11-15T10:00:00.000Z",
    to: "2026-11-16T10:00:00.000Z",
  });
  expect(pastForecastWindow({ from: "2026-11-16T10:20:00.000Z", to: "2026-11-16T10:35:00.000Z" })).toEqual(
    pastForecastWindow({ from: "2026-11-16T10:05:00.000Z", to: "2026-11-16T10:50:00.000Z" }),
  );
}

