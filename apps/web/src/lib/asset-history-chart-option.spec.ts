import { expect } from "vitest";

import { ROLE_TOKENS, fromTokenMap } from "../test-role-tokens";
import { buildHistoryChartOption, type HistorySeriesInput } from "./asset-history-chart-option";
import { resolveRoles } from "./theme";
import { CHART_SERIES } from "./widget-catalog";

const roles = resolveRoles(fromTokenMap(ROLE_TOKENS.light));

const FROM = Date.parse("2026-10-31T00:00:00.000Z");
const TO = Date.parse("2026-10-31T02:00:00.000Z");
const SPAN = TO - FROM;

/** A minimal read of the parts of the option these assertions look at. */
interface Shape {
  readonly xAxis: { readonly type: string; readonly min: number; readonly max: number };
  readonly yAxis: readonly { readonly name?: string }[];
  readonly legend?: {
    readonly type?: string;
    readonly data?: readonly (string | { readonly name: string; readonly icon?: string })[];
  };
  readonly series: readonly {
    readonly name: string;
    readonly type: string;
    readonly yAxisIndex: number;
    readonly itemStyle?: { readonly color?: string };
    readonly lineStyle?: { readonly type?: string; readonly color?: string };
    readonly markLine?: { readonly data?: readonly { readonly xAxis?: number }[] };
    readonly data: readonly [string, number | null][];
  }[];
}

/** The legend's entry names, whether an entry is a bare name or a styled object. */
const legendNames = (option: Shape): string[] =>
  (option.legend?.data ?? []).map((entry) => (typeof entry === "string" ? entry : entry.name));

function build(
  series: readonly HistorySeriesInput[],
  compare: { spanMs: number } | null,
  asOf: number | null = null,
): Shape {
  return buildHistoryChartOption({ from: FROM, to: TO, series, compare, roles, asOf }) as unknown as Shape;
}

const kw: HistorySeriesInput = {
  name: "kw",
  unit: "kW",
  buckets: [{ t: "2026-10-31T00:00:00.000Z", v: 1 }],
  compareBuckets: [{ t: "2026-10-30T22:00:00.000Z", v: 5 }],
};
const volts: HistorySeriesInput = { name: "v", unit: "V", buckets: [{ t: "2026-10-31T00:00:00.000Z", v: 230 }] };

/** The time axis is pinned to the window the user asked for. */
export function theXAxisIsTheRequestedWindow(): void {
  const option = build([kw], null);
  expect(option.xAxis).toMatchObject({ type: "time", min: FROM, max: TO });
}

/** Compare series are dashed and sit on the current window (their `t` shifted by the span). */
export function compareSeriesAreDashedAndShifted(): void {
  const option = build([kw], { spanMs: SPAN });
  expect(option.series).toHaveLength(2);
  const compare = option.series[1];
  expect(compare.lineStyle?.type).toBe("dashed");
  expect(compare.data).toEqual([["2026-10-31T00:00:00.000Z", 5]]);
  expect(option.series[0].lineStyle?.type).not.toBe("dashed");
}

/** No compare, no compare series. */
export function noCompareMeansNoDashedSeries(): void {
  expect(build([kw], null).series).toHaveLength(1);
}

/** The series type is the catalog's, not a literal. */
export function theSeriesTypeComesFromTheCatalog(): void {
  expect(build([kw], null).series[0].type).toBe(CHART_SERIES.line.type);
}

/** A second unit gets a second axis and `yAxisIndex: 1`. */
export function aSecondUnitGetsASecondAxis(): void {
  const option = build([kw, volts], null);
  expect(option.yAxis).toHaveLength(2);
  expect(option.series.map((s) => s.yAxisIndex)).toEqual([0, 1]);
}

/** One series (or one unit) keeps one axis. */
export function oneUnitKeepsOneAxis(): void {
  const option = build([kw, { ...kw, name: "kw2" }], null);
  expect(option.yAxis).toHaveLength(1);
  expect(option.series.map((s) => s.yAxisIndex)).toEqual([0, 0]);
}

// --- `E1.4a` (ADR 0135 Amendment 3 R-d, C2; plan R8, R9): the forecast on the chart. ---

const HOUR = 3_600_000;
/** The server's instant: 20 minutes after the window ends, so the window is live. */
const AS_OF = TO + 20 * 60_000;
/** 48 hourly buckets from the window's last hour. */
const FORECAST = Array.from({ length: 48 }, (_, i) => ({
  t: new Date(TO + i * HOUR).toISOString(),
  p10: 1 + i,
  p50: 2 + i,
  p90: 3 + i,
}));
const kwForecast: HistorySeriesInput = { ...kw, compareBuckets: null, forecast: FORECAST };

/** Three series per forecast, the axis past `to`, a legend naming both forecast entries once each, and "now" at `asOf`. */
export function aForecastAddsThreeSeriesTheLegendAndTheNowLine(): void {
  const without = build([kw], null, AS_OF);
  const option = build([kwForecast], null, AS_OF);
  expect(option.series).toHaveLength(without.series.length + 3);
  expect(option.xAxis.max).toBeGreaterThan(TO);
  expect(option.legend?.type).toBe("scroll");
  expect(legendNames(option)).toEqual(["kw", "Forecast p50", "Forecast p10–p90"]);
  // The band's entry is a shaded swatch, not a copy of its invisible lower half.
  expect(option.legend?.data?.[2]).toMatchObject({ name: "Forecast p10–p90", icon: "roundRect" });
  const nowLines = option.series.flatMap((s) => s.markLine?.data ?? []);
  expect(nowLines).toEqual([{ xAxis: AS_OF }]);
  // On the actual series, so hiding "Forecast p50" in the legend keeps the marker.
  expect(option.series.find((s) => s.markLine)?.name).toBe("kw");
}

