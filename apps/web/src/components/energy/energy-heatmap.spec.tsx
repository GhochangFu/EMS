import { render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { EnergyHeatmapCell } from "@bms/shared";

import { colourMax } from "../../lib/energy-organization-views";
import { EnergyHeatmap } from "./energy-heatmap";

/**
 * `F4.299` U6 — the day x hour heatmap. `echarts-for-react` is stubbed to
 * record the option. Entry point: `energy-heatmap.test.tsx`.
 */

type Recorded = {
  option: {
    series: { type: string; data: unknown[] }[];
    visualMap: { max: number; min: number };
    xAxis: { data: string[] };
    yAxis: { data: string[] };
  };
};

const recorded = vi.hoisted(() => [] as Recorded[]);

vi.mock("echarts-for-react", () => ({
  default: (props: Recorded) => {
    recorded.push(props);
    return null;
  },
}));

export function resetRecorded(): void {
  recorded.length = 0;
}

function last(): Recorded["option"] {
  const props = recorded.at(-1);
  if (!props) throw new Error("the heatmap rendered no <ReactECharts>");
  return props.option;
}

/** Two days, three cells, one far above the rest so P95 differs from the max. */
const SPARSE: EnergyHeatmapCell[] = [
  { day: "2026-10-31", hour: 15, kwh: 10 },
  { day: "2026-10-30", hour: 0, kwh: 2 },
  { day: "2026-10-31", hour: 1, kwh: 4 },
];

/** One whole day: every hour holds data. */
const WHOLE_DAY: EnergyHeatmapCell[] = Array.from({ length: 24 }, (_, hour) => ({ day: "2026-10-31", hour, kwh: hour + 1 }));

export function oneHeatmapSeriesWithOnePointPerCell(): void {
  render(<EnergyHeatmap cells={SPARSE} status="ready" />);
  const option = last();
  expect(option.series).toHaveLength(1);
  expect(option.series[0].type).toBe("heatmap");
  expect(option.series[0].data).toHaveLength(SPARSE.length);
}

export function theColourScaleTopIsTheNearestRankP95(): void {
  render(<EnergyHeatmap cells={WHOLE_DAY} status="ready" />);
  const option = last();
  expect(option.visualMap.min).toBe(0);
  expect(option.visualMap.max).toBe(colourMax(WHOLE_DAY));
  expect(option.visualMap.max).not.toBe(24);
}

export function theAxesAre24HoursAndTheDays(): void {
  render(<EnergyHeatmap cells={SPARSE} status="ready" />);
  const option = last();
  expect(option.yAxis.data).toHaveLength(24);
  expect(option.xAxis.data).toEqual(["2026-10-30", "2026-10-31"]);
}

/** A missing cell names the blank as "no data". */
export function aMissingCellIsLabelledNoData(): void {
  render(<EnergyHeatmap cells={SPARSE} status="ready" />);
  expect(screen.getByText("Blank cells: no data")).toBeInTheDocument();
}

/** The negative pair: a full grid carries no "no data" label. */
export function aFullGridHasNoNoDataLabel(): void {
  render(<EnergyHeatmap cells={WHOLE_DAY} status="ready" />);
  expect(last().series[0].data).toHaveLength(24);
  expect(screen.queryByText("Blank cells: no data")).toBeNull();
}

/** `error` is a fixed sentence (`F4.204`). */
export function anErrorHeatmapRendersTheFixedSentence(): void {
  render(<EnergyHeatmap cells={[]} status="error" />);
  expect(screen.getByText("Could not load the heatmap.")).toBeInTheDocument();
  expect(recorded).toHaveLength(0);
}
