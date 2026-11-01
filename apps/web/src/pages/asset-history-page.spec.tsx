import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, vi, type MockInstance } from "vitest";

import { assetListRowSchema, pointAggregateResponseSchema } from "@bms/shared/contracts";
import { encodePointRef } from "@bms/shared";
import type { AssetListRow, AssetPointPickerRow, PointAggregateResponse, PointRawRecordsResponse } from "@bms/shared";

import * as assetsApi from "../api/assets";
import * as copilotApi from "../api/copilot";
import * as systemStatusApi from "../api/system-status";
import * as telemetryApi from "../api/telemetry";
import { OPERATIONAL } from "../components/system-status-indicator.spec";
import { formatBucketWidth } from "../lib/widget-value";
import type { AuthUser } from "../stores/auth-store";
import { AssetHistoryPage } from "./asset-history-page";

/**
 * `F4.297` U5 (ADR 0108 decision 1) — the asset history page.
 *
 * Assertions live here; `asset-history-page.test.tsx` is the Vitest entry point, carries the
 * jsdom docblock and pins `TZ=America/St_Johns` — a zone no fixture uses — so a time formatted
 * in the browser's zone instead of the site's fails.
 *
 * Every api read is stubbed: an unstubbed one reaches a local API on :4000. `echarts-for-react`
 * renders nothing (jsdom has no canvas); the facts under the chart are ordinary DOM.
 */

export const ASSET_ID = "11111111-1111-4111-8111-111111111111";
export const SITE_ZONE = "Asia/Kolkata";

const ASSET: AssetListRow = assetListRowSchema.parse({
  id: ASSET_ID,
  code: "CHL-01",
  name: "Chiller 1",
  siteName: "Site A",
  domain: "hvac",
  locationId: "22222222-2222-4222-8222-222222222222",
  locationName: "Site A",
  rtuId: null,
  rtuDisplayName: null,
  telemetrySource: null,
  active: true,
  templateId: null,
});

export function point(pointKey: string, unit: string | null = "kW"): AssetPointPickerRow {
  return { id: `p-${pointKey}`, assetId: ASSET_ID, assetName: "Chiller 1", pointKey, unit };
}

const POINTS = [point("kw"), point("kwh", "kWh")];

function aggregate(overrides: Partial<PointAggregateResponse> = {}): PointAggregateResponse {
  return pointAggregateResponseSchema.parse({
    pointRef: encodePointRef(ASSET_ID, "kw"),
    from: "2026-10-30T06:00:00.000Z",
    to: "2026-10-31T06:00:00.000Z",
    bucketSeconds: 3600,
    timeZone: SITE_ZONE,
    stats: { sum: 10, average: 5, min: 1, max: 9, peakAt: "2026-10-30T07:00:00.000Z", sampleCount: 2 },
    compare: null,
    buckets: [{ t: "2026-10-30T06:00:00.000Z", v: 5, min: 1, average: 5, max: 9, sampleCount: 2 }],
    ...overrides,
  });
}

const RAW_PAGE_1: PointRawRecordsResponse = {
  pointRef: encodePointRef(ASSET_ID, "kw"),
  items: [{ time: "2026-10-31T06:00:00.000Z", deviceTime: null, value: 12.5, unit: "kW" }],
  nextBefore: "2026-10-31T06:00:00.000Z",
};
const RAW_PAGE_2: PointRawRecordsResponse = {
  pointRef: encodePointRef(ASSET_ID, "kw"),
  items: [{ time: "2026-10-31T05:59:00.000Z", deviceTime: "2026-10-31T05:58:59.000Z", value: 12.1, unit: "kW" }],
  nextBefore: null,
};

function asUser(): AuthUser {
  return { id: "u1", email: "admin@bms.local", displayName: "admin", role: "admin" } as unknown as AuthUser;
}

interface Stubs {
  readonly aggregateSpy: MockInstance<typeof telemetryApi.fetchPointAggregate>;
  readonly rawSpy: MockInstance<typeof telemetryApi.fetchPointRawRecords>;
}

