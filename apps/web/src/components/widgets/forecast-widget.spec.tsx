import { render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { PointForecastResponse } from "@bms/shared";

import { ACCESS_SENTENCE } from "../asset-history/history-format";
import {
  FORECAST_STATIC_SENTENCE,
  ForecastWidget,
  NO_FORECAST_POINT_SENTENCE,
  NO_FORECAST_YET_SENTENCE,
  type ForecastWidgetRead,
} from "./forecast-widget";

/**
 * `E1.4c` — the presentational forecast widget: its three empty states and its caption.
 * `echarts-for-react` is stubbed to record the option (the `trend-chart.spec.tsx` shape).
 * Entry point: `forecast-widget.test.tsx`.
 */
type Recorded = { option: { xAxis: { max: number }; series: { name: string }[] } };

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
const TO = Date.parse("2026-11-16T10:20:00.000Z");
const FROM = TO - 24 * HOUR;
const HOUR_10 = Date.parse("2026-11-16T10:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();

const ACTUAL = [
  { t: iso(HOUR_10 - 2 * HOUR), v: 40 },
  { t: iso(HOUR_10 - HOUR), v: null },
  { t: iso(HOUR_10), v: 42 },
];

const FORECAST: PointForecastResponse = {
  asOf: iso(TO),
  forecast: {
    issuedAt: "2026-11-16T10:05:00.000Z",
    modelName: "amazon/chronos-2",
    modelVersion: "main",
    stale: false,
    buckets: [0, 1, 2].map((h) => ({ t: iso(HOUR_10 + h * HOUR), p10: 38, p50: 41, p90: 45 })),
  },
};

const read = (forecast: PointForecastResponse | null): ForecastWidgetRead => ({
  from: FROM,
  to: TO,
  actual: ACTUAL,
  forecast,
  zone: "Asia/Kolkata",
});

const names = (): string[] => (recorded.at(-1)?.option.series ?? []).map((s) => s.name);

/** No point bound: one sentence, no chart. */
export function noPointBoundSaysSo(): void {
  render(<ForecastWidget title="Chiller" status="ready" pointKey={null} unit={null} read={null} />);
  expect(screen.getByText(NO_FORECAST_POINT_SENTENCE)).toBeTruthy();
  expect(recorded).toHaveLength(0);
}

/** A point with no current forecast: the actual line still draws, and one sentence says why no band. */
export function noForecastYetStillDrawsTheActualLine(): void {
  render(
    <ForecastWidget title="Chiller" status="ready" pointKey="kw" unit="kW" read={read({ asOf: iso(TO), forecast: null })} />,
  );
  expect(screen.getByTestId("forecast-widget-none").textContent).toBe(NO_FORECAST_YET_SENTENCE);
  expect(names()).toEqual(["kw"]);
  expect(recorded.at(-1)?.option.xAxis.max).toBe(TO);
  expect(screen.queryByTestId("forecast-caption")).toBeNull();
}

/** A 403 on either read: the history page's access sentence, and nothing drawn. */
export function aForbiddenReadSaysTheAccessSentence(): void {
  render(<ForecastWidget title="Chiller" status="ready" pointKey="kw" unit="kW" forbidden read={read(FORECAST)} />);
  expect(screen.getByText(ACCESS_SENTENCE)).toBeTruthy();
  expect(recorded).toHaveLength(0);
  expect(screen.queryByTestId("forecast-caption")).toBeNull();
}

/** With a forecast: band and p50 beside the actual line, the axis past `to`, and the advisory caption. */
export function aForecastDrawsTheBandAndTheAdvisoryCaption(): void {
  render(<ForecastWidget title="Chiller" status="ready" pointKey="kw" unit="kW" read={read(FORECAST)} />);
  expect(names()).toEqual(["kw", "Forecast p10–p90", "Forecast p10–p90", "Forecast p50"]);
  expect(recorded.at(-1)?.option.xAxis.max).toBeGreaterThan(TO);
  const caption = screen.getByTestId("forecast-caption").textContent ?? "";
  expect(caption).toContain("Chronos-2");
  expect(caption).toContain("advisory");
  expect(screen.queryByTestId("forecast-widget-none")).toBeNull();
}

/** The dispatcher's static draw reads nothing and says where the widget draws. */
export function theStaticDrawReadsNothing(): void {
  render(<ForecastWidget title="Chiller" status="ready" pointKey="kw" unit="kW" read={null} />);
  expect(screen.getByText(FORECAST_STATIC_SENTENCE)).toBeTruthy();
  expect(recorded).toHaveLength(0);
}
