import { render, screen } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { DashboardWidgetDto } from "@bms/shared";

import { DashboardWidget, type WidgetData } from "./dashboard-widget";

/**
 * `F3.35` Stage A — what a person sees when a widget carries an aggregate
 * (ADR 0048 decisions 3 and 6).
 *
 * Assertions live here; `dashboard-widget-aggregate.test.tsx` is the Vitest
 * entry point and carries the `@vitest-environment jsdom` docblock, because
 * that is the file Vitest collects (ADR 0014, ADR 0042 decision 2).
 *
 * Its own file rather than more of `dashboard-widget.spec.tsx`: these are about
 * a footer and a sub-line that did not exist before this row, and they need a
 * `WidgetData` carrying `stats`/`compareValue` that no other assertion in that
 * file builds.
 *
 * **`echarts-for-react` renders nothing here, exactly as it does there.** ECharts
 * draws onto a canvas and jsdom implements none, so the plot itself is not
 * asserted — but the footer is ordinary DOM beside it, and that is precisely
 * what makes it assertable when the chart is not.
 */

vi.mock("echarts-for-react", () => ({
  default: () => null,
}));

const IDENTITY = {
  id: "11111111-1111-4111-8111-111111111111",
  dashboardId: "22222222-2222-4222-8222-222222222222",
  organizationId: "33333333-3333-4333-8333-333333333333",
  gridX: 0,
  gridY: 0,
  gridW: 4,
  gridH: 4,
  points: [],
  // `F3.35` Stage C — the second binding array. Empty here: these fixtures
  // exercise Stage A's aggregation, which is a point-bound path.
  sources: [],
};

const STATS = {
  sum: 2_705.5,
  average: 12.1,
  min: 0,
  max: 18.4,
  peakAt: "2026-08-30T22:10:00.000Z",
  sampleCount: 1_440,
};

function chartWithFooter(config: Record<string, unknown> = {}): DashboardWidgetDto {
  return {
    ...IDENTITY,
    title: "Plant load",
    widgetType: "chart",
    config: { series: "line", aggregate: "avg", footerStats: true, decimals: 1, ...config },
  } as DashboardWidgetDto;
}

function tile(config: Record<string, unknown> = {}): DashboardWidgetDto {
  return {
    ...IDENTITY,
    title: "Energy today",
    widgetType: "value_tile",
    config: { unit: "kWh", decimals: 2, ...config },
  } as DashboardWidgetDto;
}

const readyChart = (overrides: Partial<WidgetData> = {}): WidgetData =>
  ({
    status: "ready",
    primary: null,
    series: [],
    stale: false,
    stats: STATS,
    bucketSeconds: 60,
    ...overrides,
  }) as WidgetData;

/**
 * The footer renders its three cells, and only when the config asks.
 *
 * The negative half is the one that matters: `footerStats` is optional and
 * absent on every chart saved before `F3.35`, so a footer that rendered
 * unconditionally would appear under every existing chart in the product.
 */
export function theChartFooterRendersItsThreeCellsOnlyWhenAsked(): void {
  const { container } = render(
    <DashboardWidget widget={chartWithFooter({ unit: "MW" })} data={readyChart()} />,
  );
  expect(screen.getByText("Peak")).toBeTruthy();
  expect(screen.getByText("Average")).toBeTruthy();
  expect(screen.getByText("Granularity")).toBeTruthy();
  // Read off the container rather than through `getByText`: the peak cell holds
  // the value and its bucket time in two nodes, so an exact-node match would
  // fail on the markup rather than on the number.
  const footer = container.textContent ?? "";
  expect(footer.includes("18.4 MW"), "the peak reads the max statistic, with the config's unit").toBe(
    true,
  );
  expect(footer.includes("12.1 MW"), "the average reads the weighted mean the server computed").toBe(
    true,
  );

  const without = render(
    <DashboardWidget widget={chartWithFooter({ footerStats: undefined })} data={readyChart()} />,
  );
  expect(
    without.container.textContent?.includes("Granularity"),
    "a chart that did not ask for the footer must not grow one",
  ).toBe(false);
}

