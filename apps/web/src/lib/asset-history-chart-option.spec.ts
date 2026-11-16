import { expect } from "vitest";

import { ROLE_TOKENS, fromTokenMap } from "../test-role-tokens";
import type { AnomalyScore } from "@bms/shared";

import { ANOMALY_MARK_NAME } from "./anomaly-series";
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
const legendNames = (option: Pick<Shape, "legend">): string[] =>
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

/**
 * Ruling 2 holds with several points: the past lines take the chart's spare series roles, which
 * no actual line uses, so no past line ever shares a colour with an actual one (compliance review:
 * the six-colour actual palette wraps).
 */
export function pastColoursNeverMatchAnActualColour(): void {
  const points = ["a", "b", "c", "d"].map((name) => ({ ...kwPast, name }));
  const option = build(points, null, null);
  const actual = option.series.filter((s) => !s.name.startsWith("Past forecast")).map((s) => s.itemStyle?.color);
  const past = option.series.filter((s) => s.name.startsWith("Past forecast")).map((s) => s.itemStyle?.color);
  expect(past).toHaveLength(4);
  expect(past.filter((c) => actual.includes(c))).toEqual([]);
  expect(new Set(past).size).toBe(4);
}

// --- `F4.377` (the owner's AWS check, 2026-11-16): the forecast is not drawn in the actual's colour. ---

/** A point with all three: actual buckets, a live forecast and a past forecast. */
const kwAll: HistorySeriesInput = { ...kw, compareBuckets: null, forecast: FORECAST, pastForecast: PAST };

/** The colour each kind of line is drawn in, read from the series as built. */
function coloursOf(option: Shape): { actual: string[]; past: string[]; bandBase: string[]; p50: string[] } {
  const isPast = (name: string) => name.startsWith("Past forecast");
  const isP50 = (name: string) => name.startsWith("Forecast p50");
  const isBand = (name: string) => name.startsWith("Forecast p10–p90");
  const colour = (s: Shape["series"][number]) => s.lineStyle?.color ?? s.itemStyle?.color ?? "";
  // The band's lower half carries the base colour; the upper half is that colour with alpha.
  const bandSeries = option.series.filter((s) => isBand(s.name));
  return {
    actual: option.series.filter((s) => !isPast(s.name) && !isP50(s.name) && !isBand(s.name)).map(colour),
    past: option.series.filter((s) => isPast(s.name)).map(colour),
    bandBase: bandSeries.filter((_, i) => i % 2 === 0).map((s) => s.itemStyle?.color ?? ""),
    p50: option.series.filter((s) => isP50(s.name)).map(colour),
  };
}

/**
 * The owner's ruling (2026-11-16, three colours): with one point the actual line is `series-1`, the
 * past forecast `series-2` and the live forecast — its dashed p50 and its p10–p90 band — its own
 * colour. `F4.381` (the owner's ruling, 2026-11-16): the three are each ΔE2000 ≥ 20 apart, so in
 * this (default light) theme the live forecast is `series-4`: `series-3` (`#6B21A8`) is only 16.1
 * from `series-1` (`#1D4ED8`).
 */
export function onePointDrawsActualPastAndFutureInThreeColours(): void {
  const option = build([kwAll], null, AS_OF);
  const c = coloursOf(option);
  const live = roles["series-4"];
  expect(c.actual).toEqual([roles["series-1"]]);
  expect(c.past).toEqual([roles["series-2"]]);
  expect(c.p50).toEqual([live]);
  expect(c.bandBase).toEqual([live]);
  // The band's shaded half and its legend swatch are the forecast colour with alpha, never the actual's.
  const upper = option.series.filter((s) => s.name === "Forecast p10–p90")[1];
  expect(upper?.itemStyle?.color?.startsWith(live.replace(/^rgb\((.*)\)$/, "rgba($1"))).toBe(true);
  const swatch = option.legend?.data?.find((entry) => typeof entry !== "string" && entry.name === "Forecast p10–p90");
  expect(JSON.stringify(swatch)).toContain(live.replace(/^rgb\((.*)\)$/, "rgba($1"));
}

/**
 * With several points no forecast colour is any actual line's colour, no live-forecast colour is
 * any past line's colour, and each point's forecast has its own colour (traced by the legend's
 * point key, R9) — up to the palette's length, and it never wraps into another kind's colours.
 */
