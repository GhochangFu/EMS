import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import type { SiteSegmentViewsDto } from "@bms/shared";

import { SEGMENT_VIEWS_BODY } from "../../api/segment-views.spec";
import { SegmentView } from "./segment-view";

/**
 * `F4.302` U4 (ADR 0108 Amendment 4 items 2, 4, 8) — one segment sub-tab: the point selector, the
 * rollup line, the chart, the ranking and the abnormal list from one response; a segment whose
 * list holds no point shows the fixed sentence that points at Reference Data → Trend Points.
 * `echarts-for-react` is stubbed (jsdom has no canvas). Entry point: `segment-view.test.tsx`.
 */

vi.mock("echarts-for-react", () => ({ default: () => null }));

const BODY = {
  ...SEGMENT_VIEWS_BODY,
  points: [
    { code: "kw", name: "Power", unit: "kW" },
    { code: "pf", name: "Power factor", unit: null },
  ],
} as SiteSegmentViewsDto;

function renderView(data: SiteSegmentViewsDto, onPoint = vi.fn()): typeof onPoint {
  render(
    <MemoryRouter>
      <SegmentView data={data} onPoint={onPoint} />
    </MemoryRouter>,
  );
  return onPoint;
}

/** The selector lists the segment's points, the current one chosen, and a choice reaches the caller. */
export function thePointSelectorListsThePointsAndEmitsAChoice(): void {
  const onPoint = renderView(BODY);
  const select = screen.getByRole("combobox", { name: "Trend point" }) as HTMLSelectElement;
  expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
    ["kw", "Power (kW)"],
    ["pf", "Power factor"],
  ]);
  expect(select.value).toBe("kw");
  fireEvent.change(select, { target: { value: "pf" } });
  expect(onPoint).toHaveBeenCalledWith("pf");
}

/** The rollup line names the level, the bucket and the site zone. */
export function theRollupLineNamesTheZone(): void {
  renderView(BODY);
  expect(screen.getByText("5m rollup · 5 minute buckets · Asia/Kolkata")).toBeInTheDocument();
}

/** A segment with no point in its list shows the fixed sentence and no selector. */
export function aSegmentWithNoPointsSaysWhereToAddThem(): void {
  renderView({ ...BODY, points: [], point: null });
  expect(
    screen.getByText("No trend point is listed for this segment. Add one in Reference Data → Trend Points."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Trend point" })).toBeNull();
}

/** A trimmed chart names the cap. */
export function aTrimmedChartNamesTheCap(): void {
  renderView({ ...BODY, trimmed: true, seriesCount: 8 });
  expect(screen.getByText("The chart draws the top 8 assets by mean.")).toBeInTheDocument();
}