/** Every read the page and the shell make. */
export function stubApis(
  options: {
    points?: AssetPointPickerRow[];
    served?: PointAggregateResponse;
    pointsError?: Error;
  } = {},
): Stubs {
  vi.spyOn(systemStatusApi, "fetchSystemStatus").mockResolvedValue(OPERATIONAL);
  vi.spyOn(copilotApi, "fetchCopilotStatus").mockResolvedValue({ available: false, configured: false });
  vi.spyOn(assetsApi, "fetchAssets").mockResolvedValue([ASSET]);
  if (options.pointsError) {
    vi.spyOn(assetsApi, "fetchAssetPoints").mockRejectedValue(options.pointsError);
  } else {
    vi.spyOn(assetsApi, "fetchAssetPoints").mockResolvedValue({ items: options.points ?? POINTS });
  }
  vi.spyOn(telemetryApi, "fetchPointValuesAt").mockImplementation(async (refs) => ({
    at: "2026-10-31T06:20:00.000Z",
    items: refs.map((pointRef) => ({ pointRef, time: "2026-10-31T06:15:00.000Z", value: 42, unit: "kW" })),
  }));
  const aggregateSpy = vi.spyOn(telemetryApi, "fetchPointAggregate").mockResolvedValue(options.served ?? aggregate());
  const rawSpy = vi
    .spyOn(telemetryApi, "fetchPointRawRecords")
    .mockImplementation(async (_ref, opts) => (opts?.before ? RAW_PAGE_2 : RAW_PAGE_1));
  return { aggregateSpy, rawSpy };
}

