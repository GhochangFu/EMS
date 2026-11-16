import { render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";

import { encodePointRef, pointAggregateResponseSchema } from "@bms/shared";
import type { AnomalyScore, PointAggregateResponse, PointForecast } from "@bms/shared";

import { ANOMALY_CAPTION, ANOMALY_MARK_NAME } from "../../lib/anomaly-series";
import { siteZoneOf } from "./history-format";
import { TrendChart, type TrendSeries } from "./trend-chart";

/**
 * `E1.4a` (plan §16 B2) — `TrendChart` takes the x axis's `max` from the built option, not from
 * `to`, so a forecast past `to` is not clipped off. `echarts-for-react` is stubbed to record the
 * option it receives (the `energy-stack-chart.spec.tsx` shape). Entry point: `trend-chart.test.tsx`.
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

const ASSET = "11111111-1111-4111-8111-111111111111";
const FROM = "2026-11-15T10:20:00.000Z";
const TO = "2026-11-16T10:20:00.000Z";
const HOUR = 3_600_000;

const DATA: PointAggregateResponse = pointAggregateResponseSchema.parse({
  pointRef: encodePointRef(ASSET, "kw"),
  from: FROM,
  to: TO,
  bucketSeconds: 60,
  timeZone: "Asia/Kolkata",
  stats: { sum: 1, average: 1, min: 1, max: 1, peakAt: null, sampleCount: 1 },
  compare: null,
  buckets: [{ t: "2026-11-16T10:00:00.000Z", v: 1, min: 1, average: 1, max: 1, sampleCount: 1 }],
});

const FORECAST: PointForecast = {
  issuedAt: "2026-11-16T10:05:00.000Z",
  modelName: "amazon/chronos-2",
  modelVersion: "0".repeat(40),
  stale: false,
  buckets: Array.from({ length: 48 }, (_, i) => ({
    t: new Date(Date.parse("2026-11-16T10:00:00.000Z") + i * HOUR).toISOString(),
    p10: 1,
    p50: 2,
    p90: 3,
  })),
};

const renderChart = (series: TrendSeries[], forecastAsOf: string | null): void => {
  render(
    <TrendChart series={series} chartedCount={series.length} compare={false} siteZone={siteZoneOf("Asia/Kolkata")} forecastAsOf={forecastAsOf} />,
  );
};

/** B2: with a forecast drawn, the axis ends at the option's `max`, past `to`, and the caption shows. */
export function aForecastMovesTheAxisPastTo(): void {
  renderChart([{ pointKey: "kw", unit: "kW", data: DATA, forecast: FORECAST }], "2026-11-16T10:21:00.000Z");
  const option = recorded.at(-1)?.option;
  expect(option?.xAxis.max).toBeGreaterThan(Date.parse(TO));
  expect(option?.xAxis.max).toBe(Date.parse(FORECAST.buckets.at(-1)?.t ?? ""));
  expect(option?.series.map((s) => s.name)).toContain("Forecast p50");
  expect(screen.getByTestId("forecast-caption").textContent).toContain("advisory");
}

/** No forecast: the axis ends at `to` and there is no caption. */
export function noForecastKeepsTheAxisAtTo(): void {
  renderChart([{ pointKey: "kw", unit: "kW", data: DATA, forecast: null }], "2026-11-16T10:21:00.000Z");
  expect(recorded.at(-1)?.option.xAxis.max).toBe(Date.parse(TO));
  expect(screen.queryByTestId("forecast-caption")).toBeNull();
}

/** The server's `asOf` decides liveness (N11): a window that ended over an hour before it draws no forecast. */
export function aStaleWindowDrawsNoForecastOrCaption(): void {
  renderChart([{ pointKey: "kw", unit: "kW", data: DATA, forecast: FORECAST }], "2026-11-16T12:00:00.000Z");
  expect(recorded.at(-1)?.option.xAxis.max).toBe(Date.parse(TO));
  expect(screen.queryByTestId("forecast-caption")).toBeNull();
}

/** `E1.2b` — a score at the line inside the window, one just under it, one at the line outside the window. */
const UNUSUAL: AnomalyScore = { t: "2026-11-16T09:00:00.000Z", detector: "baseline_mad", score: 0.99, contributingPoints: ["kw"] };
const USUAL: AnomalyScore = { ...UNUSUAL, score: 0.9899 };
const OUTSIDE: AnomalyScore = { ...UNUSUAL, t: "2026-11-14T09:00:00.000Z" };

const renderMarks = (anomalies: readonly AnomalyScore[] | null): void => {
  render(
    <TrendChart
      series={[{ pointKey: "kw", unit: "kW", data: DATA }]}
      chartedCount={1}
      compare={false}
      siteZone={siteZoneOf("Asia/Kolkata")}
      anomalies={anomalies}
    />,
  );
};

/** `E1.2b` — a drawn mark passes into the option and brings the advisory caption. */
export function aMarkBringsTheCaption(): void {
  renderMarks([USUAL, UNUSUAL]);
  expect(recorded.at(-1)?.option.series.map((s) => s.name)).toContain(ANOMALY_MARK_NAME);
  expect(screen.getByTestId("anomaly-caption").textContent).toBe(ANOMALY_CAPTION);
}

/** `E1.2b` — no mark drawn (no read, none at the line, none in the window): no series and no caption. */
export function noMarkNoCaption(): void {
  for (const anomalies of [null, [], [USUAL], [OUTSIDE]]) {
    resetRecorded();
    const { unmount } = render(
      <TrendChart
        series={[{ pointKey: "kw", unit: "kW", data: DATA }]}
        chartedCount={1}
        compare={false}
        siteZone={siteZoneOf("Asia/Kolkata")}
        anomalies={anomalies}
      />,
    );
    expect(recorded.at(-1)?.option.series.map((s) => s.name)).not.toContain(ANOMALY_MARK_NAME);
    expect(screen.queryByTestId("anomaly-caption")).toBeNull();
    unmount();
  }
}
