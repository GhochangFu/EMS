import { act, render } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { EnergySourceMixPoint, EnergyTopConsumer, HealthSummaryResponse, LoadTrendPoint } from "@bms/shared";

import { echartsTheme } from "../lib/chart-theme";
import { resolveRoles, withAlpha, type RoleName } from "../lib/theme";
import type { WidgetSeries } from "../lib/widget-catalog";
import { currentRoles, useThemeStore } from "../stores/theme-store";
import { fromTokenMap, ROLE_TOKENS } from "../test-role-tokens";
import { HealthSummaryDonut } from "./asset-health/health-summary-donut";
import { EnergySourceStackChart } from "./energy-source-stack-chart";
import { EnergyTopBarChart } from "./energy-top-bar-chart";
import { LoadTrendChart } from "./load-trend-chart";
import { ChartWidget } from "./widgets/chart-widget";
import { RadialGaugeWidget } from "./widgets/radial-gauge-widget";

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
    series: {
      areaStyle?: { color?: string };
      axisLine?: { lineStyle?: { color?: [number, string][] } };
      data: { itemStyle?: { color?: string } }[];
    }[];
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

/*
 * F7 — every other chart, toggled after it rendered in light (`F3.65c` review, compliance §4.6).
 *
 * The expected values come from the dark block of `index.css` (`ROLE_TOKENS.dark`), not from
 * `currentRoles()`, so the assertion does not read the same source the component does. Each option
 * claim names a role whose value differs between the themes — `darkOnly` throws otherwise, because
 * `info`, `warning`, `critical`, `warning-on-dark`, `on-dark`, `chrome-nav` and `scrim` are the same
 * `rgb` in both, and a claim on one of them passes whether or not the chart re-rendered. That is
 * why `EnergyTopBarChart` has no option claim here: its one series colour is `info`; F6 holds its
 * theme object.
 *
 * `ChartWidget` gets a fixed `now` and module-scope `config` / `series`, so its option memo can
 * return a cached value and a missing `roles` dependency shows.
 */

const DARK_ROLES = resolveRoles(fromTokenMap(ROLE_TOKENS.dark));
const LIGHT_ROLES = resolveRoles(fromTokenMap(ROLE_TOKENS.light));

function darkOnly(role: RoleName): string {
  if (DARK_ROLES[role] === LIGHT_ROLES[role]) {
    throw new Error(`${role} is ${DARK_ROLES[role]} in both themes, so a toggle claim on it is vacuous`);
  }
  return DARK_ROLES[role];
}

const WIDGET_CHART_CONFIG = { series: "line" } as const;
const WIDGET_SERIES: readonly WidgetSeries[] = [
  { name: "CH-01 · kw", sortOrder: 0, points: [{ t: "2026-09-28T00:00:00.000Z", v: 12 }] },
];
const WIDGET_NOW = Date.parse("2026-09-28T00:05:00.000Z");
const GAUGE_CONFIG = { min: 0, max: 100 } as const;

const TOGGLED = {
  EnergySourceStackChart: CHARTS.EnergySourceStackChart,
  HealthSummaryDonut: CHARTS.HealthSummaryDonut,
  ChartWidget: () =>
    render(
      <ChartWidget
        title="Load"
        status="ready"
        series={WIDGET_SERIES}
        config={WIDGET_CHART_CONFIG}
        now={WIDGET_NOW}
      />,
    ),
  RadialGaugeWidget: () =>
    render(<RadialGaugeWidget title="Load" status="ready" primary={42} config={GAUGE_CONFIG} />),
} as const;

export type ToggledChartName = keyof typeof TOGGLED;
export const TOGGLED_CHART_NAMES = Object.keys(TOGGLED) as ToggledChartName[];

/** The one option colour each chart claims, read off the recorded option. */
const OPTION_COLOUR: Record<ToggledChartName, { role: RoleName; read: (p: RecordedProps) => unknown }> = {
  // Grid, the first of [ink-faint, warning, accent]; `warning` would be vacuous.
  EnergySourceStackChart: { role: "ink-faint", read: (p) => p.option.color?.[0] },
  // The Excellent slice.
  HealthSummaryDonut: { role: "accent", read: (p) => p.option.series[0].data[0].itemStyle?.color },
  // The first series, `seriesPalette(roles)[0]`.
  ChartWidget: { role: "accent", read: (p) => p.option.color?.[0] },
  // No thresholds: the whole arc is one `ok` stop, `accent`.
  RadialGaugeWidget: { role: "accent", read: (p) => p.option.series[0].axisLine?.lineStyle?.color?.[0]?.[1] },
};

function toggleToDark(chart: ToggledChartName): void {
  TOGGLED[chart]();
  act(() => useThemeStore.getState().setTheme("dark"));
}

export function f7ToggleRepaintsTheOptionColour(chart: ToggledChartName): void {
  const { role, read } = OPTION_COLOUR[chart];
  const expected = darkOnly(role);
  toggleToDark(chart);
  expect(read(last())).toBe(expected);
}

export function f7TogglePassesTheDarkThemeObject(chart: ToggledChartName): void {
  toggleToDark(chart);
  expect(last().theme).toEqual(echartsTheme(DARK_ROLES));
}