/**
 * The granularity cell names the bucket width the response reported.
 *
 * This is the cell that makes the ladder's cliff visible: a 2,880-minute window
 * plots minute buckets and a 2,881-minute one plots hourly buckets, from the
 * author's own configured window. Without it the change is only inferable from
 * the plot's shape.
 */
export function theGranularityCellNamesTheBucketWidth(): void {
  render(<DashboardWidget widget={chartWithFooter()} data={readyChart({ bucketSeconds: 60 })} />);
  expect(screen.getByText("1 min")).toBeTruthy();

  render(<DashboardWidget widget={chartWithFooter()} data={readyChart({ bucketSeconds: 3_600 })} />);
  expect(screen.getByText("1 hour")).toBeTruthy();
}

/**
 * A window with no samples renders em dashes, never `"null"` or
 * `"Invalid Date"`.
 *
 * Both are strings a `toLocaleString`/template-literal path prints happily, and
 * both read to an operator like a value rather than like an absence.
 */
export function anEmptyWindowRendersEmDashesNotNullOrInvalidDate(): void {
  const empty = render(
    <DashboardWidget
      widget={chartWithFooter()}
      data={readyChart({
        stats: { sum: null, average: null, min: null, max: null, peakAt: null, sampleCount: 0 },
        bucketSeconds: null,
      })}
    />,
  );
  const text = empty.container.textContent ?? "";
  expect(text.includes("null"), "an empty window must not print the string 'null'").toBe(false);
  expect(text.includes("—"), "an empty window renders the em dash the rest of the UI uses").toBe(true);

  // **A SECOND render, with an unparseable timestamp** (code review). The block
  // above sets `peakAt: null`, so `peakLabel` is never called and its
  // `Number.isNaN` arm goes unexercised — the "must not print Invalid Date"
  // assertion passed without touching the guard it was named for. This is the
  // one that reaches it: `new Date("not-a-date").toLocaleTimeString()` returns
  // the literal string "Invalid Date", which reads to an operator like a value.
  const malformed = render(
    <DashboardWidget
      widget={chartWithFooter()}
      data={readyChart({ stats: { ...STATS, peakAt: "not-a-date" } })}
    />,
  );
  expect(
    malformed.container.textContent?.includes("Invalid Date"),
    "an unparseable peak timestamp must render the em dash, not the string 'Invalid Date'",
  ).toBe(false);
}

/**
 * The tile's three presentation fields reach the DOM: the icon as an element
 * built from its name, the tone as `KpiTile`'s own border class, and the
 * author's sub-line.
 *
 * The icon is the one a pure spec cannot hold. `widget-value.ts` is `.ts` and
 * can only carry the **name**; whether that name became an `<svg>` is a
 * question about a `.tsx`, and this is where it is asked.
 */
export function theTilesIconToneAndSubLineReachTheDom(): void {
  const { container } = render(
    <DashboardWidget
      widget={tile({ icon: "bolt", tone: "critical", hint: "Since midnight" })}
      data={{ status: "ready", primary: 112.75, series: [], stale: false }}
    />,
  );
  expect(container.querySelector("svg"), "a config icon name must become a real element").toBeTruthy();
  expect(screen.getByText("Since midnight"), "the author's sub-line must render").toBeTruthy();
  expect(
    container.querySelector(".border-red-200"),
    "a critical tone must reach KpiTile's own critical border, through the existing tone map",
  ).toBeTruthy();
}

/**
 * The computed delta takes the hint slot, and the author's hint does not also
 * render.
 *
 * Two lines would double the tile's height and the mock shows one. Asserting
 * the author's hint is **absent** is what makes this a precedence test rather
 * than a "does the delta render" test.
 */
export function theComputedDeltaTakesTheHintSlotAlone(): void {
  const { container } = render(
    <DashboardWidget
      widget={tile({ compareToPrevious: true, hint: "Author-typed note" })}
      data={{
        status: "ready",
        primary: 112.75,
        series: [],
        stale: false,
        compareValue: 121.0,
      }}
    />,
  );
  expect(screen.getByText("↓ 6.8% vs yesterday"), "the delta must render in the sub-line").toBeTruthy();
  expect(
    container.textContent?.includes("Author-typed note"),
    "the author's hint must not render beside the delta — one slot, not two lines",
  ).toBe(false);
}
