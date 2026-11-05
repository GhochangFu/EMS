import { render } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { EnergyTopConsumer } from "@bms/shared";

import { EnergyTopBarChart } from "./energy-top-bar-chart";

/**
 * `F4.316` PR 6 (ADR 0111) — the top-consumers bar chart names each bar by the asset label,
 * `<code> · <RTU>` (else `<code> · <location>`), then the first 18 characters of the name.
 * `echarts-for-react` is stubbed to record the `option` it receives (jsdom has no canvas; the
 * `charts-follow-theme.spec.tsx` shape). Entry point: `energy-top-bar-chart.test.tsx`.
 */

type RecordedProps = {
  option: {
    grid: { containLabel?: boolean };
    yAxis: { data: string[]; axisLabel: { overflow?: string; width?: number } };
  };
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

function consumer(overrides: Partial<EnergyTopConsumer> = {}): EnergyTopConsumer {
  return {
    assetId: "a1",
    code: "PHE-MFM-000000003",
    assetRtuName: "Lotapata I",
    assetLocationName: "Lotapata",
    name: "Main incomer energy meter",
    siteName: "Lotapata",
    avgKw: 40,
    estimatedKwh: 960,
    ...overrides,
  };
}

function optionFor(consumers: EnergyTopConsumer[]): RecordedProps["option"] {
  render(<EnergyTopBarChart consumers={consumers} status="ready" />);
  const props = recorded.at(-1);
  if (!props) throw new Error("the chart rendered no <ReactECharts>");
  return props.option;
}

function axisLabels(consumers: EnergyTopConsumer[]): string[] {
  return optionFor(consumers).yAxis.data;
}

/** A consumer under an RTU: `<code> · <RTU> · <name, 18 characters>`. */
export function aBarUnderAnRtuIsNamedByTheLabel(): void {
  expect(axisLabels([consumer()])).toEqual(["PHE-MFM-000000003 · Lotapata I · Main incomer energ"]);
}

/** The RTU-less twin: `<code> · <location> · <name, 18 characters>`. */
export function aBarWithNoRtuIsNamedByItsLocation(): void {
  expect(axisLabels([consumer({ assetRtuName: null })])).toEqual(["PHE-MFM-000000003 · Lotapata · Main incomer energ"]);
}

/** ADR 0111 C4 — the long label is never clipped: the grid contains it and the axis label breaks onto a new line. */
export function theLabelIsContainedAndBreaksRatherThanClips(): void {
  const option = optionFor([consumer()]);
  expect([option.grid.containLabel, option.yAxis.axisLabel.overflow]).toEqual([true, "break"]);
}