export function renderHistoryPage(search = ""): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/asset-history/${ASSET_ID}${search}`]}>
        <Routes>
          <Route path="/asset-history/:assetId" element={<AssetHistoryPage user={asUser()} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The header names the asset by code and name. */
export async function theHeaderShowsCodeAndName(): Promise<void> {
  stubApis();
  renderHistoryPage();
  expect(await screen.findByRole("heading", { name: "CHL-01 · Chiller 1" })).toBeInTheDocument();
}

/** Each point row carries its latest value and its poll time. */
export async function eachPointShowsItsLatestValueAndPollTime(): Promise<void> {
  stubApis();
  renderHistoryPage();
  const row = await waitFor(() => {
    const found = document.querySelector('[data-point-key="kwh"]');
    expect(found).not.toBeNull();
    return found as HTMLElement;
  });
  await waitFor(() => expect(within(row).getByTestId("latest-value").textContent).toBe("42 kW"));
  expect(within(row).getByTestId("poll-time").textContent).toContain("ago");
}

/** No `points` in the URL: the first point is charted, with one aggregate read asking for bucket stats. */
export async function theFirstPointIsChartedByDefault(): Promise<void> {
  const { aggregateSpy } = stubApis();
  renderHistoryPage();
  await waitFor(() => expect(aggregateSpy).toHaveBeenCalled());
  expect(aggregateSpy).toHaveBeenCalledTimes(1);
  expect(aggregateSpy.mock.calls[0][0]).toBe(encodePointRef(ASSET_ID, "kw"));
  expect(aggregateSpy.mock.calls[0][1]).toMatchObject({ windowMinutes: 1440, bucketStats: true, bucketFunction: "avg" });
}

/** With 8 charted, a 9th checkbox is refused with the sentence and no 9th read. */
export async function aNinthPointIsRefused(): Promise<void> {
  const nine = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((key) => point(key));
  const { aggregateSpy } = stubApis({ points: nine });
  renderHistoryPage("?points=a,b,c,d,e,f,g,h");
  const ninth = await screen.findByRole("checkbox", { name: "Chart i" });
  await waitFor(() => expect(aggregateSpy).toHaveBeenCalledTimes(8));
  await userEvent.click(ninth);
  expect(await screen.findByText("At most 8 points can be charted at once.")).toBeInTheDocument();
  expect((ninth as HTMLInputElement).checked).toBe(false);
  expect(aggregateSpy).toHaveBeenCalledTimes(8);
}

/** `?range=7d&compare=1&points=kw` reads a trailing week with a compare. */
export async function aPresetAndCompareInTheUrlReachTheRead(): Promise<void> {
  const { aggregateSpy } = stubApis();
  renderHistoryPage("?range=7d&compare=1&points=kw");
  await waitFor(() => expect(aggregateSpy).toHaveBeenCalled());
  const options = aggregateSpy.mock.calls[0][1];
  expect(options).toMatchObject({ windowMinutes: 10080, compare: true });
  expect(options).not.toHaveProperty("from");
}

/** A custom `from`/`to` in the URL is sent as the pair, with no `windowMinutes`. */
export async function aCustomRangeInTheUrlIsSentAsThePair(): Promise<void> {
  const { aggregateSpy } = stubApis();
  renderHistoryPage("?from=2026-10-01T00:00:00.000Z&to=2026-10-02T00:00:00.000Z&points=kw");
  await waitFor(() => expect(aggregateSpy).toHaveBeenCalled());
  const options = aggregateSpy.mock.calls[0][1];
  expect(options).toMatchObject({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z" });
  expect(options).not.toHaveProperty("windowMinutes");
}

/** A 403 on the asset's points renders the access sentence, and no chart is read or drawn. */
export async function aForbiddenAssetRendersTheAccessSentence(): Promise<void> {
  const { aggregateSpy } = stubApis({ pointsError: new Error("asset points 403") });
  renderHistoryPage();
  expect(await screen.findByText("Asset not found or outside your access.")).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Range" })).toBeNull();
  expect(screen.queryByText("Choose a point to chart.")).toBeNull();
  expect(aggregateSpy).not.toHaveBeenCalled();
}

/** The level under the chart is the response's `bucketSeconds`, not a constant. */
export async function theLevelIsTheResponsesBucketWidth(): Promise<void> {
  stubApis({ served: aggregate({ bucketSeconds: 3600 }) });
  renderHistoryPage();
  const level = await screen.findByTestId("history-level");
  expect(level.textContent).toBe(`${formatBucketWidth(3600)} buckets`);
  expect(level.textContent).toBe("1 hour buckets");
}

/** A compare whose previous period is all gaps says so. */
export async function anEmptyPreviousPeriodSaysSo(): Promise<void> {
  stubApis({
    served: aggregate({
      compare: {
        from: "2026-10-29T06:00:00.000Z",
        to: "2026-10-30T06:00:00.000Z",
        stats: { sum: null, average: null, min: null, max: null, peakAt: null, sampleCount: 0 },
        buckets: [{ t: "2026-10-29T06:00:00.000Z", v: null }],
      },
    }),
  });
  renderHistoryPage("?compare=1");
  expect(await screen.findByText("no data for the previous period")).toBeInTheDocument();
}

/** A previous period with a value draws no such sentence (the positive beside the absence). */
export async function aFilledPreviousPeriodDoesNotSaySo(): Promise<void> {
  stubApis({
    served: aggregate({
      compare: {
        from: "2026-10-29T06:00:00.000Z",
        to: "2026-10-30T06:00:00.000Z",
        stats: { sum: 4, average: 4, min: 4, max: 4, peakAt: "2026-10-29T06:00:00.000Z", sampleCount: 1 },
        buckets: [{ t: "2026-10-29T06:00:00.000Z", v: 4 }],
      },
    }),
  });
  renderHistoryPage("?compare=1");
  await screen.findByTestId("history-level");
  expect(screen.queryByText("no data for the previous period")).toBeNull();
}

/** "Load older" reads the next page with `before` = the previous page's `nextBefore`, and appends it. */
export async function loadOlderPagesWithTheCursor(): Promise<void> {
  const { rawSpy } = stubApis();
  renderHistoryPage();
  const button = await screen.findByRole("button", { name: "Load older" });
  await userEvent.click(button);
  await waitFor(() => expect(screen.getAllByTestId("raw-record")).toHaveLength(2));
  expect(rawSpy).toHaveBeenLastCalledWith(encodePointRef(ASSET_ID, "kw"), { before: RAW_PAGE_1.nextBefore });
}

/** The raw time and the poll time are in the site zone, and the zone is named under the chart. */
export async function timesAreInTheSiteZone(): Promise<void> {
  stubApis();
  renderHistoryPage();
  expect((await screen.findByTestId("history-zone")).textContent).toBe(SITE_ZONE);
  // 06:00Z is 11:30 in Kolkata (03:30 in the pinned browser zone).
  const raw = await screen.findAllByTestId("raw-record");
  expect(raw[0].textContent).toContain("31 Oct 2026, 11:30:00");
  // 06:15Z polled → 11:45 in Kolkata.
  const row = document.querySelector('[data-point-key="kw"]') as HTMLElement;
  await waitFor(() => expect(within(row).getByTestId("poll-time").textContent).toContain("31 Oct 2026, 11:45:00"));
}

/**
 * `F4.297` review — a custom range of 84 h 30 min is not a whole number of `1h` buckets, so each
 * compare bucket shifted by the span lands on `hh:30`. The "Previous period" cell still shows the
 * value of the compare bucket the current one overlays.
 */
export async function anUnalignedCustomCompareFillsThePreviousColumn(): Promise<void> {
  stubApis({
    served: aggregate({
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-04T12:30:00.000Z",
      buckets: [{ t: "2026-10-01T00:00:00.000Z", v: 5, min: 1, average: 5, max: 9, sampleCount: 2 }],
      compare: {
        from: "2026-09-27T11:30:00.000Z",
        to: "2026-10-01T00:00:00.000Z",
        stats: { sum: 7, average: 7, min: 7, max: 7, peakAt: "2026-09-27T12:00:00.000Z", sampleCount: 1 },
        buckets: [{ t: "2026-09-27T12:00:00.000Z", v: 7 }],
      },
    }),
  });
  renderHistoryPage("?from=2026-10-01T00:00:00.000Z&to=2026-10-04T12:30:00.000Z&compare=1&points=kw");
  const header = await screen.findByRole("columnheader", { name: "Previous period" });
  const table = header.closest("table") as HTMLTableElement;
  const cells = within(within(table).getAllByRole("row")[1]).getAllByRole("cell");
  expect(cells[5].textContent).toBe("7");
}

/**
 * `F4.297` review — a charted point whose every read failed is not "Choose a point to chart.":
 * the error sentence shows (the positive), and the empty-selection text does not.
 */
export async function aFailedReadIsNotAnEmptySelection(): Promise<void> {
  const { aggregateSpy } = stubApis();
  aggregateSpy.mockRejectedValue(new Error("telemetry aggregate 400"));
  renderHistoryPage("?points=kw");
  expect(await screen.findByText("telemetry aggregate 400")).toBeInTheDocument();
  expect(screen.queryByText("Choose a point to chart.")).toBeNull();
}

/**
 * `F4.297` review — a `points` list from the URL with a third distinct unit does not chart the
 * third: its checkbox is unchecked and it is never read, while the first two are.
 */
export async function aThirdUnitFromTheUrlIsNotCharted(): Promise<void> {
  const { aggregateSpy } = stubApis({ points: [point("kw"), point("pf", null), point("temp", "°C")] });
  renderHistoryPage("?points=kw,pf,temp");
  await waitFor(() => expect(aggregateSpy).toHaveBeenCalledTimes(2));
  expect(((await screen.findByRole("checkbox", { name: "Chart pf" })) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("checkbox", { name: "Chart temp" }) as HTMLInputElement).checked).toBe(false);
  expect(aggregateSpy.mock.calls.map((call) => call[0])).not.toContain(encodePointRef(ASSET_ID, "temp"));
}
