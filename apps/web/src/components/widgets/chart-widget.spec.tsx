import { render, screen } from "@testing-library/react";
import { expect } from "vitest";

import type { WidgetSeries } from "../../lib/widget-catalog";
import { ChartWidget } from "./chart-widget";

/**
 * `F4.322` (ADR 0047 Amendment 7 item 4) — a donut leaves out a point with no share and says so
 * under the ring, never a silent gap. Assertions live here; `chart-widget.test.tsx` is the Vitest
 * entry point (ADR 0014), and stubs `echarts-for-react` (jsdom has no canvas).
 */

const NOW = Date.parse("2026-11-07T00:00:00.000Z");

const SERIES: readonly WidgetSeries[] = [
  { name: "P-01 · kwh", sortOrder: 0, points: [], value: 40 },
  { name: "P-02 · kwh", sortOrder: 1, points: [], value: 0 },
  { name: "P-03 · kwh", sortOrder: 2, points: [], value: null },
];

export function aDonutSaysHowManyPointsItLeftOut(): void {
  render(
    <ChartWidget title="Share" status="ready" series={SERIES} config={{ series: "donut", aggregate: "sum" }} now={NOW} />,
  );
  expect(screen.getByText("2 points not shown: no positive value in this window.")).toBeInTheDocument();
}

export function aDonutWithEveryShareSaysNothing(): void {
  render(
    <ChartWidget
      title="Share"
      status="ready"
      series={SERIES.slice(0, 1)}
      config={{ series: "donut", aggregate: "sum" }}
      now={NOW}
    />,
  );
  expect(screen.queryByText(/not shown/)).toBeNull();
}

export function aCompareChartSaysNothing(): void {
  render(
    <ChartWidget title="Compare" status="ready" series={SERIES} config={{ series: "compare", aggregate: "sum" }} now={NOW} />,
  );
  expect(screen.queryByText(/not shown/)).toBeNull();
}

export function aDonutStillLoadingSaysNothing(): void {
  const pending: readonly WidgetSeries[] = SERIES.map(({ value: _value, ...rest }) => rest);
  render(<ChartWidget title="Share" status="ready" series={pending} config={{ series: "donut", aggregate: "sum" }} now={NOW} />);
  expect(screen.queryByText(/not shown/)).toBeNull();
}

const HEATMAP = { series: "heatmap", aggregate: "avg", windowMinutes: 10_080 } as const;

export function aHeatmapWithNoZoneSaysUtc(): void {
  render(<ChartWidget title="Pattern" status="ready" series={SERIES.slice(0, 1)} config={HEATMAP} now={NOW} timeZone={null} />);
  expect(screen.getByText("Hours shown in UTC: the site's time zone is not known.")).toBeInTheDocument();
}

export function aHeatmapWithAZoneSaysNothing(): void {
  render(
    <ChartWidget title="Pattern" status="ready" series={SERIES.slice(0, 1)} config={HEATMAP} now={NOW} timeZone="Asia/Kolkata" />,
  );
  expect(screen.queryByText(/Hours shown in UTC/)).toBeNull();
}

export function aHeatmapStillLoadingSaysNothing(): void {
  render(<ChartWidget title="Pattern" status="ready" series={SERIES.slice(0, 1)} config={HEATMAP} now={NOW} />);
  expect(screen.queryByText(/Hours shown in UTC/)).toBeNull();
}
