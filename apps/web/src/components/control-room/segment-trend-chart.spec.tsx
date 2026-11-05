import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { SegmentViewRankingEntryDto } from "@bms/shared";

import { SegmentTrendChart } from "./segment-trend-chart";

/**
 * `F4.302` U4 (ADR 0108 Amendment 4 items 4, 7) — the top assets' chart: one unit axis, one
 * solid line per drawn asset, its previous period dashed and moved by `+span`, and a legend
 * whose entries open the asset's history. `echarts-for-react` is stubbed to record the option
 * (jsdom has no canvas). Entry point: `segment-trend-chart.test.tsx`.
 */

type Series = { name: string; lineStyle?: { type?: string }; data: [string, number | null][] };
type Recorded = { option: { yAxis: { name?: string }; series: Series[] } };

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

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CURRENT = { from: "2026-10-30T00:00:00.000Z", to: "2026-10-30T23:59:59.999Z", durationHours: 24 };
const COMPARE = { from: "2026-10-29T00:00:00.000Z", to: "2026-10-29T23:59:59.999Z", durationHours: 24 };

const DRAWN: SegmentViewRankingEntryDto = {
  assetId: A,
  assetCode: "A1",
  assetName: "Asset A1",
  assetRtuName: "RTU 1",
  assetLocationName: "Site 1",
  unit: "kW",
  current: { mean: 5, max: 9, maxAt: null, sampleCount: 10 },
  compare: { mean: 4, max: 8, maxAt: null, sampleCount: 10 },
  buckets: [{ t: "2026-10-30T01:00:00.000Z", v: 5 }],
  compareBuckets: [{ t: "2026-10-29T01:00:00.000Z", v: 4 }],
};

function renderChart(compare: typeof COMPARE | null, drawn: SegmentViewRankingEntryDto = DRAWN): void {
  render(
    <MemoryRouter>
      <SegmentTrendChart ranking={[drawn]} current={CURRENT} compare={compare} unit="kW" pointCode="kw" />
    </MemoryRouter>,
  );
}

/** The compare series is dashed and lands on the current window (`+span`). */
export function drawsTheCompareDashedAndShifted(): void {
  renderChart(COMPARE);
  const series = recorded.at(-1)?.option.series ?? [];
  expect(series.map((s) => [s.lineStyle?.type ?? "solid", s.data])).toEqual([
    ["solid", [["2026-10-30T01:00:00.000Z", 5]]],
    ["dashed", [["2026-10-30T01:00:00.000Z", 4]]],
  ]);
}

/** Without compare there is no dashed series. */
export function drawsNoCompareWhenOff(): void {
  renderChart(null);
  const series = recorded.at(-1)?.option.series ?? [];
  expect(series.map((s) => s.lineStyle?.type ?? "solid")).toEqual(["solid"]);
}

/** One unit axis, named by the point's unit. */
export function namesTheOneUnitAxis(): void {
  renderChart(null);
  expect(recorded.at(-1)?.option.yAxis.name).toBe("kW");
}

/** The legend entry opens the asset's history over the exact window. */
export function theLegendOpensTheHistory(): void {
  renderChart(COMPARE);
  const link = screen.getByRole("link", { name: "A1 · RTU 1 Asset A1" });
  expect(link.getAttribute("href")?.startsWith(`/asset-history/${A}?from=`)).toBe(true);
  expect(link.getAttribute("href")?.endsWith("&points=kw&compare=1")).toBe(true);
}

/** `F4.316` (ADR 0111) — the legend entry reads `<code> · <RTU>`. */
export function theLegendEntryReadsTheAssetLabel(): void {
  renderChart(null);
  const legend = screen.getByRole("list", { name: "Chart legend" });
  expect(legend.textContent).toBe("A1 · RTU 1");
}

/** `F4.316` (ADR 0111) — an RTU-less asset's legend entry reads `<code> · <location>`. */
export function anRtuLessLegendEntryReadsTheLocation(): void {
  renderChart(null, { ...DRAWN, assetRtuName: null });
  const legend = screen.getByRole("list", { name: "Chart legend" });
  expect(legend.textContent).toBe("A1 · Site 1");
}

/** `F4.316` (ADR 0111) — each line is named by the label; the previous period appends to it. */
export function theSeriesAreNamedByTheAssetLabel(): void {
  renderChart(COMPARE);
  const series = recorded.at(-1)?.option.series ?? [];
  expect(series.map((s) => s.name)).toEqual(["A1 · RTU 1", "A1 · RTU 1 · previous period"]);
}

/** No drawn asset is a fixed sentence and no chart. */
export function noSeriesIsAFixedSentence(): void {
  render(
    <MemoryRouter>
      <SegmentTrendChart ranking={[]} current={CURRENT} compare={null} unit="kW" pointCode="kw" />
    </MemoryRouter>,
  );
  expect(screen.getByText("No telemetry for this point in this period.")).toBeInTheDocument();
  expect(recorded).toHaveLength(0);
}
