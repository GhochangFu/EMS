import type { ForecastBucket, PastForecastBucket } from "@bms/shared";

import type { HistoryRange } from "./asset-history-range";
import { withAlpha } from "./theme";
import { CHART_SERIES } from "./widget-catalog";

/**
 * `E1.4a` / ADR 0135 Amendment 3 ruling 4, R-d, C2 (plan R7, R8, R9, R15) — how a forecast is
 * drawn on a time chart, pure: a shaded p10–p90 band and a dashed p50, in the colour the caller
 * passes — since `F4.377` a forecast colour that no actual or past line uses
 * (`forecastPalette`). Shared by the history chart (PR 2) and the `forecast` widget (`E1.4c`).
 *
 * **The band is two stacked line series.** The lower one carries `p10` and draws nothing; the
 * upper one carries `p90 − p10` with an area fill, so ECharts fills between them. Both use
 * `stackStrategy: "all"`: the default (`samesign`) does not stack a positive difference on a
 * negative base, and a cold room's band sits below zero. They share one name, so one legend
 * entry toggles both, and the lower one is out of the tooltip; the upper one's tooltip prints
 * the true `p10 – p90`, never the stacked difference.
 */
export const FORECAST_P50_NAME = "Forecast p50";
export const FORECAST_BAND_NAME = "Forecast p10–p90";

const HOUR_MS = 3_600_000;

/** The scorer writes hourly, so a forecast is read again every 15 minutes (ADR 0135 Amendment 3 R-d). */
export const FORECAST_REFETCH_MS = 15 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const FORECAST_AXIS_CAP_MS = 48 * HOUR_MS;

/** The band's fill opacity over the series colour. */
const BAND_ALPHA = 0.18;

/**
 * The legend entries for one point's forecast: the p50 as drawn, and the band as a shaded swatch.
 * Without the explicit style the band's entry would copy its first series, the invisible lower
 * half, and show a bare symbol (PR 2 code review).
 */
export function forecastLegendEntries(names: { readonly p50: string; readonly band: string }, colour: string) {
  return [
    names.p50,
    { name: names.band, icon: "roundRect", itemStyle: { color: withAlpha(colour, BAND_ALPHA * 2) } },
  ];
}

/** The series names for one point's forecast; suffixed with the point key when several points have one (R9). */
export function forecastNames(pointKey: string | null): { p50: string; band: string } {
  const suffix = pointKey === null ? "" : ` · ${pointKey}`;
  return { p50: `${FORECAST_P50_NAME}${suffix}`, band: `${FORECAST_BAND_NAME}${suffix}` };
}

const formatQuantile = (value: number): string =>
  value.toLocaleString("en-GB", { maximumFractionDigits: 2, useGrouping: false });

/** The three series for one point's forecast: the band's lower and upper halves, then the p50. */
export function forecastSeries(args: {
  readonly buckets: readonly ForecastBucket[];
  readonly colour: string;
  readonly yAxisIndex: 0 | 1;
  readonly names: { readonly p50: string; readonly band: string };
  readonly stackId: string;
}) {
  const { buckets, colour, yAxisIndex, names, stackId } = args;
  const type = CHART_SERIES.line.type;
  const band = { type, yAxisIndex, stack: stackId, stackStrategy: "all" as const, showSymbol: false, silent: true };
  return [
    {
      ...band,
      name: names.band,
      lineStyle: { color: colour, opacity: 0 },
      itemStyle: { color: colour },
      tooltip: { show: false },
      data: buckets.map((b) => [b.t, b.p10] as [string, number]),
    },
    {
      ...band,
      name: names.band,
      lineStyle: { color: colour, opacity: 0 },
      itemStyle: { color: withAlpha(colour, BAND_ALPHA) },
      areaStyle: { color: withAlpha(colour, BAND_ALPHA) },
      tooltip: {
        valueFormatter: (_value: unknown, dataIndex: number) => {
          const bucket = buckets[dataIndex];
          return bucket ? `${formatQuantile(bucket.p10)} – ${formatQuantile(bucket.p90)}` : "—";
        },
      },
      data: buckets.map((b) => [b.t, b.p90 - b.p10] as [string, number]),
    },
    {
      name: names.p50,
      type,
      yAxisIndex,
      showSymbol: false,
      itemStyle: { color: colour },
      lineStyle: { color: colour, type: "dashed" as const },
      data: buckets.map((b) => [b.t, b.p50] as [string, number]),
    },
  ];
}

/**
 * R8 (C2): the time axis's right edge with a forecast drawn. `cap` is 48 h on a span of 24 h or
 * more and the span itself below that, so a short preset's actual line stays readable. With no
 * forecast the axis ends at `to`, as before.
 */
export function forecastAxisMax(args: { readonly from: number; readonly to: number; readonly lastBucketMs: number | null }): number {
  const { from, to, lastBucketMs } = args;
  if (lastBucketMs === null) {
    return to;
  }
  const span = to - from;
  const cap = span >= DAY_MS ? FORECAST_AXIS_CAP_MS : span;
  return Math.max(to, Math.min(lastBucketMs, to + cap));
}

