import type { SiteTrendPointsDto } from "@bms/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";

import { fetchSiteTrendPoints } from "../../api/site-trend-points";
import type { WidgetConfigRow } from "../../lib/widget-config-form";
import {
  TREND_STRIP_SELECTION_NO_SITE_SENTENCE,
  TREND_STRIP_STALE_MARKER,
  TrendStripSelectionSummary,
} from "./trend-strip-selection-summary";

/**
 * `F4.306` PR 2 U10 (ADR 0108 Amendment 7; owner OQ2) — the builder's stale-code marker: the
 * stored selection of a `trend_strip` row, read against the site's effective lists. An entry the
 * list no longer holds is marked and offers Remove; a listed one is neither (each its own `it`, so
 * an inverted predicate reddens both). An emptied field is written `undefined`, never `[]` (the
 * write schema's `.min(1)` refuses an empty list).
 *
 * The api module is mocked; `fetch` is a rejecting spy, and {@link cleanupSelectionSummary} fails
 * the case if anything reached it. Assertions live here; `trend-strip-selection-summary.test.tsx`
 * is the Vitest entry point and carries the jsdom docblock (ADR 0014, ADR 0042 decision 2).
 */

vi.mock("../../api/site-trend-points", () => ({ fetchSiteTrendPoints: vi.fn() }));

const fetchLists = vi.mocked(fetchSiteTrendPoints);
let fetchSpy: ReturnType<typeof vi.fn> = vi.fn();

const LOCATION_ID = "0b7e2f4a-1c3d-4e5f-8a9b-0c1d2e3f4a5b";

type Selection = Pick<WidgetConfigRow, "stripSegments" | "stripPoints" | "stripColors" | "stripStyles">;

const LISTS: SiteTrendPointsDto = {
  locationId: LOCATION_ID,
  organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  segments: [
    {
      domain: "seg_a",
      label: "Segment A",
      source: "organization",
      points: [
        { code: "pt_x", name: "Point X", unit: "kW", active: true },
        { code: "pt_y", name: "Point Y", unit: null, active: true },
      ],
      catalogDefaults: [],
      updatedAt: null,
      updatedBy: null,
    },
  ],
};

function renderSummary(selection: Selection, locationId: string | null = LOCATION_ID): ReturnType<typeof vi.fn> {
  fetchSpy = vi.fn(() => Promise.reject(new Error("selection summary spec: an unmocked read reached fetch")));
  vi.stubGlobal("fetch", fetchSpy);
  fetchLists.mockResolvedValue(LISTS);
  const onChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TrendStripSelectionSummary
        locationId={locationId}
        segments={selection.stripSegments}
        points={selection.stripPoints}
        colors={selection.stripColors}
        styles={selection.stripStyles}
        onChange={onChange}
      />
    </QueryClientProvider>,
  );
  return onChange;
}

/** Unmounts, restores the stubbed `fetch`, clears the mock, and fails the case on a raw read. */
export function cleanupSelectionSummary(): void {
  cleanup();
  const calls = fetchSpy.mock.calls.length;
  vi.unstubAllGlobals();
  fetchLists.mockReset();
  expect(calls, "an unmocked read reached fetch").toBe(0);
}

/** The list item that names `text`, once the lists have arrived. */
async function itemFor(text: string): Promise<HTMLElement> {
  const label = await screen.findByText(text);
  const item = label.closest("li");
  if (item === null) throw new Error(`no list item holds ${text}`);
  return item;
}

const STALE_AND_LISTED: Selection = {
  stripSegments: ["seg_a"],
  stripPoints: ["seg_a:pt_x", "seg_a:gone"],
};

/** A stored point whose code is not on its segment's list carries the marker and a Remove. */
export async function aStalePointShowsTheMarkerAndARemove(): Promise<void> {
  renderSummary(STALE_AND_LISTED);
  await waitFor(() => expect(fetchLists).toHaveBeenCalledWith(LOCATION_ID));
  const item = await itemFor("seg_a:gone");
  await waitFor(() => expect(within(item).getByText(TREND_STRIP_STALE_MARKER)).toBeInTheDocument());
  expect(within(item).getByRole("button", { name: "Remove seg_a:gone" })).toBeInTheDocument();
}

/** A stored point on its segment's list shows its name, and neither the marker nor a Remove. */
export async function aListedPointShowsNeither(): Promise<void> {
  renderSummary(STALE_AND_LISTED);
  const item = await itemFor("Point X");
  expect(within(item).queryByText(TREND_STRIP_STALE_MARKER)).toBeNull();
  expect(within(item).queryByRole("button", { name: /^Remove/ })).toBeNull();
}

/** A stored segment the site no longer lists carries the marker; a listed one shows its label. */
export async function aStaleSegmentShowsTheMarker(): Promise<void> {
  renderSummary({ stripSegments: ["seg_a", "seg_gone"] });
  const stale = await itemFor("seg_gone");
  await waitFor(() => expect(within(stale).getByText(TREND_STRIP_STALE_MARKER)).toBeInTheDocument());
  const listed = await itemFor("Segment A");
  expect(within(listed).queryByText(TREND_STRIP_STALE_MARKER)).toBeNull();
}

