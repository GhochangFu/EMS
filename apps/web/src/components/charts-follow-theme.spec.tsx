import { act, render } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { EnergySourceMixPoint, EnergyTopConsumer, HealthSummaryResponse, LoadTrendPoint } from "@bms/shared";

import { echartsTheme } from "../lib/chart-theme";
import { withAlpha } from "../lib/theme";
import { currentRoles, useThemeStore } from "../stores/theme-store";
import { HealthSummaryDonut } from "./asset-health/health-summary-donut";
import { EnergySourceStackChart } from "./energy-source-stack-chart";
import { EnergyTopBarChart } from "./energy-top-bar-chart";
import { LoadTrendChart } from "./load-trend-chart";

/**
 * `F3.65c` U3 — the four standalone charts and the health donut read the roles (plan D1/D2,
 * owner ruling OQ4). `echarts-for-react` is stubbed to record the `option` and `theme` props it
 * receives — jsdom has no canvas, and the props are the whole contract: the wrapper re-inits on a
 * `theme` change and replaces the option under `notMerge` (plan §2.2). jsdom carries the real
 * `index.css` tokens (`test-setup.ts`), so `currentRoles()` follows `data-theme`.
 */

type RecordedProps = {
  option: {
    color?: string[];
    series: { areaStyle?: { color?: string }; data: { itemStyle?: { color?: string } }[] }[];
  };
  theme: unknown;
};

const recorded = vi.hoisted(() => [] as RecordedProps[]);

vi.mock("echarts-for-react", () => ({
  default: (props: RecordedProps) => {
    recorded.push(props);
    return null;
  },
}));

export function resetRecorded(): void {
  recorded.length = 0;
}

function last(): RecordedProps {
  const props = recorded.at(-1);
  if (!props) throw new Error("the chart rendered no <ReactECharts>");
  return props;
}

const LOAD: LoadTrendPoint[] = [
  { t: "2026-09-28T00:00:00.000Z", totalKw: 120 },
  { t: "2026-09-28T00:05:00.000Z", totalKw: 124 },
];

const MIX: EnergySourceMixPoint[] = [
  { t: "2026-09-28T00:00:00.000Z", gridKw: 80, dgKw: 10, solarKw: 30 },
];

const CONSUMERS: EnergyTopConsumer[] = [
  { assetId: "a1", code: "CH-01", name: "Chiller 1", siteName: "Site", avgKw: 40, estimatedKwh: 960 },
];

const BANDS = ["excellent", "good", "fair", "poor", "critical", "sixth"];

function summary(bandCount: number): HealthSummaryResponse {
  return {
    score: 0.7,
    assetCount: 60,
    scoredAssetCount: 60,
    unbandedAssetCount: 0,
    unscoredAssetCount: 0,
    bandCounts: BANDS.slice(0, bandCount).map((code) => ({ code, label: code, count: 10 })),
    windowFrom: "2026-09-27T00:00:00.000Z",
    windowTo: "2026-09-28T00:00:00.000Z",
    bucketSeconds: 86_400,
    computedAt: "2026-09-28T00:05:00.000Z",
    coveredBuckets: 1,
    expectedBuckets: 1,
  };
}

const CHARTS = {
  LoadTrendChart: () => render(<LoadTrendChart points={LOAD} status="ready" />),
  EnergySourceStackChart: () => render(<EnergySourceStackChart points={MIX} status="ready" />),
  EnergyTopBarChart: () => render(<EnergyTopBarChart consumers={CONSUMERS} status="ready" />),
  HealthSummaryDonut: () => render(<HealthSummaryDonut summary={summary(5)} />),
} as const;

export type ChartName = keyof typeof CHARTS;
export const CHART_NAMES = Object.keys(CHARTS) as ChartName[];

export function f1ThemeIsTheRolesTheme(chart: ChartName): void {
  CHARTS[chart]();
  expect(last().theme).toEqual(echartsTheme(currentRoles()));
}

export function f2LoadTrendLineIsAccent(): void {
  CHARTS.LoadTrendChart();
  expect(last().option.color?.[0]).toBe(currentRoles().accent);
}

/** In dark, where a kept literal (the light accent at 0.12) cannot pass by coincidence. */
export function f2LoadTrendAreaIsAccentAtTwelvePercent(): void {
  useThemeStore.getState().setTheme("dark");
  CHARTS.LoadTrendChart();
  expect(last().option.series[0].areaStyle?.color).toBe(withAlpha(currentRoles().accent, 0.12));
}

export function f3StackColoursAreGridDgSolar(): void {
  CHARTS.EnergySourceStackChart();
  const roles = currentRoles();
  expect(last().option.color).toEqual([roles["ink-faint"], roles.warning, roles.accent]);
}

export function f4BarColourIsInfo(): void {
  CHARTS.EnergyTopBarChart();
  expect(last().option.color).toEqual([currentRoles().info]);
}

export function f5DonutSlicesAreTheOq4BandsCycling(): void {
  render(<HealthSummaryDonut summary={summary(6)} />);
  const roles = currentRoles();
  const colours = last().option.series[0].data.map((d) => d.itemStyle?.color);
  expect(colours).toEqual([
    roles.accent,
    roles["accent-strong"],
    roles["warning-on-dark"],
    roles.warning,
    roles.critical,
    roles.accent,
  ]);
}

export function f6AThemeToggleReRendersWithTheDarkAccent(): void {
  CHARTS.LoadTrendChart();
  act(() => useThemeStore.getState().setTheme("dark"));
  expect(last().option.color?.[0]).toBe("rgb(61, 205, 88)");
}

export function f6AThemeToggleReRendersWithTheDarkTheme(): void {
  CHARTS.EnergyTopBarChart();
  act(() => useThemeStore.getState().setTheme("dark"));
  expect(last().theme).toEqual(echartsTheme(currentRoles()));
}
