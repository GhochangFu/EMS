import type { EnergyCostDayRow } from "@bms/shared";

import {
  buildCostByDayOption,
  costRows,
  costTotalLine,
  costWindowOptions,
  costWindowTotal,
  defaultCostWindow,
  rowsInWindow,
} from "./cost-by-day-chart";
import { rowForChartKind, rowWithCostDays } from "./cost-by-day-form";
import { blankDashboardWidgetRow, dashboardBuilderErrors, type DashboardWidgetRow } from "./dashboard-builder-form";
import { costDaysNote, costReasonText, isStoredEnergyCostPoint, widgetShowsStoredEnergyCost } from "./energy-cost-labels";
import type { Roles } from "./theme";

/**
 * `F4.332` (ADR 0047 Amendment 9, ADR 0070 Amendment 7 decision 8) — the pure halves of the daily
 * energy cost chart, its builder fields and the stored-cost note. One claim per function (§4.6).
 */

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const day = (d: string, cost: number | null, reason: EnergyCostDayRow["reason"] = null): EnergyCostDayRow => ({
  day: d,
  kwh: cost === null ? null : 10,
  cost,
  currency: "INR",
  reason: cost === null ? (reason ?? "no_energy") : null,
});

export function theSwitchOffersTheWindowsTheBoundDaysHold(): void {
  assert(JSON.stringify(costWindowOptions(90)) === "[7,30,90]", "90 days offers 7, 30 and 90");
  assert(JSON.stringify(costWindowOptions(30)) === "[7,30]", "30 days offers 7 and 30");
  assert(JSON.stringify(costWindowOptions(10)) === "[7]", "10 days offers 7 only (no switch)");
  assert(JSON.stringify(costWindowOptions(3)) === "[3]", "3 days offers itself");
  assert(JSON.stringify(costWindowOptions(0)) === "[]", "no rows offers nothing");
}

export function theChartOpensOnThirtyDaysOrTheBound(): void {
  assert(defaultCostWindow(90) === 30 && defaultCostWindow(30) === 30 && defaultCostWindow(7) === 7, "30, or the bound");
}

export function theWindowIsTheLastDays(): void {
  const rows = [day("2026-11-01", 1), day("2026-11-02", 2), day("2026-11-03", 3)];
  assert(JSON.stringify(rowsInWindow(rows, 2).map((r) => r.day)) === JSON.stringify(["2026-11-02", "2026-11-03"]), "the last two");
  assert(rowsInWindow(rows, 7).length === 3, "a window longer than the rows is all of them");
}

export function theTotalIsTheSumOfTheBarsShown(): void {
  const total = costWindowTotal([day("2026-11-01", 10.105), day("2026-11-02", null), day("2026-11-03", 1)]);
  assert(total.total === 11.11 && total.priced === 2 && total.days === 3 && total.currency === "INR",
    `the total must sum the priced bars, got ${JSON.stringify(total)}`);
  assert(costTotalLine(total).endsWith(" · 2 of 3 days priced"), `the line must say how many days were priced: ${costTotalLine(total)}`);
  const none = costWindowTotal([day("2026-11-01", null)]);
  assert(none.total === null && costTotalLine(none).startsWith("Total —"), "no priced day shows a dash, never 0");
  const all = costWindowTotal([day("2026-11-01", 5)]);
  assert(!costTotalLine(all).includes("priced"), "every day priced needs no count");
}

export function aCellTheApiDidNotWriteIsNeverDrawn(): void {
  const rows = costRows([
    { day: "2026-11-01", kwh: 1, cost: 2, currency: "INR", reason: null },
    { day: "11/02/2026", kwh: 1, cost: 2, currency: "INR", reason: null },
    { day: "2026-11-03", kwh: 1, cost: "2", currency: "INR", reason: null },
  ]);
  assert(rows.length === 1 && rows[0]?.day === "2026-11-01", `only well-formed rows survive, got ${JSON.stringify(rows)}`);
}

export function aNullDayDrawsNoBar(): void {
  const roles = new Proxy({}, { get: () => "#123456" }) as Roles;
  const option = buildCostByDayOption([day("2026-11-01", 4), day("2026-11-02", null, "rate_missing")], roles);
  const series = (option.series as { data: (number | null)[] }[])[0];
  assert(JSON.stringify(series?.data) === "[4,null]", `a null day must be null, never 0, got ${JSON.stringify(series?.data)}`);
}

const ROW: DashboardWidgetRow = {
  ...blankDashboardWidgetRow("chart"),
  title: "Cost",
  points: [{ pointId: "p", role: "series", sortOrder: 0, label: "kw" }] as DashboardWidgetRow["points"],
};

export function choosingTheKindBindsTheCostSourceAndDropsThePoints(): void {
  const patch = rowForChartKind(ROW, "cost_by_day");
  assert(patch.points?.length === 0, "the points must go");
  assert(JSON.stringify(patch.sources) === JSON.stringify([{ catalogKey: "energy.cost_by_day", params: { days: 90 } }]),
    `the one source must be bound with 90 days, got ${JSON.stringify(patch.sources)}`);
  const back = rowForChartKind({ ...ROW, ...patch } as DashboardWidgetRow, "bar");
  assert(back.sources?.length === 0, "leaving the kind must drop the cost source");
}

export function theDaysAreClampedToOneToNinety(): void {
  const days = (typed: string) => rowWithCostDays(typed)?.sources?.[0]?.params.days;
  assert(days("30") === 30 && days("90") === 90 && days(" 7 ") === 7, "a whole number from 1 to 90 is written");
  assert(days("0") === undefined && days("91") === undefined && days("") === undefined && days("3.5") === undefined,
    "anything else writes nothing, so the field keeps the author's text");
}

/** The builder's own Save gate accepts a daily cost chart (the code review's blocker). */
export function theBuilderAcceptsADailyCostChart(): void {
  const row = { ...ROW, ...rowForChartKind(ROW, "cost_by_day") } as DashboardWidgetRow;
  const problems = dashboardBuilderErrors([row], "location", []);
  assert(problems.length === 0, `a daily cost chart must pass the builder's gate, got ${JSON.stringify(problems)}`);
  const lineWithSource = { ...row, config: { ...row.config, series: "line" } } as DashboardWidgetRow;
  assert(dashboardBuilderErrors([lineWithSource], "location", []).length > 0, "a line chart holding the cost source is refused");
}

export function theStoredCostPointsAreFoundByKey(): void {
  assert(isStoredEnergyCostPoint("energy_cost_today") && !isStoredEnergyCostPoint("kwh_today"), "by the energy_cost_ prefix");
  const widget = (pointKey: string) => ({ points: [], sources: [{ catalogKey: "sustainability.total", params: { pointKey } }] });
  assert(widgetShowsStoredEnergyCost(widget("energy_cost_this_month") as never), "through a sustainability source");
  assert(!widgetShowsStoredEnergyCost(widget("kw") as never), "not for another point key");
  assert(!widgetShowsStoredEnergyCost({ points: [], sources: [{ catalogKey: "energy.cost.total", params: { period: "today" } }] } as never),
    "the read-time cost is not a stored point");
}

export function theCostTileSaysDaysAndWhy(): void {
  assert(costDaysNote({ fresh: 27, carrying: 30 }) === "27 of 30 days priced", "days, not assets");
  assert(costDaysNote({ fresh: 30, carrying: 30 }) === undefined, "every day priced says nothing");
  assert(costReasonText("rate_missing") === "No energy rate for this period", "the reason in words");
  assert(costReasonText("constructor") === undefined && costReasonText(null) === undefined, "an unknown reason says nothing");
}
