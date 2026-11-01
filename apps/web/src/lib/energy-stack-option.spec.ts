import { expect } from "vitest";

import { ROLE_TOKENS, fromTokenMap } from "../test-role-tokens";
import { seriesPalette } from "./chart-theme";
import { STACK_ID, buildEnergyStackOption, type EnergyStack } from "./energy-stack-option";
import { resolveRoles } from "./theme";
import { CHART_SERIES } from "./widget-catalog";

/** `F4.299` U5 — the stacked total-trend option. */

const roles = resolveRoles(fromTokenMap(ROLE_TOKENS.light));
const T0 = "2026-10-31T00:00:00.000Z";
const SPAN = 2 * 3_600_000;

const stacks: EnergyStack[] = [
  { name: "A", colour: null, data: [[T0, 1]] },
  { name: "B", colour: roles.warning, data: [[T0, 2]] },
  { name: "C", colour: null, data: [[T0, 3]] },
];

interface Shape {
  readonly series: readonly {
    readonly name: string;
    readonly type: string;
    readonly stack?: string;
    readonly lineStyle?: { readonly type?: string };
    readonly itemStyle?: { readonly color?: string };
    readonly data: readonly [string, number][];
  }[];
}

function build(compareTotal: { t: string; v: number }[] | null): Shape {
  return buildEnergyStackOption({ stacks, compareTotal, spanMs: SPAN, roles }) as unknown as Shape;
}

export function everyStackSeriesSharesTheStackIdAndTheCatalogType(): void {
  const option = build(null);
  expect(STACK_ID).toBe("total");
  expect(option.series).toHaveLength(3);
  for (const series of option.series) {
    expect(series.stack).toBe(STACK_ID);
    expect(series.type).toBe(CHART_SERIES.line.type);
  }
}

export function theCompareSeriesIsDashedUnstackedAndShiftedBySpan(): void {
  const option = build([{ t: T0, v: 9 }]);
  expect(option.series).toHaveLength(4);
  const compare = option.series[3];
  expect(compare.lineStyle?.type).toBe("dashed");
  expect(compare.stack).toBeUndefined();
  expect(compare.data[0]).toEqual([new Date(Date.parse(T0) + SPAN).toISOString(), 9]);
}

export function stackColoursCycleThePaletteUnlessAStackNamesOne(): void {
  const palette = seriesPalette(roles);
  const option = build(null);
  expect(option.series[0].itemStyle?.color).toBe(palette[0]);
  expect(option.series[1].itemStyle?.color).toBe(roles.warning);
  expect(option.series[2].itemStyle?.color).toBe(palette[2]);
}

export function noCompareTotalMeansNoDashedSeries(): void {
  const option = build(null);
  expect(option.series.some((s) => s.lineStyle?.type === "dashed")).toBe(false);
}
