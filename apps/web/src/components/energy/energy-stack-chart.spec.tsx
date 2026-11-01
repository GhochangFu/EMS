import { render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";

import { STACK_ID, type EnergyStack } from "../../lib/energy-stack-option";
import { EnergyStackChart } from "./energy-stack-chart";

/**
 * `F4.299` U6 — the generic stacked total-trend chart. `echarts-for-react` is
 * stubbed to record the option it receives (jsdom has no canvas). Entry point:
 * `energy-stack-chart.test.tsx`.
 */

type Recorded = { option: { series: { stack?: string; name: string }[] } };

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

const STACKS: EnergyStack[] = [
  { name: "Site one", colour: null, data: [["2026-10-31T00:00:00.000Z", 4]] },
  { name: "Site two", colour: null, data: [["2026-10-31T00:00:00.000Z", 6]] },
];

/** `ready` hands the chart one option whose stacks share the stack id. */
export function aReadyChartRendersTheStacks(): void {
  render(<EnergyStackChart stacks={STACKS} compareTotal={null} spanMs={0} status="ready" />);
  const option = recorded.at(-1)?.option;
  expect(option?.series.map((s) => s.name)).toEqual(["Site one", "Site two"]);
  expect(option?.series.every((s) => s.stack === STACK_ID)).toBe(true);
}

/** `empty` is a fixed sentence and no chart (the positive is the case above). */
export function anEmptyChartSaysSo(): void {
  render(<EnergyStackChart stacks={[]} compareTotal={null} spanMs={0} status="empty" />);
  expect(screen.getByText("No telemetry in this window — run the simulator.")).toBeInTheDocument();
  expect(recorded).toHaveLength(0);
}

/** `error` is a fixed sentence, never a raw error message (`F4.204`). */
export function anErrorChartRendersTheFixedSentence(): void {
  render(<EnergyStackChart stacks={STACKS} compareTotal={null} spanMs={0} status="error" />);
  expect(screen.getByText("Could not load the load profile.")).toBeInTheDocument();
  expect(recorded).toHaveLength(0);
}
