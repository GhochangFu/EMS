import { ANOMALY_MAX_SPAN_DAYS, ANOMALY_UNUSUAL_SCORE } from "@bms/shared";
import type { AnomalyScore } from "@bms/shared";

import type { HistoryRange } from "./asset-history-range";
import { CHART_SERIES } from "./widget-catalog";

/**
 * `E1.2b` / ADR 0135 Amendment 5 ruling 4(b) — the unusual-hour marks on the asset history chart,
 * pure. An hour is unusual when the larger of its two detector scores is at or above
 * `ANOMALY_UNUSUAL_SCORE` (0.99; applied here, at read time — R18). Each mark says it is advisory;
 * nothing here raises an alarm or a notification.
 *
 * **The chart design (verified against ECharts 5.6.0, `asset-history-chart-option.echarts.spec.ts`).**
 * One scatter series on a hidden third y axis (0..1), each item at `x` = the hour's start and
 * `y` = the score. Under an axis-trigger tooltip ECharts lists only the series whose nearest point
 * is nearest the pointer (`axisTrigger.js` `buildPayloadsBySeries`), so a mark joins the tooltip
 * of the actual bucket that starts the same hour and no other. Its tooltip value is the score,
 * the detectors at or above the line and the points that drove them.
 */
export const ANOMALY_MARK_NAME = "Unusual hour (advisory)";

/** What a mark is, under the chart, shown only when at least one mark is drawn. */
export const ANOMALY_CAPTION = `Unusual hours: anomaly score ${ANOMALY_UNUSUAL_SCORE} or above · advisory`;

const HOUR_MS = 3_600_000;
const MAX_SPAN_MS = ANOMALY_MAX_SPAN_DAYS * 24 * HOUR_MS;

/** One hour of the asset: the larger score, the detectors at or above the line, their points. */
export interface AnomalyHour {
  readonly t: string;
  readonly score: number;
  readonly detectors: readonly string[];
  readonly contributingPoints: readonly string[];
}

/**
 * The scores grouped by hour, in the order the API sent them (ascending): per hour the larger
 * score, the detectors whose own score is at or above the line, and the points those detectors
 * named, each once, in first-seen order.
 */
export function anomalyHours(scores: readonly AnomalyScore[]): AnomalyHour[] {
  const byHour = new Map<string, AnomalyScore[]>();
  for (const s of scores) {
    const list = byHour.get(s.t);
    if (list === undefined) {
      byHour.set(s.t, [s]);
    } else {
      list.push(s);
    }
  }
  return [...byHour.entries()].map(([t, rows]) => {
    const flagged = rows.filter((row) => row.score >= ANOMALY_UNUSUAL_SCORE);
    return {
      t,
      score: Math.max(...rows.map((row) => row.score)),
      detectors: flagged.map((row) => row.detector),
      contributingPoints: [...new Set(flagged.flatMap((row) => row.contributingPoints))],
    };
  });
}

/** The unusual hours whose start lies inside `[from, to]` (epoch ms). */
export function unusualHours(scores: readonly AnomalyScore[], from: number, to: number): AnomalyHour[] {
  return anomalyHours(scores).filter((hour) => {
    const t = Date.parse(hour.t);
    return hour.score >= ANOMALY_UNUSUAL_SCORE && t >= from && t <= to;
  });
}

/**
 * R14, **before the fetch**: marks only beside the hourly mean (a score is about the hour's
 * readings, not a sum or a peak) and only on a window of at most 31 days, the route's cap — so
 * the `1y` preset draws none and asks for nothing.
 */
export function anomalyApplies(range: HistoryRange, spanMs: number): boolean {
  return range.fn === "avg" && Number.isFinite(spanMs) && spanMs <= MAX_SPAN_MS;
}

/**
 * The window the read asks for: whole UTC hours (`from` floored, `to` raised), so a live window's
 * 15-minute refreshes share one query key — and `from` raised again when rounding would take the
 * span past the route's 31-day cap, so an off-the-hour 31-day window is not refused.
 */
export function anomalyWindow(window: { readonly from: string; readonly to: string }): { from: string; to: string } {
  const to = Math.ceil(Date.parse(window.to) / HOUR_MS) * HOUR_MS;
  const from = Math.max(Math.floor(Date.parse(window.from) / HOUR_MS) * HOUR_MS, to - MAX_SPAN_MS);
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

/** A detector's display label; an unknown detector is shown as stored. */
export function detectorLabel(detector: string): string {
  if (detector === "baseline_mad") return "Baseline";
  if (detector === "isolation_forest") return "Isolation Forest";
  return detector;
}

const formatScore = (value: number): string =>
  value.toLocaleString("en-GB", { maximumFractionDigits: 4, useGrouping: false });

/** A mark's tooltip value: `score 0.9987 · Baseline, Isolation Forest · kw, pf` (no points, no last part). */
export function formatAnomalyMark(hour: AnomalyHour): string {
  const parts = [`score ${formatScore(hour.score)}`, hour.detectors.map(detectorLabel).join(", ")];
  if (hour.contributingPoints.length > 0) {
    parts.push(hour.contributingPoints.join(", "));
  }
  return parts.join(" · ");
}

/** The marks' one series, or none without an unusual hour. */
export function anomalyMarkSeries(args: {
  readonly hours: readonly AnomalyHour[];
  readonly colour: string;
  readonly yAxisIndex: number;
}) {
  const { hours, colour, yAxisIndex } = args;
  if (hours.length === 0) {
    return [];
  }
  return [
    {
      name: ANOMALY_MARK_NAME,
      type: CHART_SERIES.scatter.type,
      yAxisIndex,
      symbol: "diamond",
      symbolSize: 10,
      itemStyle: { color: colour },
      tooltip: {
        valueFormatter: (_value: unknown, dataIndex: number) => {
          const hour = hours[dataIndex];
          return hour ? formatAnomalyMark(hour) : "—";
        },
      },
      data: hours.map((hour) => [hour.t, hour.score] as [string, number]),
    },
  ];
}
