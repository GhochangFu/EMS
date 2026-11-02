import type { SiteTrendStripDto } from "@bms/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, vi } from "vitest";

import { fetchSiteTrendStrip } from "../../api/trend-strip";
import { TREND_STRIP_NO_SITE_SENTENCE, TrendStripWidget } from "./trend-strip-widget";
import { TREND_STRIP_STATIC_SENTENCE, TrendStripWidgetPreview } from "./trend-strip-widget-preview";

/**
 * `F4.305` U4 (ADR 0108 Amendment 3, items 1–3) — `TrendStripWidget`, the `trend_strip` dashboard
 * widget: the `F4.301` strip body inside a widget frame. The api module is mocked; `fetch` is a
 * rejecting spy, and {@link cleanupTrendStripWidget} fails the case if anything reached it.
 *
 * Assertions live here; `trend-strip-widget.test.tsx` is the Vitest entry point and carries the
 * `@vitest-environment jsdom` docblock (ADR 0014, ADR 0042 decision 2).
 */

vi.mock("../../api/trend-strip", () => ({ fetchSiteTrendStrip: vi.fn() }));

const fetchStrip = vi.mocked(fetchSiteTrendStrip);
let fetchSpy: ReturnType<typeof vi.fn> = vi.fn();

const LOCATION_ID = "0b7e2f4a-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
const GROUP_ID = "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d";
const ASSET_ID = "00000000-0000-4000-8000-000000000001";
const FROM = "2026-10-31T06:30:00.000Z";
const TO = "2026-11-01T06:30:00.000Z";

function strip(range: SiteTrendStripDto["range"]): SiteTrendStripDto {
  return {
    locationId: LOCATION_ID,
    assetGroupId: null,
    range,
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
            assets: [
              {
                assetId: ASSET_ID,
                assetCode: "A-01",
                assetName: "Asset 1",
                unit: "kW",
                buckets: [
                  { t: FROM, v: 1 },
                  { t: "2026-10-31T07:00:00.000Z", v: 2.5 },
                ],
              },
            ],
            moreAssets: 0,
          },
        ],
      },
    ],
  };
}

type WidgetProps = Parameters<typeof TrendStripWidget>[0];

function renderWidget(overrides: Partial<WidgetProps> = {}): void {
  fetchSpy = vi.fn(() => Promise.reject(new Error("trend-strip-widget spec: an unmocked read reached fetch")));
  vi.stubGlobal("fetch", fetchSpy);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TrendStripWidget
          title="Site trends"
          locationId={LOCATION_ID}
          assetGroupId={null}
          defaultRange="24h"
          {...overrides}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Unmounts, restores the stubbed `fetch`, clears the mock, and fails the case on a raw read. */
export function cleanupTrendStripWidget(): void {
  cleanup();
  const calls = fetchSpy.mock.calls.length;
  vi.unstubAllGlobals();
  fetchStrip.mockReset();
  expect(calls, "an unmocked read reached fetch").toBe(0);
}

/** The frame carries the widget's title as its heading, and the strip draws inside it. */
export async function theFrameCarriesTheWidgetTitle(): Promise<void> {
  fetchStrip.mockResolvedValue(strip("24h"));
  renderWidget();
  expect(screen.getByRole("heading", { name: "Site trends" })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "Segment One Label" })).toBeInTheDocument();
}

/** The range buttons start on the config's `defaultRange`, and the first read asks for it. */
export async function theRangeStartsOnTheDefaultRange(): Promise<void> {
  fetchStrip.mockImplementation((_id, { range }) => Promise.resolve(strip(range)));
  renderWidget({ defaultRange: "7d" });
  const nav = screen.getByRole("navigation", { name: "Trend range" });
  expect(within(nav).getByRole("button", { name: "7 d" })).toHaveAttribute("aria-pressed", "true");
  expect(within(nav).getByRole("button", { name: "24 h" })).toHaveAttribute("aria-pressed", "false");
  await waitFor(() => expect(fetchStrip).toHaveBeenCalled());
  expect(fetchStrip.mock.calls[0]).toEqual([LOCATION_ID, { range: "7d", assetGroupId: null }]);
}

