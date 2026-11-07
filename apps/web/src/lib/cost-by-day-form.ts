import { COST_BY_DAY_SOURCE_KEY, ENERGY_COST_MAX_DAYS, type ChartSeriesKind } from "@bms/shared";

import type { DashboardWidgetRow } from "./dashboard-builder-form";

/**
 * `F4.332` (ADR 0047 Amendment 9 item 5) — the builder's half of the daily energy cost chart.
 * Choosing the kind binds the one `energy.cost_by_day` source (90 days, so the viewer switch
 * offers 7 / 30 / 90) and drops the points; leaving it drops that source. The API holds the same
 * rule (`chartKindIssues`), so a row from anywhere else is refused there.
 */

/** The days a new daily cost chart reads: every window of the viewer switch. */
export const DEFAULT_COST_CHART_DAYS = ENERGY_COST_MAX_DAYS;

/** The row patch for choosing `series` on a chart. */
export function rowForChartKind(row: DashboardWidgetRow, series: ChartSeriesKind): Partial<DashboardWidgetRow> {
  const config = { ...row.config, series };
  if (series === "cost_by_day") {
    if (row.config.series === "cost_by_day") return { config };
    return {
      config,
      points: [],
      sources: [{ catalogKey: COST_BY_DAY_SOURCE_KEY, params: { days: DEFAULT_COST_CHART_DAYS } }],
    };
  }
  return { config, sources: row.sources.filter((source) => source.catalogKey !== COST_BY_DAY_SOURCE_KEY) };
}

/** The days the row's cost source reads, or the default when it has none. */
export function costChartDays(row: DashboardWidgetRow): number {
  const days = row.sources.find((source) => source.catalogKey === COST_BY_DAY_SOURCE_KEY)?.params.days;
  return typeof days === "number" ? days : DEFAULT_COST_CHART_DAYS;
}

/**
 * The row patch for a typed day count, or `null` while the text is not a whole number from 1 to
 * 90. The field keeps the author's text and writes only a valid count, so clearing it to type
 * "30" never snaps back to 90 under the cursor.
 */
export function rowWithCostDays(typed: string): Partial<DashboardWidgetRow> | null {
  const trimmed = typed.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const days = Number(trimmed);
  if (days < 1 || days > ENERGY_COST_MAX_DAYS) return null;
  return { sources: [{ catalogKey: COST_BY_DAY_SOURCE_KEY, params: { days } }] };
}

/** The sentence under the field while the text is not a valid count. */
export const COST_DAYS_MESSAGE = `Days read is a whole number from 1 to ${ENERGY_COST_MAX_DAYS}.`;
