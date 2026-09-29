import { useMemo } from "react";

import { useThemeRoles } from "../stores/theme-store";
import { withAlpha, type RoleName, type Roles } from "./theme";

/**
 * `F3.65c` — the ECharts theme object, built from the resolved roles (ADR 0078 decision 5, plan
 * D1/D2).
 *
 * Every `<ReactECharts>` passes `theme={theme}`. It carries each chrome default ECharts would
 * otherwise paint in its own light palette — text, axes, tooltip, legend, gauge readouts — so a
 * chart on a dark card has no light-theme grey left in it. `echarts-for-react` disposes and
 * re-inits the chart when `theme` changes (deep-equal), so a toggle repaints every default at once.
 * An option still carries its own series colours from the same roles.
 *
 * Every string in the object is a role or a role with alpha (`chart-theme.spec.ts` C5).
 */

/** The generic series palette, in order: the four status roles, then two quiet hues. */
const SERIES_PALETTE: readonly RoleName[] = ["accent", "info", "warning", "critical", "ink-faint", "simulated-ink"];

/** The series colours a multi-series chart cycles through, resolved for the current theme. */
export function seriesPalette(roles: Roles): string[] {
  return SERIES_PALETTE.map((role) => roles[role]);
}

function axis(roles: Roles) {
  return {
    axisLine: { lineStyle: { color: roles["line-strong"] } },
    axisTick: { lineStyle: { color: roles["line-strong"] } },
    axisLabel: { color: roles["ink-muted"] },
    nameTextStyle: { color: roles["ink-faint"] },
    splitLine: { lineStyle: { color: [roles.line] } },
  };
}

/** The ECharts theme object for `roles` — pass it as `<ReactECharts theme>`. */
export function echartsTheme(roles: Roles) {
  return {
    color: seriesPalette(roles),
    textStyle: { color: roles["ink-muted"] },
    title: { textStyle: { color: roles.ink } },
    legend: { textStyle: { color: roles["ink-muted"] }, inactiveColor: roles["ink-hint"] },
    tooltip: {
      backgroundColor: roles.surface,
      borderColor: roles["line-strong"],
      textStyle: { color: roles.ink },
    },
    categoryAxis: axis(roles),
    valueAxis: axis(roles),
    timeAxis: axis(roles),
    logAxis: axis(roles),
    axisPointer: {
      lineStyle: { color: roles["ink-hint"] },
      shadowStyle: { color: withAlpha(roles["ink-faint"], 0.15) },
    },
    gauge: {
      axisLabel: { color: roles["ink-muted"] },
      detail: { color: roles.ink },
      title: { color: roles["ink-muted"] },
      axisTick: { lineStyle: { color: roles["ink-hint"] } },
      splitLine: { lineStyle: { color: roles["ink-hint"] } },
    },
  };
}

export type EChartsTheme = ReturnType<typeof echartsTheme>;

/**
 * The current roles and the theme object built from them. Both change identity only when the
 * theme changes (`currentRoles()` caches per theme), so a chart re-inits on a toggle and never on
 * an ordinary re-render.
 */
export function useChartTheme(): { roles: Roles; theme: EChartsTheme } {
  const roles = useThemeRoles();
  return useMemo(() => ({ roles, theme: echartsTheme(roles) }), [roles]);
}
