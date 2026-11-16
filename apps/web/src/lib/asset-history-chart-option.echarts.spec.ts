import * as echarts from "echarts";
import { expect } from "vitest";

import type { AnomalyScore, PointAggregateBucket } from "@bms/shared";

import { ROLE_TOKENS, fromTokenMap } from "../test-role-tokens";
import { ANOMALY_MARK_NAME } from "./anomaly-series";
import { buildHistoryChartOption } from "./asset-history-chart-option";
import { resolveRoles } from "./theme";

/**
 * `E1.2b` (plan T2.9, "design to verify at build") — the unusual-hour marks' design checked
 * against the installed ECharts, not only the option's shape: the built option is mounted in a
 * real chart (SVG renderer, jsdom) and the axis tooltip is shown at given instants. A mark at
 * `x` = the hour's start joins the tooltip of the actual bucket at that instant and of no other,
 * because an axis-trigger tooltip keeps only the series whose nearest point is nearest the
 * pointer. Entry point: `asset-history-chart-option.echarts.test.ts` (jsdom).
 */
const roles = resolveRoles(fromTokenMap(ROLE_TOKENS.light));
const HOUR = 3_600_000;
const FROM = Date.parse("2026-10-31T00:00:00.000Z");
const TO = FROM + 6 * HOUR;
const iso = (ms: number): string => new Date(ms).toISOString();

/** 15-minute actual buckets over the window. */
const BUCKETS: PointAggregateBucket[] = Array.from({ length: 24 }, (_, i) => ({ t: iso(FROM + i * 15 * 60_000), v: 20 + i }));
const SCORES: AnomalyScore[] = [
  { t: iso(FROM + 2 * HOUR), detector: "baseline_mad", score: 0.9912, contributingPoints: ["pf"] },
  { t: iso(FROM + 2 * HOUR), detector: "isolation_forest", score: 0.9987, contributingPoints: ["pf", "kvar"] },
];

/** jsdom has no canvas: ECharts measures label text through this instead. */
export function useJsdomTextMeasure(): void {
  echarts.setPlatformAPI({ measureText: (text: string) => ({ width: text.length * 6 }) });
}

/** The series names and the tooltip text ECharts shows with the pointer at each instant. */
function tooltipsAt(instants: readonly number[]): { names: string[]; text: string }[] {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const chart = echarts.init(el, undefined, { renderer: "svg", width: 900, height: 400 });
  const option = buildHistoryChartOption({
    from: FROM,
    to: TO,
    series: [{ name: "kw", unit: "kW", buckets: BUCKETS }],
    compare: null,
    roles,
    anomalies: SCORES,
  }) as echarts.EChartsOption & { tooltip: Record<string, unknown> };
  chart.setOption({ ...option, animation: false, tooltip: { ...option.tooltip, showDelay: 0, transitionDuration: 0 } });
  const shown: { names: string[]; text: string }[] = [];
  for (const instant of instants) {
    const names: string[] = [];
    const [x] = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [instant, 25]) as number[];
    chart.dispatchAction({ type: "showTip", x, y: 200 });
    // The tooltip is the HTML box beside the chart's SVG, not the box that holds it.
    const tip = [...el.querySelectorAll("div")].find((div) => div.querySelector("svg") === null && div.textContent !== "");
    const text = tip?.textContent ?? "";
    for (const name of ["kw", ANOMALY_MARK_NAME]) {
      if (text.includes(name)) names.push(name);
    }
    shown.push({ names, text });
    chart.dispatchAction({ type: "hideTip" });
  }
  chart.dispose();
  el.remove();
  return shown;
}

/**
 * At the unusual hour's start (and a pointer a few minutes off it) the tooltip lists the actual
 * bucket and the mark, with the mark's score, detectors and points; a quarter-hour later, and at
 * an ordinary hour, the mark is not in it.
 */
export function theMarkJoinsOnlyItsHoursTooltip(): void {
  const [atHour, nearHour, quarterPast, otherHour] = tooltipsAt([
    FROM + 2 * HOUR,
    FROM + 2 * HOUR - 4 * 60_000,
    FROM + 2 * HOUR + 15 * 60_000,
    FROM + 4 * HOUR,
  ]);
  expect(atHour?.names).toEqual(["kw", ANOMALY_MARK_NAME]);
  expect(atHour?.text).toContain("score 0.9987 · Baseline, Isolation Forest · pf, kvar");
  expect(nearHour?.names).toEqual(["kw", ANOMALY_MARK_NAME]);
  expect(quarterPast?.names).toEqual(["kw"]);
  expect(otherHour?.names).toEqual(["kw"]);
}
