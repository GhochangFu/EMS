import type { EChartsOption } from "echarts";

import { energyCostDayRowSchema, type EnergyCostDayRow, type EnergyCostReason } from "@bms/shared";

import { formatMoney } from "./money";
import type { Roles } from "./theme";
import { chartType } from "./design";

/**
 * `F4.332` (ADR 0047 Amendment 9) — the pure half of the daily energy cost chart: the rows, the
 * 7 / 30 / 90 day switch, the window total and the ECharts option. The widget
 * (`cost-by-day-chart-widget.tsx`) only renders what these return.
 */

/** The windows the viewer switch can offer, in days (decision 4). */
export const COST_WINDOWS = [7, 30, 90] as const;

/** The window the chart opens on when the bound days allow it. */
export const DEFAULT_COST_WINDOW = 30;

/** A row of the dataset, or nothing: a cell the API did not write is never drawn as a cost. */
export function costRows(rows: readonly Record<string, unknown>[]): EnergyCostDayRow[] {
  return rows.flatMap((row) => {
    const parsed = energyCostDayRowSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * The windows to offer for `boundDays` rows: each of 7 / 30 / 90 not longer than the bound,
 * or the bound itself when it is shorter than a week. One option means no switch is drawn.
 */
export function costWindowOptions(boundDays: number): number[] {
  const fitting = COST_WINDOWS.filter((days) => days <= boundDays);
  return fitting.length > 0 ? [...fitting] : boundDays > 0 ? [boundDays] : [];
}

/** The window the chart opens on: 30 days, or the bound when it is shorter (decision 4). */
export function defaultCostWindow(boundDays: number): number {
  return Math.min(DEFAULT_COST_WINDOW, boundDays);
}

/** The last `days` rows (the rows are oldest first, today last). */
export function rowsInWindow(rows: readonly EnergyCostDayRow[], days: number): EnergyCostDayRow[] {
  return rows.slice(Math.max(0, rows.length - days));
}

/** The total under the chart: the sum of the bars shown, and how many of the days were priced. */
export interface CostWindowTotal {
  readonly total: number | null;
  readonly priced: number;
  readonly days: number;
  readonly currency: string | null;
}

export function costWindowTotal(rows: readonly EnergyCostDayRow[]): CostWindowTotal {
  const priced = rows.filter((row) => row.cost !== null);
  const total = priced.length === 0 ? null : Math.round(priced.reduce((sum, row) => sum + row.cost!, 0) * 100) / 100;
  return { total, priced: priced.length, days: rows.length, currency: rows.find((row) => row.currency !== null)?.currency ?? null };
}

/** The plain sentence for each reason a day has no cost (decision 5). */
export const COST_REASON_TEXT: Readonly<Record<EnergyCostReason, string>> = {
  rate_missing: "No energy rate for part of this day",
  currency_mixed: "More than one currency in scope",
  no_energy: "No energy data for this day",
};

/** The line under the chart: "Total ₹12,340 · 27 of 30 days priced", or why there is none. */
export function costTotalLine(total: CostWindowTotal): string {
  if (total.days === 0) return "No days to show";
  const money = formatMoney(total.total, total.currency, 0);
  const head = money === null ? "Total —" : `Total ${money}`;
  return total.priced < total.days ? `${head} · ${total.priced} of ${total.days} days priced` : head;
}

/** `2026-11-05` → `5 Nov`, the category label. Calendar arithmetic on the label: no zone. */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
}

/** One bar per day; a `null` day draws no bar, and its tooltip says why. */
export function buildCostByDayOption(rows: readonly EnergyCostDayRow[], roles: Roles): EChartsOption {
  const currency = rows.find((row) => row.currency !== null)?.currency ?? null;
  return {
    grid: { left: 56, right: 12, top: 12, bottom: 28 },
    tooltip: {
      trigger: "axis",
      formatter: (params: unknown) => {
        const index = Array.isArray(params) ? (params[0] as { dataIndex?: number } | undefined)?.dataIndex : undefined;
        const row = index === undefined ? undefined : rows[index];
        if (row === undefined) return "";
        const value =
          row.cost === null
            ? COST_REASON_TEXT[row.reason ?? "no_energy"]
            : (formatMoney(row.cost, row.currency, 2) ?? String(row.cost));
        return `${dayLabel(row.day)}<br/>${value}`;
      },
    },
    xAxis: { type: "category", data: rows.map((row) => dayLabel(row.day)), axisLabel: { fontSize: chartType()["3xs"] } },
    yAxis: {
      type: "value",
      axisLabel: {
        fontSize: chartType()["3xs"],
        formatter: (value: number) => formatMoney(value, currency, 0) ?? String(value),
      },
    },
    series: [
      {
        type: "bar",
        name: "Energy cost",
        // `null` draws no bar (never a zero-height one that reads as "free").
        data: rows.map((row) => row.cost),
        itemStyle: { color: roles["series-1"] },
      },
    ],
  };
}