export function forecastColoursNeverMatchActualOrPastWithSeveralPoints(): void {
  for (const count of [2, 3, 6]) {
    const points = Array.from({ length: count }, (_, i) => ({ ...kwAll, name: `p${i}` }));
    const c = coloursOf(build(points, null, AS_OF));
    expect(c.p50, `${count} points`).toHaveLength(count);
    expect(c.p50, `${count} points: band and p50 match per point`).toEqual(c.bandBase);
    const future = new Set(c.p50);
    expect(c.actual.filter((x) => future.has(x)), `${count} points: future vs actual`).toEqual([]);
    expect(c.past.filter((x) => future.has(x)), `${count} points: future vs past`).toEqual([]);
    expect(c.actual.filter((x) => c.past.includes(x)), `${count} points: past vs actual`).toEqual([]);
    if (count <= 3) {
      expect(future.size, `${count} points: one colour per point`).toBe(count);
    }
  }
}

/** The legend names each point's live forecast and past forecast by its point key, so each traces to its point. */
export function eachForecastIsTracedToItsPointInTheLegend(): void {
  const option = build([kwAll, { ...kwAll, name: "kw2" }], null, AS_OF);
  expect(legendNames(option)).toEqual([
    "kw",
    "kw2",
    "Past forecast (1 h ahead) · kw",
    "Past forecast (1 h ahead) · kw2",
    "Forecast p50 · kw",
    "Forecast p10–p90 · kw",
    "Forecast p50 · kw2",
    "Forecast p10–p90 · kw2",
  ]);
}

// --- `F4.379` (the owner's AWS check, 2026-11-16): no float noise in the chart's tooltip. ---

interface TooltipShape {
  readonly tooltip?: { readonly valueFormatter?: (value: unknown, dataIndex: number) => string };
}

/**
 * The tooltip prints a value as the Latest cell does: the float's binary tail dropped
 * (`0.30000000000000004` → `0.3`), every real digit kept (`49.96` stays `49.96`).
 */
export function theTooltipDropsFloatNoiseAndKeepsRealDigits(): void {
  const option = buildHistoryChartOption({ from: FROM, to: TO, series: [kw], compare: null, roles }) as unknown as TooltipShape;
  const format = option.tooltip?.valueFormatter;
  expect(format).toBeTypeOf("function");
  expect(format?.(0.3000000000000007, 0)).toBe("0.3");
  expect(format?.(-6.3999999999999995, 0)).toBe("-6.4");
  expect(format?.(1.0000000000000009, 0)).toBe("1");
  expect(format?.(49.96, 0)).toBe("49.96");
  expect(format?.(0.0125, 0)).toBe("0.0125");
  expect(format?.(Math.fround(12.3), 0), "a float32 register").toBe("12.3");
  expect(format?.(125000, 0), "grouped as ECharts' default was").toBe("125,000");
  expect(format?.(null, 0)).toBe("-");
  expect(format?.(["2026-10-31T00:00:00.000Z", 0.1 + 0.2], 0), "a [t, v] pair formats its value").toBe("0.3");
}

/** `F4.382` — the tooltip prints float noise around zero as `0`, and keeps a real small reading. */
export function theTooltipPrintsNoiseAroundZeroAsZero(): void {
  const option = buildHistoryChartOption({ from: FROM, to: TO, series: [kw], compare: null, roles }) as unknown as TooltipShape;
  const format = option.tooltip?.valueFormatter;
  expect(format?.(8.881784197001252e-16, 0)).toBe("0");
  expect(format?.(-8.881784197001252e-16, 0)).toBe("0");
  expect(format?.(["2026-10-31T00:00:00.000Z", 8.881784197001252e-16], 0)).toBe("0");
  expect(format?.(0.0001, 0)).toBe("0.0001");
}

/** `E1.2b` — one asset's scores: 00:00 unusual by the forest, 01:00 just under the line, 03:00 outside the window. */
const SCORES: readonly AnomalyScore[] = [
  { t: "2026-10-31T00:00:00.000Z", detector: "baseline_mad", score: 0.42, contributingPoints: ["kw"] },
  { t: "2026-10-31T00:00:00.000Z", detector: "isolation_forest", score: 0.9931, contributingPoints: ["kw", "v"] },
  { t: "2026-10-31T01:00:00.000Z", detector: "baseline_mad", score: 0.9899, contributingPoints: ["kw"] },
  { t: "2026-10-31T03:00:00.000Z", detector: "baseline_mad", score: 1, contributingPoints: ["kw"] },
];

