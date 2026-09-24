import { render, screen, within } from "@testing-library/react";
import { expect, vi } from "vitest";

import { emptySlice, type SchematicTelemetrySlice } from "../../lib/schematic-telemetry";
import { KeyParameters } from "./key-parameters";

/**
 * `F3.28` task 3.6 — the `/cr-overview` Key Parameters gauges.
 *
 * `echarts-for-react` is stubbed: nothing here needs a real chart, and the
 * stub exposes the `option` `RadialGaugeWidget` built, so the `primary`
 * claim is checked through the rendered needle value rather than reaching
 * into `KeyParameters`' internals. `buildRadialGaugeOption` puts the reading
 * at `series[0].data[0].value`, clamped between `config.min` and `config.max`
 * — a `null` primary falls back to `config.min` (`radial-gauge-widget.tsx`).
 */

const mocks = vi.hoisted(() => ({ gaugeValue: vi.fn() }));

vi.mock("echarts-for-react", () => ({
  default: (props: { option: { series: [{ data: [{ value: number }] }] } }) => {
    mocks.gaugeValue(props.option.series[0].data[0].value);
    return <div data-testid="echarts-stub" />;
  },
}));

const NOW = Date.parse("2026-09-24T10:00:00.000Z");
const LIVE_SEEN_MS = NOW - 1_000;
const STALE_SEEN_MS = NOW - 30_000;

function liveSlice(overrides: Partial<SchematicTelemetrySlice> = {}): SchematicTelemetrySlice {
  return { ...emptySlice(), lastSeenMs: LIVE_SEEN_MS, ...overrides };
}

function renderGauges(overrides: Partial<Record<"ups1" | "ups2" | "batt1" | "batt2" | "main", SchematicTelemetrySlice>> = {}): void {
  render(
    <KeyParameters
      ups1={liveSlice({ loadPct: 42 })}
      ups2={liveSlice({ loadPct: 55 })}
      batt1={liveSlice({ healthPct: 90 })}
      batt2={liveSlice({ healthPct: 80 })}
      main={liveSlice({ pf: 0.95 })}
      nowMs={NOW}
      {...overrides}
    />,
  );
}

/** All four gauge titles render, in order. */
export function rendersTheFourGaugeTitles(): void {
  renderGauges();
  expect(screen.getByText("UPS-1 Load")).toBeInTheDocument();
  expect(screen.getByText("UPS-2 Load")).toBeInTheDocument();
  expect(screen.getByText("Battery Health")).toBeInTheDocument();
  expect(screen.getByText("Main Power Factor")).toBeInTheDocument();
}

/**
 * UPS-1 stale: the "Offline" badge shows on its card, and its gauge needle
 * sits at `config.min` (0) — the rendered evidence of `primary: null`, since
 * a raw `loadPct` of 42 would move the needle away from 0.
 */
export function aStaleSliceRendersOfflineAndNoNeedleMovement(): void {
  renderGauges({ ups1: liveSlice({ loadPct: 42, lastSeenMs: STALE_SEEN_MS }) });
  const card = screen.getByText("UPS-1 Load").closest("div");
  expect(card, "no card around the UPS-1 Load title").toBeTruthy();
  expect(within(card as HTMLElement).getByText("Offline")).toBeInTheDocument();
  // The gauges render UPS-1 first; its needle value is the first stub call.
  expect(mocks.gaugeValue.mock.calls[0]?.[0]).toBe(0);
}