/** The widget's group goes to the read as `assetGroupId`. */
export async function theGroupGoesToTheRead(): Promise<void> {
  fetchStrip.mockResolvedValue(strip("24h"));
  renderWidget({ assetGroupId: GROUP_ID });
  await waitFor(() => expect(fetchStrip).toHaveBeenCalled());
  expect(fetchStrip.mock.calls[0]).toEqual([LOCATION_ID, { range: "24h", assetGroupId: GROUP_ID }]);
}

/** A sparkline opens the asset history page at the strip's range and point — the `F4.301` click. */
export async function aSparklineLinksToTheHistoryPage(): Promise<void> {
  fetchStrip.mockImplementation((_id, { range }) => Promise.resolve(strip(range)));
  renderWidget({ defaultRange: "7d" });
  const link = await screen.findByRole("link", { name: "A-01 Active power: open history" });
  expect(link).toHaveAttribute("href", `/asset-history/${ASSET_ID}?range=7d&points=kw`);
}

/** A dashboard with no location draws the fixed sentence and reads nothing — beside a positive. */
export async function noLocationDrawsTheSentenceAndReadsNothing(): Promise<void> {
  renderWidget({ locationId: null });
  expect(screen.getByText(TREND_STRIP_NO_SITE_SENTENCE)).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Trend range" })).toBeNull();
  // Give a stray query a turn to start before the absence is read.
  await Promise.resolve();
  expect(fetchStrip).not.toHaveBeenCalled();
}

/** A failed read (a 404 for a group at another site) draws the fixed sentence, never the message. */
export async function aFailedReadNeverRendersTheErrorMessage(): Promise<void> {
  const message = "control-room/sites/:id/trend-strip 404";
  fetchStrip.mockRejectedValue(new Error(message));
  renderWidget({ assetGroupId: GROUP_ID });
  expect(await screen.findByText("Could not load the trend strip.")).toBeInTheDocument();
  expect(screen.queryByText(message, { exact: false })).toBeNull();
  expect(document.body.textContent ?? "").not.toContain("404");
}

/** The static draw (no live binding) says where the trends draw, inside the frame, and reads nothing. */
export function thePreviewDrawsItsSentenceAndReadsNothing(): void {
  fetchSpy = vi.fn(() => Promise.reject(new Error("trend-strip-widget spec: an unmocked read reached fetch")));
  vi.stubGlobal("fetch", fetchSpy);
  render(<TrendStripWidgetPreview title="Site trends" status="ready" />);
  expect(screen.getByRole("heading", { name: "Site trends" })).toBeInTheDocument();
  expect(screen.getByText(TREND_STRIP_STATIC_SENTENCE)).toBeInTheDocument();
  expect(fetchStrip).not.toHaveBeenCalled();
}

/** The two fixed sentences are not one sentence, so the no-site case cannot pass as the preview. */
export function theTwoSentencesDiffer(): void {
  expect(TREND_STRIP_NO_SITE_SENTENCE).not.toBe(TREND_STRIP_STATIC_SENTENCE);
}

/** A range click reads again with the new range. */
export async function aRangeClickReadsAgain(): Promise<void> {
  fetchStrip.mockImplementation((_id, { range }) => Promise.resolve(strip(range)));
  renderWidget();
  await screen.findByRole("heading", { name: "Segment One Label" });
  await userEvent.click(screen.getByRole("button", { name: "30 d" }));
  await waitFor(() => expect(fetchStrip).toHaveBeenCalledTimes(2));
  expect(fetchStrip.mock.calls[1]).toEqual([LOCATION_ID, { range: "30d", assetGroupId: null }]);
}