/** A point's colour role is shown beside it; one without an entry shows "Default". */
export async function eachPointShowsItsColourRole(): Promise<void> {
  renderSummary({ stripPoints: ["seg_a:pt_x", "seg_a:pt_y"], stripColors: { "seg_a:pt_x": "series-2" } });
  expect(within(await itemFor("Point X")).getByText("series-2")).toBeInTheDocument();
  expect(within(await itemFor("Point Y")).getByText("Default")).toBeInTheDocument();
}

/** Removing the row's last point writes `stripPoints: undefined` — the key present, never `[]`. */
export async function removingTheLastPointWritesUndefined(): Promise<void> {
  const onChange = renderSummary({ stripSegments: ["seg_a"], stripPoints: ["seg_a:gone"] });
  await userEvent.click(await screen.findByRole("button", { name: "Remove seg_a:gone" }));
  const patch = onChange.mock.calls[0]?.[0] as Selection;
  expect(Object.prototype.hasOwnProperty.call(patch, "stripPoints")).toBe(true);
  expect(patch.stripPoints).toBeUndefined();
  expect(patch.stripSegments).toEqual(["seg_a"]);
}

/** A `colors` entry goes with its point; the other point keeps its own. */
export async function aColourIsDroppedWithItsPoint(): Promise<void> {
  const onChange = renderSummary({
    stripPoints: ["seg_a:pt_x", "seg_a:gone"],
    stripColors: { "seg_a:pt_x": "series-1", "seg_a:gone": "series-2" },
  });
  await userEvent.click(await screen.findByRole("button", { name: "Remove seg_a:gone" }));
  const patch = onChange.mock.calls[0]?.[0] as Selection;
  expect(patch.stripPoints).toEqual(["seg_a:pt_x"]);
  expect(patch.stripColors).toEqual({ "seg_a:pt_x": "series-1" });
}

/** Removing a stale segment drops the segment, its points and their colours; an emptied field is `undefined`. */
export async function removingAStaleSegmentDropsItsPointsAndColours(): Promise<void> {
  const onChange = renderSummary({
    stripSegments: ["seg_a", "seg_gone"],
    stripPoints: ["seg_gone:p1"],
    stripColors: { "seg_gone:p1": "series-3" },
    stripStyles: { "seg_gone:p1": "bar" },
  });
  await userEvent.click(await screen.findByRole("button", { name: "Remove seg_gone" }));
  const patch = onChange.mock.calls[0]?.[0] as Selection;
  expect(patch.stripSegments).toEqual(["seg_a"]);
  expect(Object.prototype.hasOwnProperty.call(patch, "stripPoints")).toBe(true);
  expect(patch.stripPoints).toBeUndefined();
  expect(patch.stripColors).toBeUndefined();
  expect(patch.stripStyles, "F4.322 — the segment's styles go with it").toBeUndefined();
}

/** Clear selection writes every selection field `undefined` (four since `F4.322`). */
export async function clearSelectionWritesEveryFieldUndefined(): Promise<void> {
  const onChange = renderSummary({
    stripSegments: ["seg_a"],
    stripPoints: ["seg_a:pt_x"],
    stripColors: { "seg_a:pt_x": "series-1" },
  });
  await userEvent.click(screen.getByRole("button", { name: "Clear selection" }));
  const patch = onChange.mock.calls[0]?.[0] as Selection;
  // `F4.322` PR 3 — `stripStyles` is cleared with the other three.
  expect(Object.keys(patch).sort()).toEqual(["stripColors", "stripPoints", "stripSegments", "stripStyles"]);
  expect(Object.values(patch).every((value) => value === undefined)).toBe(true);
}

/** A dashboard with no site shows one sentence and reads nothing. */
export async function noLocationReadsNothing(): Promise<void> {
  renderSummary(STALE_AND_LISTED, null);
  expect(screen.getByText(TREND_STRIP_SELECTION_NO_SITE_SENTENCE)).toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(fetchLists).not.toHaveBeenCalled();
}

/** `F4.322` PR 3 (ADR 0108 Amendment 8) — a `styles` entry goes with its point, as a colour does. */
export async function aStyleIsDroppedWithItsPoint(): Promise<void> {
  const onChange = renderSummary({
    stripPoints: ["seg_a:pt_x", "seg_a:gone"],
    stripStyles: { "seg_a:pt_x": "bar", "seg_a:gone": "area" },
  });
  await userEvent.click(await screen.findByRole("button", { name: "Remove seg_a:gone" }));
  const patch = onChange.mock.calls[0]?.[0] as Selection;
  expect(patch.stripStyles).toEqual({ "seg_a:pt_x": "bar" });
}