type MarkShape = Omit<Shape, "yAxis" | "series"> & {
  readonly yAxis: readonly { readonly name?: string; readonly show?: boolean; readonly min?: number; readonly max?: number }[];
  readonly series: readonly (Shape["series"][number] & {
    readonly tooltip?: { readonly valueFormatter?: (v: unknown, i: number) => string };
  })[];
};

function buildMarks(series: readonly HistorySeriesInput[], anomalies: readonly AnomalyScore[] | null, asOf: number | null = null): MarkShape {
  return buildHistoryChartOption({ from: FROM, to: TO, series, compare: null, roles, asOf, anomalies }) as unknown as MarkShape;
}

/**
 * `E1.2b` / ADR 0135 Amendment 5 ruling 4(b) — an unusual hour adds exactly one series, named in
 * the legend, a scatter in `ink` on a hidden 0..1 third y axis, one item per unusual hour inside
 * the window at the hour's start and its score; the existing axes and series are untouched.
 */
export function anUnusualHourAddsOneMarkSeriesAndALegendEntry(): void {
  const without = buildMarks([kw, volts], null);
  const option = buildMarks([kw, volts], SCORES);
  expect(option.series).toHaveLength(without.series.length + 1);
  expect(option.series.slice(0, without.series.length)).toEqual(without.series);
  expect(legendNames(option)).toEqual([...legendNames(without), ANOMALY_MARK_NAME]);
  const mark = option.series.at(-1);
  expect(mark).toMatchObject({ name: ANOMALY_MARK_NAME, type: CHART_SERIES.scatter.type, yAxisIndex: 2 });
  expect(mark?.itemStyle?.color).toBe(roles.ink);
  expect(mark?.data).toEqual([["2026-10-31T00:00:00.000Z", 0.9931]]);
  expect(option.yAxis).toHaveLength(3);
  expect(option.yAxis.slice(0, 2)).toEqual(without.yAxis);
  expect(option.yAxis[2]).toMatchObject({ type: "value", show: false, min: 0, max: 1 });
}

/** One unit: the hidden axis is the second, and nothing else moves. */
export function oneUnitPutsTheMarksOnASecondHiddenAxis(): void {
  const option = buildMarks([kw], SCORES);
  expect(option.yAxis).toHaveLength(2);
  expect(option.yAxis[1]).toMatchObject({ show: false, min: 0, max: 1 });
  expect(option.series.at(-1)?.yAxisIndex).toBe(1);
}

/** No unusual hour — no scores, all under the line, or all outside the window — no series, no axis, no legend entry. */
export function noUnusualHourAddsNothing(): void {
  const without = buildMarks([kw], null);
  for (const anomalies of [[], SCORES.filter((s) => s.score < 0.99), [SCORES[3]]]) {
    expect(buildMarks([kw], anomalies)).toEqual(without);
  }
}

/** The mark's tooltip value holds the score, the detector labels and the point keys. */
export function theMarksTooltipHoldsScoreDetectorsAndPoints(): void {
  const mark = buildMarks([kw], SCORES).series.at(-1);
  expect(mark?.tooltip?.valueFormatter?.(0.9931, 0)).toBe("score 0.9931 · Isolation Forest · kw, v");
}

/** Beside a forecast the forecast's series, axis and legend entries are unchanged; the marks come last. */
export function marksBesideAForecastLeaveItUntouched(): void {
  const without = buildMarks([kwForecast], null, AS_OF);
  const option = buildMarks([kwForecast], SCORES, AS_OF);
  // JSON drops the band's tooltip formatter, a new closure on each build.
  expect(JSON.stringify(option.series.slice(0, without.series.length))).toBe(JSON.stringify(without.series));
  expect(option.series.at(-1)?.name).toBe(ANOMALY_MARK_NAME);
  expect(option.xAxis).toEqual(without.xAxis);
  expect(legendNames(option)).toEqual([...legendNames(without), ANOMALY_MARK_NAME]);
}
