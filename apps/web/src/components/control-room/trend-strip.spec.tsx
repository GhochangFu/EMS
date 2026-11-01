import type { SiteTrendStripDto, TrendStripAssetSeriesDto } from "@bms/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import { fetchSiteTrendStrip } from "../../api/trend-strip";
import { siteAssetsPath } from "../../lib/smoc-pages";
import { historyHref, stripWindowLabel } from "../../lib/trend-strip";
import { TrendStrip } from "./trend-strip";

/**
 * `F4.301` U4 (ADR 0108 Amendment 2, items 5–9) — `TrendStrip`, the Control Room site page's
 * trend strip. The api module is mocked; `fetch` is a rejecting spy, and {@link cleanupStrip}
 * fails the case if anything reached it (an unmocked read would hit the real `:4000`).
 *
 * Every segment label is read from the response, never a literal: the fixture labels are
 * deliberately not the catalog's own labels, so a hard-coded fallback cannot pass.
 *
 * Assertions live here; `trend-strip.test.tsx` is the Vitest entry point and carries the
 * `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042 decision 2).
 */

vi.mock("../../api/trend-strip", () => ({ fetchSiteTrendStrip: vi.fn() }));

const fetchStrip = vi.mocked(fetchSiteTrendStrip);
let fetchSpy: ReturnType<typeof vi.fn> = vi.fn();

const LOCATION_ID = "0b7e2f4a-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
const GROUP_ID = "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d";
const FROM = "2026-10-31T06:30:00.000Z";
const TO = "2026-11-01T06:30:00.000Z";

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function series(n: number, unit: string | null = "kW"): TrendStripAssetSeriesDto {
  return {
    assetId: uuid(n),
    assetCode: `A-${String(n).padStart(2, "0")}`,
    assetName: `Asset ${n}`,
    unit,
    buckets: [
      { t: FROM, v: 1 },
      { t: "2026-10-31T07:00:00.000Z", v: n + 0.5 },
    ],
  };
}