/** The buckets up to `xMax`, plus the first one past it, so the line reaches the edge and ECharts clips it. */
export function clipForecastToAxis(buckets: readonly ForecastBucket[], xMax: number): ForecastBucket[] {
  const firstPast = buckets.findIndex((b) => Date.parse(b.t) > xMax);
  return firstPast < 0 ? [...buckets] : buckets.slice(0, firstPast + 1);
}

/**
 * R7 and R-d, **before the fetch**, on the browser clock (plan §16 N11): a forecast is asked for
 * only beside the hourly mean (`avg`; beside `sum` or `max` it is another quantity) and only for a
 * window that ends within the last hour — any preset (a trailing window), or a custom range whose
 * `to` is no more than an hour ago.
 */
export function forecastApplies(range: HistoryRange, nowMs: number): boolean {
  if (range.fn !== "avg") {
    return false;
  }
  if (range.range !== "custom") {
    return true;
  }
  const to = range.to === undefined ? Number.NaN : Date.parse(range.to);
  return !Number.isNaN(to) && to >= nowMs - HOUR_MS;
}

/**
 * How often a **preset** window's own reads refresh while a forecast is drawn beside them: every
 * 15 minutes, the forecast's own pace, so the window's `to` keeps up with the forecast's `asOf`.
 * Without it the window froze at load, `forecastIsLive` turned false an hour later and the band
 * vanished from a page left open (PR 2 code review). A custom range keeps its fixed `to`: its
 * forecast rightly goes once the range is an hour in the past. `false` is no re-poll.
 */
export function liveWindowRefetchMs(range: HistoryRange, nowMs: number): number | false {
  return range.range !== "custom" && forecastApplies(range, nowMs) ? FORECAST_REFETCH_MS : false;
}

/** **After the fetch** (N11, R5): the window is live when its `to` is within the hour before the server's `asOf`. */
export function forecastIsLive(toMs: number, asOfMs: number | null): boolean {
  return asOfMs !== null && toMs >= asOfMs - HOUR_MS;
}

/** R15: the model's display label; an unknown model is shown as stored. */
export function modelLabel(modelName: string): string {
  if (modelName === "amazon/chronos-2") return "Chronos-2";
  if (modelName === "amazon/chronos-bolt-small") return "Chronos-Bolt";
  return modelName;
}

/**
 * `E1.4e` / ADR 0135 Amendment 4 — the past forecast: for each past hour, the p50 of the forecast
 * made 1 hour ahead (the API's rule). One dashed line, no band over the past (ruling 2), in a
 * colour the caller picks so that no actual line shares it.
 */
export const PAST_FORECAST_NAME = "Past forecast (1 h ahead)";

/** Ruling 3: what the line is, with no accuracy number. */
export const PAST_FORECAST_CAPTION = "Past forecast: made 1 h ahead of each hour · advisory";

/** The past line's name; suffixed with the point key when several points have one (R9). */
export function pastForecastName(pointKey: string | null): string {
  return pointKey === null ? PAST_FORECAST_NAME : `${PAST_FORECAST_NAME} · ${pointKey}`;
}

/**
 * Beside the hourly mean only (a forecast is an hourly mean, R7), but on **any** window, a past
 * custom range included: the point of the line is to look back (Amendment 4).
 */
export function pastForecastApplies(range: HistoryRange): boolean {
  return range.fn === "avg";
}

/**
 * The past line's one series. The API leaves out an hour with no forecast made 1 h ahead; every
 * such hour between the first and the last bucket is a `null` here, so the line breaks there
 * rather than joining across the gap. No buckets, no series.
 */
export function pastForecastSeries(args: {
  readonly buckets: readonly PastForecastBucket[];
  readonly colour: string;
  readonly yAxisIndex: 0 | 1;
  readonly name: string;
}) {
  const { buckets, colour, yAxisIndex, name } = args;
  if (buckets.length === 0) {
    return [];
  }
  const byHour = new Map(buckets.map((b) => [Date.parse(b.t), b.p50]));
  const first = Date.parse(buckets[0]?.t ?? "");
  const last = Date.parse(buckets.at(-1)?.t ?? "");
  const data: [string, number | null][] = [];
  for (let ms = first; ms <= last; ms += HOUR_MS) {
    data.push([new Date(ms).toISOString(), byHour.get(ms) ?? null]);
  }
  return [
    {
      name,
      type: CHART_SERIES.line.type,
      yAxisIndex,
      showSymbol: false,
      connectNulls: false,
      itemStyle: { color: colour },
      lineStyle: { color: colour, type: "dashed" as const },
      data,
    },
  ];
}

/**
 * The window a past read asks for: `from` floored and `to` raised to whole UTC hours. The server
 * floors `from` and serves buckets before `to`, so either form returns the same hours; rounding
 * keeps a live window's 15-minute moves inside one query key, so the line does not blink out on
 * each refresh, and the read runs again only when the hour turns.
 */
export function pastForecastWindow(window: { readonly from: string; readonly to: string }): { from: string; to: string } {
  const from = Math.floor(Date.parse(window.from) / HOUR_MS) * HOUR_MS;
  const to = Math.ceil(Date.parse(window.to) / HOUR_MS) * HOUR_MS;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

