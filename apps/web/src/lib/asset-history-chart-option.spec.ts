import { expect } from "vitest";

import { ROLE_TOKENS, fromTokenMap } from "../test-role-tokens";
import { buildHistoryChartOption, type HistorySeriesInput } from "./asset-history-chart-option";
import { resolveRoles } from "./theme";
import { CHART_SERIES } from "./widget-catalog";

const roles = resolveRoles(fromTokenMap(ROLE_TOKENS.light));

const FROM = Date.parse("2026-10-31T00:00:00.000Z");
const TO = Date.parse("2026-10-31T02:00:00.000Z");
const SPAN = TO - FROM;

/** A minimal read of the parts of the option these assertions look at. */
interface Shape {
  readonly xAxis: { readonly type: string; readonly min: number; readonly max: number };
  readonly yAxis: readonly { readonly name?: string }[];
  readonly series: readonly {
    readonly name: string;
    readonly type: string;
    readonly yAxisIndex: number;
    readonly lineStyle?: { readonly type?: string };
    readonly data: readonly [string, number | null][];
  }[];
}

function build(series: readonly HistorySeriesInput[], compare: { spanMs: number } | null): Shape {
  return buildHistoryChartOption({ from: FROM, to: TO, series, compare, roles }) as unknown as Shape;
}

const kw: HistorySeriesInput = {
  name: "kw",
  unit: "kW",
  buckets: [{ t: "2026-10-31T00:00:00.000Z", v: 1 }],
  compareBuckets: [{ t: "2026-10-30T22:00:00.000Z", v: 5 }],
};
const volts: HistorySeriesInput = { name: "v", unit: "V", buckets: [{ t: "2026-10-31T00:00:00.000Z", v: 230 }] };

/** The time axis is pinned to the window the user asked for. */
export function theXAxisIsTheRequestedWindow(): void {
  const option = build([kw], null);
  expect(option.xAxis).toMatchObject({ type: "time", min: FROM, max: TO });
}

/** Compare series are dashed and sit on the current window (their `t` shifted by the span). */
export function compareSeriesAreDashedAndShifted(): void {
  const option = build([kw], { spanMs: SPAN });
  expect(option.series).toHaveLength(2);
  const compare = option.series[1];
  expect(compare.lineStyle?.type).toBe("dashed");
  expect(compare.data).toEqual([["2026-10-31T00:00:00.000Z", 5]]);
  expect(option.series[0].lineStyle?.type).not.toBe("dashed");
}

/** No compare, no compare series. */
export function noCompareMeansNoDashedSeries(): void {
  expect(build([kw], null).series).toHaveLength(1);
}

/** The series type is the catalog's, not a literal. */
export function theSeriesTypeComesFromTheCatalog(): void {
  expect(build([kw], null).series[0].type).toBe(CHART_SERIES.line.type);
}

/** A second unit gets a second axis and `yAxisIndex: 1`. */
export function aSecondUnitGetsASecondAxis(): void {
  const option = build([kw, volts], null);
  expect(option.yAxis).toHaveLength(2);
  expect(option.series.map((s) => s.yAxisIndex)).toEqual([0, 1]);
}

/** One series (or one unit) keeps one axis. */
export function oneUnitKeepsOneAxis(): void {
  const option = build([kw, { ...kw, name: "kw2" }], null);
  expect(option.yAxis).toHaveLength(1);
  expect(option.series.map((s) => s.yAxisIndex)).toEqual([0, 0]);
}
