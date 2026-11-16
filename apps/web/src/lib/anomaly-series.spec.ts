import { expect } from "vitest";

import { ANOMALY_MAX_SPAN_DAYS, ANOMALY_UNUSUAL_SCORE } from "@bms/shared";
import type { AnomalyScore } from "@bms/shared";

import {
  ANOMALY_CAPTION,
  ANOMALY_MARK_NAME,
  anomalyApplies,
  anomalyHours,
  anomalyMarkSeries,
  anomalyWindow,
  detectorLabel,
  formatAnomalyMark,
  unusualHours,
} from "./anomaly-series";
import type { HistoryRange } from "./asset-history-range";
import { CHART_SERIES } from "./widget-catalog";

/**
 * `E1.2b` / ADR 0135 Amendment 5 ruling 4(b) — the pure half of the unusual-hour marks. Entry
 * point: `anomaly-series.test.ts` (ADR 0014).
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = "2026-11-16T05:00:00.000Z";
const T1 = "2026-11-16T06:00:00.000Z";
const T2 = "2026-11-16T07:00:00.000Z";

const score = (t: string, detector: string, value: number, points: string[] = []): AnomalyScore => ({
  t,
  detector,
  score: value,
  contributingPoints: points,
});

const range = (fn: HistoryRange["fn"], preset: HistoryRange["range"] = "24h"): HistoryRange => ({
  range: preset,
  compare: false,
  points: [],
  fn,
});

/** Per hour, the larger of the two detectors; only the detectors at or above the line are named, with their points. */
export function theLargerOfTwoDetectorsWins(): void {
  const hours = anomalyHours([
    score(T0, "baseline_mad", 0.4, ["kw"]),
    score(T0, "isolation_forest", 0.995, ["kw", "pf"]),
    score(T1, "baseline_mad", 0.999, ["v"]),
    score(T1, "isolation_forest", 0.991, ["v", "kw"]),
  ]);
  expect(hours).toEqual([
    { t: T0, score: 0.995, detectors: ["isolation_forest"], contributingPoints: ["kw", "pf"] },
    { t: T1, score: 0.999, detectors: ["baseline_mad", "isolation_forest"], contributingPoints: ["v", "kw"] },
  ]);
}

/** 0.99 is unusual and 0.9899 is not: the line is `>=`, from the shared constant. */
export function theLineIsInclusive(): void {
  expect(ANOMALY_UNUSUAL_SCORE).toBe(0.99);
  const from = Date.parse(T0);
  const to = Date.parse(T2);
  const hours = unusualHours([score(T0, "baseline_mad", 0.99), score(T1, "baseline_mad", 0.9899)], from, to);
  expect(hours.map((h) => h.t)).toEqual([T0]);
}

/** An hour outside `[from, to]` is dropped; the ends are inside. */
export function anHourOutsideTheWindowIsDropped(): void {
  const scores = [
    score("2026-11-16T04:00:00.000Z", "baseline_mad", 1),
    score(T0, "baseline_mad", 1),
    score(T1, "isolation_forest", 1),
    score("2026-11-16T08:00:00.000Z", "baseline_mad", 1),
  ];
  expect(unusualHours(scores, Date.parse(T0), Date.parse(T2)).map((h) => h.t)).toEqual([T0, T1]);
  expect(unusualHours([], Date.parse(T0), Date.parse(T2))).toEqual([]);
}

/** The two detectors' labels; an unknown detector is shown as stored. */
export function theDetectorLabels(): void {
  expect(detectorLabel("baseline_mad")).toBe("Baseline");
  expect(detectorLabel("isolation_forest")).toBe("Isolation Forest");
  expect(detectorLabel("prophet_v2")).toBe("prophet_v2");
}

