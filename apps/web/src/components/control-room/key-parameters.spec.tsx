import { render, screen, within } from "@testing-library/react";
import { expect, vi } from "vitest";

import { emptySlice, type SchematicTelemetrySlice } from "../../lib/schematic-telemetry";
import { WIDGET_TONE_COLOR, type WidgetTone } from "../../lib/widget-catalog";
import { KeyParameters } from "./key-parameters";

/**
 * `F3.28` task 3.6 — the `/cr-overview` Key Parameters gauges.
 *
 * `echarts-for-react` is stubbed: nothing here needs a real chart. The stub
 * writes two parts of the `option` `RadialGaugeWidget` built onto its own
 * element — the needle value (`series[0].data[0].value`) and the band colour
 * stops (`series[0].axisLine.lineStyle.color`) — so each claim reads the
 * gauge it names through its `group`, not through render order.
 */

type StubOption = {
  series: [{ data: [{ value: number }]; axisLine: { lineStyle: { color: [number, string][] } } }];
};

vi.mock("echarts-for-react", () => ({
  default: ({ option }: { option: StubOption }) => (
    <div
      data-testid="echarts-stub"
      data-needle={String(option.series[0].data[0].value)}
      data-bands={JSON.stringify(option.series[0].axisLine.lineStyle.color)}
    />
  ),
}));

const NOW = Date.parse("2026-09-24T10:00:00.000Z");
const LIVE_SEEN_MS = NOW - 1_000;
const STALE_SEEN_MS = NOW - 30_000;

type SliceName = "ups1" | "ups2" | "batt1" | "batt2" | "main";

function liveSlice(overrides: Partial<SchematicTelemetrySlice> = {}): SchematicTelemetrySlice {
  return { ...emptySlice(), lastSeenMs: LIVE_SEEN_MS, ...overrides };
}

function renderGauges(overrides: Partial<Record<SliceName, SchematicTelemetrySlice>> = {}): void {
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

function gauge(title: string): HTMLElement {
  return screen.getByRole("group", { name: title });
}

function dialOf(title: string): HTMLElement | null {
  return within(gauge(title)).queryByTestId("echarts-stub");
}

function needleOf(title: string): number | null {
  const needle = dialOf(title)?.dataset.needle;
  return needle === undefined ? null : Number(needle);
}

const TONE_BY_COLOR = new Map(
  (Object.entries(WIDGET_TONE_COLOR) as [WidgetTone, string][]).map(([tone, color]) => [color, tone]),
);

/**
 * The tone painted at each arc fraction. An ECharts colour stop paints the
 * segment ending at its fraction, so a point inside a segment takes the first
 * stop past it. Each sample sits inside a band, never on a boundary.
 */
function bandTonesAt(title: string, fractions: number[]): (WidgetTone | undefined)[] {
  const stops = JSON.parse(dialOf(title)?.dataset.bands ?? "[]") as [number, string][];
  return fractions.map((fraction) => {
    const stop = stops.find(([end]) => end > fraction);
    return stop ? TONE_BY_COLOR.get(stop[1]) : undefined;
  });
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
  expect(within(gauge("UPS-1 Load")).getByText("Offline")).toBeInTheDocument();
  expect(needleOf("UPS-1 Load")).toBe(0);
}

// ---------------------------------------------------------------------------
// Band colours (OQ3). Samples: UPS load 50 / 90 / 97 %, battery 50 / 80 / 95 %,
// power factor 0.5 / 0.95.
// ---------------------------------------------------------------------------

/** UPS load: ok below 80, warning from 80, critical from 95. */
export function upsLoadBandsRiseFromOkToCritical(): void {
  renderGauges();
  expect(bandTonesAt("UPS-1 Load", [0.5, 0.9, 0.97])).toEqual(["ok", "warning", "critical"]);
}

/** Battery health: critical below 70, warning below 85, ok from 85. */
export function batteryHealthBandsFallFromOkToCritical(): void {
  renderGauges();
  expect(bandTonesAt("Battery Health", [0.5, 0.8, 0.95])).toEqual(["critical", "warning", "ok"]);
}

/** Power factor: warning below 0.9, ok from 0.9. */
export function powerFactorBandsAreWarningBelowPointNine(): void {
  renderGauges();
  expect(bandTonesAt("Main Power Factor", [0.5, 0.95])).toEqual(["warning", "ok"]);
}