/** Without a forecast the axis still ends at `to`, a plotted series still gets a legend, and no "now" line. */
export function noForecastKeepsTheWindowAndDrawsNoNowLine(): void {
  const option = build([kw], null, AS_OF);
  expect(option.xAxis.max).toBe(TO);
  expect(legendNames(option)).toEqual(["kw"]);
  expect(option.series.flatMap((s) => s.markLine?.data ?? [])).toEqual([]);
}

/** N11: a window that ended more than an hour before the server's `asOf` draws no forecast. */
export function aPastWindowDrawsNoForecast(): void {
  const option = build([kwForecast], null, TO + HOUR + 1);
  expect(option.series).toHaveLength(1);
  expect(option.xAxis.max).toBe(TO);
  expect(build([kwForecast], null, null).series, "no asOf, no forecast").toHaveLength(1);
}

/** A point whose unit was refused a third axis gets no forecast series either. */
export function aRefusedThirdUnitGetsNoForecast(): void {
  const third: HistorySeriesInput = { name: "pf", unit: "PF", buckets: [], forecast: FORECAST };
  const option = build([kw, volts, third], null, AS_OF);
  expect(option.series.map((s) => s.name)).toEqual(["kw", "v"]);
}

/** Two points with a forecast: each name carries its point key (R9). */
export function twoForecastsAreNamedByPoint(): void {
  const kw2: HistorySeriesInput = { ...kwForecast, name: "kw2" };
  const option = build([kwForecast, kw2], null, AS_OF);
  expect(legendNames(option)).toEqual([
    "kw",
    "kw2",
    "Forecast p50 · kw",
    "Forecast p10–p90 · kw",
    "Forecast p50 · kw2",
    "Forecast p10–p90 · kw2",
  ]);
  expect(option.series.flatMap((s) => s.markLine?.data ?? []), "one now line").toHaveLength(1);
}

/** R8 at the option: a 15-minute window keeps the buckets up to `to + 15 min` and the first past it. */
export function aShortWindowClipsTheForecast(): void {
  const option = buildHistoryChartOption({
    from: TO - 15 * 60_000,
    to: TO,
    series: [kwForecast],
    compare: null,
    roles,
    asOf: AS_OF,
  }) as unknown as Shape;
  expect(option.xAxis.max).toBe(TO + 15 * 60_000);
  const p50 = option.series.find((s) => s.name === "Forecast p50");
  // Buckets at TO and TO + 1 h: the first is inside the axis, the second the one kept past it.
  expect(p50?.data.map(([t]) => t)).toEqual([new Date(TO).toISOString(), new Date(TO + HOUR).toISOString()]);
}

const PAST = [
  { t: "2026-10-31T00:00:00.000Z", p50: 1.5 },
  { t: "2026-10-31T01:00:00.000Z", p50: 2.5 },
];
const kwPast: HistorySeriesInput = { ...kw, compareBuckets: null, pastForecast: PAST };

/**
 * `E1.4e` (ADR 0135 Amendment 4 rulings 1–2): the past forecast is a dashed line in a colour no
 * actual line uses, listed in the legend after the actual lines, on the actual's axis.
 */
export function aPastForecastIsADashedLineInAColourNoActualLineUses(): void {
  const option = build([kwPast, volts], null, AS_OF);
  const actualColours = option.series.filter((s) => s.name === "kw" || s.name === "v").map((s) => s.itemStyle?.color);
  const past = option.series.find((s) => s.name === "Past forecast (1 h ahead)");
  expect(past?.lineStyle?.type).toBe("dashed");
  expect(past?.yAxisIndex).toBe(0);
  expect(actualColours).not.toContain(past?.itemStyle?.color);
  expect(past?.data).toEqual([
    ["2026-10-31T00:00:00.000Z", 1.5],
    ["2026-10-31T01:00:00.000Z", 2.5],
  ]);
  expect(legendNames(option)).toEqual(["kw", "v", "Past forecast (1 h ahead)"]);
}

/** Unlike the live forecast, the past one is drawn on a window that ended in the past (Amendment 4). */
export function aPastWindowStillDrawsThePastForecast(): void {
  for (const asOf of [null, TO + 5 * HOUR]) {
    const option = build([kwPast], null, asOf);
    expect(option.series.map((s) => s.name)).toEqual(["kw", "Past forecast (1 h ahead)"]);
    expect(option.xAxis.max).toBe(TO);
  }
}

/** Two points with a past forecast: each is named by point and has its own colour. */
export function twoPastForecastsAreNamedByPointInTheirOwnColours(): void {
  const option = build([kwPast, { ...kwPast, name: "kw2" }], null, null);
  const pasts = option.series.filter((s) => s.name.startsWith("Past forecast"));
  expect(pasts.map((s) => s.name)).toEqual(["Past forecast (1 h ahead) · kw", "Past forecast (1 h ahead) · kw2"]);
  expect(new Set(pasts.map((s) => s.itemStyle?.color)).size).toBe(2);
}

/** No past forecast, or an empty one, adds nothing; a point refused an axis gets none. */
export function noPastForecastAddsNothing(): void {
  expect(build([{ ...kw, pastForecast: [] }], null, null).series.map((s) => s.name)).toEqual(["kw"]);
  const third: HistorySeriesInput = { name: "pf", unit: "PF", buckets: [], pastForecast: PAST };
  expect(build([kw, volts, third], null, null).series.map((s) => s.name)).toEqual(["kw", "v"]);
}

