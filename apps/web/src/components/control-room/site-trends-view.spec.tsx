import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { expect, vi } from "vitest";

import type { SiteSegmentViewsDto } from "@bms/shared";

import * as segmentApi from "../../api/segment-views";
import { SEGMENT_VIEWS_BODY } from "../../api/segment-views.spec";
import { ApiError } from "../../lib/api-error";
import { SiteTrendsView } from "./site-trends-view";

/**
 * `F4.302` U4 (ADR 0108 Amendment 4 items 2, 3, 8) — the section's own nav: **Energy** first, then
 * one entry per segment the segment read names; `?view=` and `?point=` hold the selection. The
 * Energy sub-tab (`SiteEnergyView`, its own suite) is a stand-in recording its props; the segment
 * client is stubbed, and `echarts-for-react` too (jsdom has no canvas).
 * Entry point: `site-trends-view.test.tsx`.
 */

vi.mock("echarts-for-react", () => ({ default: () => null }));

vi.mock("./site-energy-view", () => ({
  SiteEnergyView: ({
    locationId,
    value,
    rankBy,
    onRankBy,
  }: {
    locationId: string;
    value: { range: string; from?: string; to?: string; compare?: string };
    rankBy: string;
    onRankBy: (next: string) => void;
  }) => (
    <div
      data-testid="site-energy-view"
      data-location-id={locationId}
      data-range={value.range}
      data-from={value.from ?? ""}
      data-to={value.to ?? ""}
      data-compare={value.compare ?? ""}
      data-rank-by={rankBy}
    >
      <button type="button" onClick={() => onRankBy("kwhPerM2")}>
        rank by intensity
      </button>
    </div>
  ),
}));

const SITE = SEGMENT_VIEWS_BODY.locationId;
const PATH = `/control-room/site/${SITE}/trends`;

const BODY = {
  ...SEGMENT_VIEWS_BODY,
  segments: [
    { domain: "chillers", label: "Chillers", assetCount: 2 },
    { domain: "pumps", label: "Pumps", assetCount: 1 },
  ],
  points: [
    { code: "kw", name: "Power", unit: "kW" },
    { code: "pf", name: "Power factor", unit: null },
  ],
} as SiteSegmentViewsDto;

function stubSegments(answer: SiteSegmentViewsDto | Error) {
  const spy = vi.spyOn(segmentApi, "fetchSiteSegmentViews");
  if (answer instanceof Error) {
    spy.mockRejectedValue(answer);
  } else {
    spy.mockResolvedValue(answer);
  }
  return spy;
}

function Probe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderAt(search: string): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`${PATH}${search}`]}>
        <Routes>
          <Route
            path="/control-room/site/:locationId/:tab"
            element={
              <>
                <SiteTrendsView locationId={SITE} />
                <Probe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function sectionNav(): Promise<HTMLElement> {
  return screen.findByRole("navigation", { name: "Trends sections" });
}

/** The bare section shows Energy, current, and asks the segment read for the default segment. */
export async function theBareSectionShowsEnergy(): Promise<void> {
  const spy = stubSegments(BODY);
  renderAt("");
  expect(await screen.findByTestId("site-energy-view")).toHaveAttribute("data-location-id", SITE);
  expect(spy).toHaveBeenCalledWith(SITE, { range: "24h" });
  const nav = await sectionNav();
  expect(within(nav).getByRole("link", { name: "Energy" })).toHaveAttribute("aria-current", "page");
}

/** The nav lists Energy, then one entry per segment of the response, by its label. */
export async function theNavListsOneEntryPerSegment(): Promise<void> {
  stubSegments(BODY);
  renderAt("");
  const nav = await sectionNav();
  await waitFor(() => expect(within(nav).getAllByRole("link")).toHaveLength(3));
  expect(within(nav).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
    ["Energy", PATH],
    ["Chillers", `${PATH}?view=chillers`],
    ["Pumps", `${PATH}?view=pumps`],
  ]);
}

/** A segment sub-tab asks for its segment and point, and draws the segment view. */
export async function aSegmentSubTabAsksItsSegmentAndPoint(): Promise<void> {
  const spy = stubSegments(BODY);
  renderAt("?view=chillers&point=kw");
  expect(await screen.findByRole("combobox", { name: "Trend point" })).toBeInTheDocument();
  expect(spy).toHaveBeenCalledWith(SITE, { range: "24h", segment: "chillers", point: "kw" });
  expect(screen.queryByTestId("site-energy-view")).toBeNull();
  expect(within(await sectionNav()).getByRole("link", { name: "Chillers" })).toHaveAttribute("aria-current", "page");
}

/** Choosing a point writes it to the search, beside the segment. */
export async function choosingAPointWritesTheSearch(): Promise<void> {
  stubSegments(BODY);
  renderAt("?view=chillers");
  fireEvent.change(await screen.findByRole("combobox", { name: "Trend point" }), { target: { value: "pf" } });
  expect(screen.getByTestId("location").textContent).toBe(`${PATH}?view=chillers&point=pf`);
}

/** The range control reaches the Energy sub-tab. */
export async function theRangeControlReachesTheEnergySubTab(): Promise<void> {
  stubSegments(BODY);
  renderAt("");
  await screen.findByTestId("site-energy-view");
  fireEvent.change(screen.getByRole("combobox", { name: "Range" }), { target: { value: "7d" } });
  expect(screen.getByTestId("site-energy-view")).toHaveAttribute("data-range", "7d");
}

/** A failed segment read is a fixed sentence, never the error's message (`F4.204`). */
export async function aFailedSegmentReadIsAFixedSentence(): Promise<void> {
  stubSegments(new Error("control-room/sites/:id/segment-views 503 secret"));
  renderAt("?view=chillers");
  expect(await screen.findByText("Could not load this segment's trends.")).toBeInTheDocument();
  expect(screen.queryByText(/secret/)).toBeNull();
}