/** R14: beside `avg` only, on a window of at most 31 days. */
export function anomalyAppliesBesideAvgUpTo31Days(): void {
  expect(ANOMALY_MAX_SPAN_DAYS).toBe(31);
  expect(anomalyApplies(range("avg"), DAY)).toBe(true);
  expect(anomalyApplies(range("avg", "30d"), 30 * DAY)).toBe(true);
  expect(anomalyApplies(range("avg", "custom"), 31 * DAY)).toBe(true);
  expect(anomalyApplies(range("avg", "custom"), 32 * DAY)).toBe(false);
  expect(anomalyApplies(range("avg", "1y"), 365 * DAY)).toBe(false);
  expect(anomalyApplies(range("max"), DAY)).toBe(false);
  expect(anomalyApplies(range("sum"), DAY)).toBe(false);
  expect(anomalyApplies(range("avg"), Number.NaN)).toBe(false);
}

/**
 * The read's window: whole hours, so a live window's refreshes share one query key — and never
 * wider than the route's cap, so a 31-day window that is not on the hour is not refused.
 */
export function theWindowIsWholeHoursWithinTheCap(): void {
  expect(anomalyWindow({ from: "2026-11-15T10:20:00.000Z", to: "2026-11-16T10:20:00.000Z" })).toEqual({
    from: "2026-11-15T10:00:00.000Z",
    to: "2026-11-16T11:00:00.000Z",
  });
  const wide = anomalyWindow({ from: "2026-10-16T10:20:00.000Z", to: "2026-11-16T10:20:00.000Z" });
  expect(wide).toEqual({ from: "2026-10-16T11:00:00.000Z", to: "2026-11-16T11:00:00.000Z" });
  expect(Date.parse(wide.to) - Date.parse(wide.from)).toBeLessThanOrEqual(ANOMALY_MAX_SPAN_DAYS * DAY);
}

/** One scatter series, `x` the hour's start and `y` the score, on the axis it is given; none without an hour. */
export function theMarkSeriesIsOneScatterAtTheHourStart(): void {
  const hours = unusualHours([score(T0, "baseline_mad", 0.995, ["kw"])], Date.parse(T0), Date.parse(T2));
  const series = anomalyMarkSeries({ hours, colour: "rgb(1, 2, 3)", yAxisIndex: 2 });
  expect(series).toHaveLength(1);
  expect(series[0]).toMatchObject({
    name: ANOMALY_MARK_NAME,
    type: CHART_SERIES.scatter.type,
    yAxisIndex: 2,
    itemStyle: { color: "rgb(1, 2, 3)" },
    data: [[T0, 0.995]],
  });
  expect(ANOMALY_MARK_NAME).toBe("Unusual hour (advisory)");
  expect(anomalyMarkSeries({ hours: [], colour: "rgb(1, 2, 3)", yAxisIndex: 2 })).toEqual([]);
}

/** The mark's tooltip value: the score, the detector labels and the point keys. */
export function theMarksTooltipNamesScoreDetectorsAndPoints(): void {
  const [hour] = anomalyHours([
    score(T0, "baseline_mad", 0.9912, ["kw"]),
    score(T0, "isolation_forest", 0.9987, ["kw", "pf"]),
  ]);
  expect(formatAnomalyMark(hour)).toBe("score 0.9987 · Baseline, Isolation Forest · kw, pf");
  const series = anomalyMarkSeries({ hours: [hour], colour: "rgb(1, 2, 3)", yAxisIndex: 1 });
  const formatter = series[0]?.tooltip.valueFormatter;
  expect(formatter?.(0.9987, 0)).toBe("score 0.9987 · Baseline, Isolation Forest · kw, pf");
  expect(formatter?.(0.9987, 7)).toBe("—");
  const bare = anomalyHours([score(T0, "baseline_mad", 0.995, [])]);
  expect(formatAnomalyMark(bare[0])).toBe("score 0.995 · Baseline");
}

/** The caption says what a mark is and that it is advisory. */
export function theCaptionIsAdvisory(): void {
  expect(ANOMALY_CAPTION).toBe("Unusual hours: anomaly score 0.99 or above · advisory");
}