function strip(overrides: Partial<SiteTrendStripDto> = {}): SiteTrendStripDto {
  return {
    locationId: LOCATION_ID,
    assetGroupId: null,
    range: "24h",
    from: FROM,
    to: TO,
    level: "5m",
    bucketSeconds: 1800,
    timeZone: "Asia/Kolkata",
    assetsPerPoint: 6,
    pointsPerSegment: 3,
    trimmed: false,
    segments: [
      {
        domain: "seg-one",
        label: "Segment One Label",
        source: "catalog",
        points: [
          {
            code: "kw",
            name: "Active power",
            unit: "kW",
            assets: [1, 2, 3, 4, 5, 6].map((n) => series(n)),
            moreAssets: 2,
          },
        ],
      },
      {
        domain: "seg-two",
        label: "Segment Two Label",
        source: "organization",
        points: [
          {
            code: "temp_c",
            name: "Temperature",
            unit: "°C",
            assets: [series(7, "degC")],
            moreAssets: 0,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function renderStrip(assetGroupId: string | null = null): QueryClient {
  fetchSpy = vi.fn(() => Promise.reject(new Error("trend-strip spec: an unmocked read reached fetch")));
  vi.stubGlobal("fetch", fetchSpy);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TrendStrip locationId={LOCATION_ID} assetGroupId={assetGroupId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

/** One `<section>` per segment, each titled by the response's label. */
export async function oneSectionPerSegmentWithItsLabel(): Promise<void> {
  fetchStrip.mockResolvedValue(strip());
  renderStrip();

  expect(await screen.findByRole("heading", { name: "Segment One Label" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Segment Two Label" })).toBeInTheDocument();
  expect(document.body.querySelectorAll("section")).toHaveLength(2);
}

/** The subtitle names where the segment's list comes from. */
export async function theSubtitleNamesTheListSource(): Promise<void> {
  fetchStrip.mockResolvedValue(strip());
  renderStrip();

  const one = (await screen.findByRole("heading", { name: "Segment One Label" })).closest("section");
  const two = screen.getByRole("heading", { name: "Segment Two Label" }).closest("section");
  expect(within(one as HTMLElement).getByText("Catalog default")).toBeInTheDocument();
  expect(within(two as HTMLElement).getByText("Organization list")).toBeInTheDocument();
}

/** One row per point, with the point's name and its catalog unit. */
export async function oneRowPerPointWithNameAndUnit(): Promise<void> {
  fetchStrip.mockResolvedValue(strip());
  renderStrip();

  const row = await screen.findByRole("listitem", { name: "Active power" });
  expect(within(row).getByText("kW", { selector: "[data-role='point-unit']" })).toBeInTheDocument();
  const other = screen.getByRole("listitem", { name: "Temperature" });
  expect(within(other).getByText("°C", { selector: "[data-role='point-unit']" })).toBeInTheDocument();
}

/** Six sparkline links on the six-asset point, each to that asset's history at the strip's range. */
export async function sixSparklineLinksToTheHistoryPage(): Promise<void> {
  fetchStrip.mockResolvedValue(strip());
  renderStrip();

  const row = await screen.findByRole("listitem", { name: "Active power" });
  const links = within(row).getAllByRole("link", { name: /: open history$/ });
  expect(links).toHaveLength(6);
  expect(links.map((l) => l.getAttribute("href"))).toEqual(
    [1, 2, 3, 4, 5, 6].map((n) => historyHref(uuid(n), "24h", "kw")),
  );
}

/** A link's accessible name is `<assetCode> <point name>: open history`. */
export async function aLinkNamesTheAssetAndThePoint(): Promise<void> {
  fetchStrip.mockResolvedValue(strip());
  renderStrip();

  expect(await screen.findByRole("link", { name: "A-07 Temperature: open history" })).toHaveAttribute(
    "href",
    historyHref(uuid(7), "24h", "temp_c"),
  );
}

/** Each asset prints its last value with its own unit, not the catalog unit. */
export async function eachAssetPrintsItsLastValueWithItsUnit(): Promise<void> {
  fetchStrip.mockResolvedValue(strip());
  renderStrip();

  const row = await screen.findByRole("listitem", { name: "Temperature" });
  expect(within(row).getByText("7.5 degC")).toBeInTheDocument();
}

/** `moreAssets: 2` renders `+2 more`, linking to the site's Assets & RTUs tab. */
export async function moreAssetsLinksToTheAssetsTab(): Promise<void> {
  fetchStrip.mockResolvedValue(strip());
  renderStrip();

  const more = await screen.findByRole("link", { name: "+2 more" });
  expect(more).toHaveAttribute("href", siteAssetsPath(LOCATION_ID));
}

/** A point with no assets beyond the cap prints no `+N more`. */
export async function noMoreLinkWhenNoneBeyondTheCap(): Promise<void> {
  fetchStrip.mockResolvedValue(strip());
  renderStrip();

  const row = await screen.findByRole("listitem", { name: "Temperature" });
  expect(within(row).queryByRole("link", { name: /more$/ })).toBeNull();
  expect(screen.getByRole("link", { name: "+2 more" })).toBeInTheDocument();
}

/** Pressing `7 d` reads again with `range: "7d"` and marks that button pressed. */
export async function pressing7dRefetchesAndMarksIt(): Promise<void> {
  fetchStrip.mockImplementation((_id, { range }) => Promise.resolve(strip({ range })));
  renderStrip();
  await screen.findByRole("heading", { name: "Segment One Label" });

  const week = screen.getByRole("button", { name: "7 d" });
  expect(week).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "24 h" })).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(week);

  await waitFor(() => expect(fetchStrip).toHaveBeenLastCalledWith(LOCATION_ID, { range: "7d", assetGroupId: null }));
  expect(week).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "24 h" })).toHaveAttribute("aria-pressed", "false");
}

/** After a switch to `7 d`, the links carry `range=7d`. */
export async function theLinksFollowTheSelectedRange(): Promise<void> {
  fetchStrip.mockImplementation((_id, { range }) => Promise.resolve(strip({ range })));
  renderStrip();
  await screen.findByRole("heading", { name: "Segment One Label" });
  await userEvent.click(screen.getByRole("button", { name: "7 d" }));

  await waitFor(() =>
    expect(screen.getByRole("link", { name: "A-07 Temperature: open history" })).toHaveAttribute(
      "href",
      historyHref(uuid(7), "7d", "temp_c"),
    ),
  );
}

/** `segments: []` renders the empty sentence and no section. */
export async function noSegmentsRendersTheEmptySentence(): Promise<void> {
  fetchStrip.mockResolvedValue(strip({ segments: [] }));
  renderStrip();

  expect(await screen.findByText("No trend points for the assets on this tab.")).toBeInTheDocument();
  expect(document.body.querySelectorAll("section")).toHaveLength(0);
}

/** `trimmed: true` with `assetsPerPoint: 5` prints the trim line. */
export async function aTrimmedStripSaysSo(): Promise<void> {
  fetchStrip.mockResolvedValue(strip({ trimmed: true, assetsPerPoint: 5 }));
  renderStrip();

  expect(await screen.findByText("Trimmed to 5 assets per point")).toBeInTheDocument();
}

/**
 * The points cap moves only once the assets cap is at 1 (`fitSeries` phase 2), so a strip
 * trimmed to 1 asset per point names the points per segment too, in the singular for one asset.
 */
export async function aStripTrimmedToOneAssetNamesThePointsCap(): Promise<void> {
  fetchStrip.mockResolvedValue(strip({ trimmed: true, assetsPerPoint: 1, pointsPerSegment: 2 }));
  renderStrip();

  expect(
    await screen.findByText("Trimmed to 1 asset per point and 2 points per segment"),
  ).toBeInTheDocument();
}

/**
 * The last trim phase drops trailing points, leaving a segment with `points: []` (the server
 * never sends an empty segment otherwise), so the trim line says some points are not shown.
 */
export async function aStripWithADroppedSegmentSaysPointsAreHidden(): Promise<void> {
  const base = strip();
  const [first, second] = base.segments;
  if (first === undefined || second === undefined) throw new Error("fixture: two segments");
  fetchStrip.mockResolvedValue(
    strip({
      trimmed: true,
      assetsPerPoint: 1,
      pointsPerSegment: 1,
      segments: [first, { ...second, points: [] }],
    }),
  );
  renderStrip();

  expect(
    await screen.findByText(
      "Trimmed to 1 asset per point and 1 point per segment; some points are not shown",
    ),
  ).toBeInTheDocument();
}

/** An untrimmed strip prints no trim line. */
export async function anUntrimmedStripPrintsNoTrimLine(): Promise<void> {
  fetchStrip.mockResolvedValue(strip());
  renderStrip();

  await screen.findByRole("heading", { name: "Segment One Label" });
  expect(screen.queryByText(/^Trimmed to/)).toBeNull();
}

/** A failed read renders the fixed sentence and never the rejection's message (F4.204). */
export async function aFailedReadRendersAFixedSentence(): Promise<void> {
  fetchStrip.mockRejectedValue(new Error("control-room/sites/:id/trend-strip 500 SECRET-BODY"));
  renderStrip();

  expect(await screen.findByText("Could not load the trend strip.")).toBeInTheDocument();
  expect(screen.queryByText(/SECRET-BODY/)).toBeNull();
}

/**
 * A failed background refetch keeps the last read on screen: TanStack Query v5 keeps `data`
 * beside `isError`, so the sparklines stay and a fixed note says the refresh failed (F4.204:
 * never the rejection's message).
 */
export async function aFailedRefetchKeepsTheSparklines(): Promise<void> {
  fetchStrip.mockResolvedValueOnce(strip());
  const queryClient = renderStrip();
  await screen.findByRole("heading", { name: "Segment One Label" });

  fetchStrip.mockRejectedValue(new Error("control-room/sites/:id/trend-strip 500 SECRET-BODY"));
  await queryClient.refetchQueries();

  expect(await screen.findByText("Could not refresh the trend strip; showing the last read.")).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: /: open history$/ })).toHaveLength(7);
  expect(screen.queryByText("Could not load the trend strip.")).toBeNull();
  expect(screen.queryByText(/SECRET-BODY/)).toBeNull();
}

/** The window line prints the zone from the response. */
export async function theWindowLinePrintsTheResponseZone(): Promise<void> {
  fetchStrip.mockResolvedValue(strip({ timeZone: "America/New_York" }));
  renderStrip();

  expect(
    await screen.findByText(`Window: ${stripWindowLabel(FROM, TO, 1800, "America/New_York")}`),
  ).toBeInTheDocument();
}

/** A whole-site strip reads with `assetGroupId: null`. */
export async function aWholeSiteStripSendsANullGroup(): Promise<void> {
  fetchStrip.mockResolvedValue(strip());
  renderStrip(null);

  await screen.findByRole("heading", { name: "Segment One Label" });
  expect(fetchStrip.mock.calls[0]).toEqual([LOCATION_ID, { range: "24h", assetGroupId: null }]);
}

/** A group tab's strip reads with its `assetGroupId` unchanged. */
export async function aGroupStripSendsItsGroupId(): Promise<void> {
  fetchStrip.mockResolvedValue(strip({ assetGroupId: GROUP_ID }));
  renderStrip(GROUP_ID);

  await screen.findByRole("heading", { name: "Segment One Label" });
  expect(fetchStrip.mock.calls[0]).toEqual([LOCATION_ID, { range: "24h", assetGroupId: GROUP_ID }]);
}

/** While the read is pending, a status line says so. */
export async function aPendingReadShowsTheLoadingStatus(): Promise<void> {
  fetchStrip.mockImplementation(() => new Promise(() => undefined));
  renderStrip();

  expect(await screen.findByRole("status")).toHaveTextContent("Loading trends…");
}

export function cleanupStrip(): void {
  const reached = fetchSpy.mock.calls.length;
  cleanup();
  fetchStrip.mockReset();
  vi.unstubAllGlobals();
  expect(reached, "a read reached the real fetch").toBe(0);
}