const OTHER_SITE = "00000000-0000-4000-8000-0000000000b2";

/** The site page's shape: the route param feeds the view, so a site switch keeps it mounted. */
function ViewFromParams() {
  const { locationId } = useParams();
  const navigate = useNavigate();
  return (
    <>
      <SiteTrendsView locationId={locationId ?? ""} />
      <button type="button" onClick={() => navigate(`/control-room/site/${OTHER_SITE}/trends`)}>
        other site
      </button>
      <button type="button" onClick={() => navigate(`${PATH}?view=chillers&point=pf`)}>
        other point
      </button>
    </>
  );
}

/** Site A answers at once; every later read (site B, or another point of A) stays pending. */
function renderSwitchable(search: string): void {
  vi.spyOn(segmentApi, "fetchSiteSegmentViews").mockImplementation((locationId, query) =>
    locationId === SITE && query.point !== "pf" ? Promise.resolve(BODY) : new Promise<SiteSegmentViewsDto>(() => {}),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`${PATH}${search}`]}>
        <Routes>
          <Route path="/control-room/site/:locationId/:tab" element={<ViewFromParams />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Moving to another site while its read is pending lists none of the previous site's segments. */
export async function anotherSitesSegmentsDoNotShowWhileItLoads(): Promise<void> {
  renderSwitchable("");
  const nav = await sectionNav();
  await waitFor(() => expect(within(nav).getAllByRole("link")).toHaveLength(3));
  fireEvent.click(screen.getByRole("button", { name: "other site" }));
  await waitFor(() =>
    expect(within(screen.getByRole("navigation", { name: "Trends sections" })).getAllByRole("link")).toHaveLength(1),
  );
  expect(screen.queryByRole("link", { name: "Chillers" })).toBeNull();
}

/** Another point of the same site keeps the segment nav while its read is pending. */
export async function anotherPointKeepsTheSegmentNavWhileItLoads(): Promise<void> {
  renderSwitchable("?view=chillers&point=kw");
  await screen.findByRole("combobox", { name: "Trend point" });
  fireEvent.click(screen.getByRole("button", { name: "other point" }));
  expect(await screen.findByText("Loading the segment trends…")).toBeInTheDocument();
  expect(within(await sectionNav()).getAllByRole("link")).toHaveLength(3);
}

/** A 404 (a segment or point not at the site) has its own sentence. */
export async function aMissingSegmentHasItsOwnSentence(): Promise<void> {
  stubSegments(new ApiError("control-room/sites/:id/segment-views 404", 404));
  renderAt("?view=nope");
  expect(await screen.findByText("This segment or point is not at this site.")).toBeInTheDocument();
}

const FROM = "2026-11-01T00:00:00.000Z";
const TO = "2026-11-02T00:00:00.000Z";

/** `F4.303` T1: the range, the custom instants, compare and `rankBy` are read from the URL. */
export async function theSectionStateIsReadFromTheUrl(): Promise<void> {
  const spy = stubSegments(BODY);
  renderAt(`?from=${FROM}&to=${TO}&compare=1&rankBy=peakKw`);
  const energy = await screen.findByTestId("site-energy-view");
  expect([energy.dataset.range, energy.dataset.from, energy.dataset.to, energy.dataset.compare, energy.dataset.rankBy]).toEqual([
    "custom",
    FROM,
    TO,
    "previous",
    "peakKw",
  ]);
  expect(spy).toHaveBeenCalledWith(SITE, { range: "custom", from: FROM, to: TO, compare: "previous" });
}

/** `F4.303` T1: a range change is written to the URL, keeping the compare and the sort. */
export async function aRangeChangeIsWrittenToTheUrl(): Promise<void> {
  stubSegments(BODY);
  renderAt("?compare=1&rankBy=peakKw");
  await screen.findByTestId("site-energy-view");
  fireEvent.change(screen.getByRole("combobox", { name: "Range" }), { target: { value: "7d" } });
  expect(screen.getByTestId("location").textContent).toBe(`${PATH}?range=7d&compare=1&rankBy=peakKw`);
}

/** `F4.303` T1: the site ranking's sort is written to the URL as `rankBy`. */
export async function aSortChangeIsWrittenToTheUrl(): Promise<void> {
  stubSegments(BODY);
  renderAt("?range=7d");
  fireEvent.click(await screen.findByRole("button", { name: "rank by intensity" }));
  expect(screen.getByTestId("location").textContent).toBe(`${PATH}?range=7d&rankBy=kwhPerM2`);
}

/** `F4.303` T2: every nav entry keeps the range, and a segment entry drops the point. */
export async function theNavKeepsTheRange(): Promise<void> {
  stubSegments(BODY);
  renderAt("?view=chillers&point=pf&range=7d");
  const nav = await sectionNav();
  await waitFor(() => expect(within(nav).getAllByRole("link")).toHaveLength(3));
  expect(within(nav).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
    `${PATH}?range=7d`,
    `${PATH}?view=chillers&range=7d`,
    `${PATH}?view=pumps&range=7d`,
  ]);
}

/** `F4.303` T3: "Copy link" sits in the control row, after the range controls. */
export async function copyLinkSitsBesideTheRangeControls(): Promise<void> {
  stubSegments(BODY);
  renderAt("");
  const copy = await screen.findByRole("button", { name: "Copy link" });
  const row = screen.getByRole("combobox", { name: "Range" }).closest("[data-testid=site-trends-controls]");
  expect(row).not.toBeNull();
  expect(row?.contains(copy)).toBe(true);
  expect(row?.lastElementChild?.contains(copy)).toBe(true);
}
