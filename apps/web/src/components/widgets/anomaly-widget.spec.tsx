import { render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";

import { ANOMALY_UNUSUAL_SCORE } from "@bms/shared";
import type { AnomalyScore } from "@bms/shared";

import { ANOMALY_MARK_NAME } from "../../lib/anomaly-series";
import { ACCESS_SENTENCE } from "../asset-history/history-format";
import {
  ANOMALY_SCORE_SERIES_NAME,
  ANOMALY_STATIC_SENTENCE,
  AnomalyWidget,
  anomalyWidgetCaption,
  NO_ANOMALY_POINT_SENTENCE,
  NO_ANOMALY_SCORES_SENTENCE,
  type AnomalyWidgetRead,
} from "./anomaly-widget";

/**
 * `E1.2d` — the presentational anomaly widget: its three states, its caption, the 0.99 line and the
 * unusual-hour marks. `echarts-for-react` is stubbed to record the option (the
 * `forecast-widget.spec.tsx` shape). Entry point: `anomaly-widget.test.tsx`.
 */
type RecordedSeries = {
  name: string;
  connectNulls?: boolean;
  data: [string, number | null][];
  markLine?: { data: { yAxis: number }[] };
  tooltip?: { valueFormatter: (value: unknown, dataIndex: number) => string };
};
type Recorded = {
  option: {
    xAxis: {
      axisLabel: { formatter: (value: number) => string };
      axisPointer?: { label?: { formatter?: (params: { value: unknown }) => string } };
    };
    yAxis: { min: number; max: number };
    series: RecordedSeries[];
  };
};

const recorded = vi.hoisted(() => [] as Recorded[]);

vi.mock("echarts-for-react", () => ({
  default: (props: Recorded) => {
    recorded.push(props);
    return null;
  },
}));

/** Clears the recorded props between cases. */
export function resetRecorded(): void {
  recorded.length = 0;
}

const HOUR = 3_600_000;
const TO = Date.parse("2026-11-16T10:00:00.000Z");
const FROM = TO - 168 * HOUR;
const iso = (ms: number): string => new Date(ms).toISOString();

const SCORES: AnomalyScore[] = [
  { t: iso(TO - 3 * HOUR), detector: "baseline_mad", score: 0.42, contributingPoints: [] },
  { t: iso(TO - HOUR), detector: "baseline_mad", score: 0.6, contributingPoints: [] },
  { t: iso(TO - HOUR), detector: "isolation_forest", score: 0.995, contributingPoints: ["kw", "pf"] },
];

const read = (scores: readonly AnomalyScore[] | null): AnomalyWidgetRead => ({
  from: FROM,
  to: TO,
  scores,
  zone: "Asia/Kolkata",
});

const series = (): RecordedSeries[] => recorded.at(-1)?.option.series ?? [];

/** No point bound: one sentence, no chart. */
export function noPointBoundSaysSo(): void {
  render(<AnomalyWidget title="Chiller" status="ready" pointKey={null} read={null} />);
  expect(screen.getByText(NO_ANOMALY_POINT_SENTENCE)).toBeTruthy();
  expect(recorded).toHaveLength(0);
}

/** An asset with no score in the window: one sentence, no chart, the advisory caption still. */
export function noScoresYetSaysSo(): void {
  render(<AnomalyWidget title="Chiller" status="ready" pointKey="kw" read={read([])} />);
  expect(screen.getByTestId("anomaly-widget-none").textContent).toBe(NO_ANOMALY_SCORES_SENTENCE);
  expect(recorded).toHaveLength(0);
  expect(screen.getByTestId("anomaly-widget-caption").textContent).toBe(anomalyWidgetCaption("Asia/Kolkata"));
}

/** A 403: the access sentence, and nothing drawn. */
export function aForbiddenReadSaysTheAccessSentence(): void {
  render(<AnomalyWidget title="Chiller" status="ready" pointKey="kw" forbidden read={read(SCORES)} />);
  expect(screen.getByText(ACCESS_SENTENCE)).toBeTruthy();
  expect(recorded).toHaveLength(0);
  expect(screen.queryByTestId("anomaly-widget-caption")).toBeNull();
}

/**
 * With scores: the 168-hour line on a 0..1 axis (larger detector, gaps unjoined), the 0.99 line,
 * one mark on the unusual hour with its points in the tooltip, and the advisory caption.
 */
export function scoresDrawTheLineTheThresholdAndTheMarks(): void {
  render(<AnomalyWidget title="Chiller" status="ready" pointKey="kw" read={read(SCORES)} />);
  expect(series().map((s) => s.name)).toEqual([ANOMALY_SCORE_SERIES_NAME, ANOMALY_MARK_NAME]);
  expect(recorded.at(-1)?.option.yAxis).toMatchObject({ min: 0, max: 1 });
  const line = series()[0]!;
  expect(line.data).toHaveLength(168);
  expect(line.connectNulls).toBe(false);
  expect(line.data.find(([t]) => t === iso(TO - HOUR))?.[1]).toBe(0.995);
  expect(line.data.find(([t]) => t === iso(TO - 2 * HOUR))?.[1]).toBeNull();
  expect(line.markLine?.data).toEqual([{ yAxis: ANOMALY_UNUSUAL_SCORE }]);
  const marks = series()[1]!;
  expect(marks.data).toEqual([[iso(TO - HOUR), 0.995]]);
  expect(marks.tooltip?.valueFormatter(0.995, 0)).toContain("kw, pf");
  expect(screen.getByTestId("anomaly-widget-caption").textContent).toBe("Anomaly score · last 7 days · Asia/Kolkata · advisory");
  expect(screen.queryByTestId("anomaly-widget-none")).toBeNull();
}

/** The dispatcher's static draw reads nothing and says where the widget draws. */
export function theStaticDrawReadsNothing(): void {
  render(<AnomalyWidget title="Chiller" status="ready" pointKey="kw" read={null} />);
  expect(screen.getByText(ANOMALY_STATIC_SENTENCE)).toBeTruthy();
  expect(recorded).toHaveLength(0);
}

/**
 * The axis and the tooltip's header name one hour the same way, in the read's zone, whatever the
 * browser's zone (ECharts' own default would format the header in the browser's), and the caption
 * names that zone: `Etc/UTC` reads "UTC".
 */
export function theTooltipAndTheAxisShareTheZoneAndTheCaptionNamesIt(): void {
  vi.stubEnv("TZ", "America/New_York");
  try {
    render(<AnomalyWidget title="Chiller" status="ready" pointKey="kw" read={{ ...read(SCORES), zone: "Etc/UTC" }} />);
    const xAxis = recorded.at(-1)?.option.xAxis;
    expect(xAxis?.axisLabel.formatter(TO - HOUR)).toBe("09:00\n16 Nov");
    expect(xAxis?.axisPointer?.label?.formatter?.({ value: TO - HOUR })).toBe("09:00 16 Nov UTC");
    expect(screen.getByTestId("anomaly-widget-caption").textContent).toBe(
      "Anomaly score · last 7 days · UTC · advisory",
    );
  } finally {
    vi.unstubAllEnvs();
  }
}
