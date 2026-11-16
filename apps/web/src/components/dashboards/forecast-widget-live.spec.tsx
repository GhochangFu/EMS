import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";

import { encodePointRef } from "@bms/shared";
import type { DashboardWidgetDto } from "@bms/shared";

import { ACCESS_SENTENCE } from "../asset-history/history-format";
import { FORECAST_WIDGET_WINDOW_MINUTES, ForecastWidgetLive } from "./forecast-widget-live";

/**
 * `E1.4c` (plan R10) — the live forecast widget reads its bound point twice: the 1,440-minute
 * hourly-mean aggregate and the forecast, both every 15 minutes. The two api clients are module
 * mocks and `echarts-for-react` records the option. Entry point: `forecast-widget-live.test.tsx`.
 */
const mocks = vi.hoisted(() => ({
  fetchPointAggregate: vi.fn(),
  fetchPointForecast: vi.fn(),
  recorded: [] as { option: { series: { name: string; data: [string, number | null][] }[] } }[],
}));

vi.mock("../../api/telemetry", () => ({ fetchPointAggregate: mocks.fetchPointAggregate }));
vi.mock("../../api/ml", () => ({ fetchPointForecast: mocks.fetchPointForecast }));
vi.mock("echarts-for-react", () => ({
  default: (props: (typeof mocks.recorded)[number]) => {
    mocks.recorded.push(props);
    return null;
  },
}));

/** Clears the mocks and the recorded props between cases. */
export function resetLiveMocks(): void {
  mocks.fetchPointAggregate.mockReset();
  mocks.fetchPointForecast.mockReset();
  mocks.recorded.length = 0;
}

const ASSET = "66666666-6666-4666-8666-666666666666";
const REF = encodePointRef(ASSET, "chw_kw");
const TO = "2026-11-16T10:20:00.000Z";
const FROM = "2026-11-15T10:20:00.000Z";

const WIDGET = {
  id: "w-1",
  dashboardId: "d-1",
  organizationId: "o-1",
  title: "Chiller load",
  gridX: 0,
  gridY: 0,
  gridW: 6,
  gridH: 4,
  points: [
    {
      id: "p-1",
      pointId: "pt-1",
      role: "primary",
      sortOrder: 0,
      assetId: ASSET,
      assetCode: "CH-01",
      assetRtuName: null,
      assetLocationName: null,
      pointKey: "chw_kw",
      unit: "kW",
    },
  ],
  sources: [],
  tabId: null,
  widgetType: "forecast",
  config: {},
} as Extract<DashboardWidgetDto, { widgetType: "forecast" }>;

const AGGREGATE = {
  pointRef: REF,
  from: FROM,
  to: TO,
  bucketSeconds: 60,
  stats: { min: null, max: null, avg: null, sum: null, count: 0 },
  timeZone: "Asia/Kolkata",
  compare: null,
  buckets: [
    { t: "2026-11-16T09:00:00.000Z", v: 10, average: 10, sampleCount: 1 },
    { t: "2026-11-16T09:01:00.000Z", v: 40, average: 40, sampleCount: 3 },
  ],
};

function renderLive(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ForecastWidgetLive widget={WIDGET} />
    </QueryClientProvider>,
  );
}

/** Both reads name the bound point's ref; the actual line is the hourly mean (R10). */
export async function theTwoReadsNameTheBoundPoint(): Promise<void> {
  mocks.fetchPointAggregate.mockResolvedValue(AGGREGATE);
  mocks.fetchPointForecast.mockResolvedValue({ asOf: TO, forecast: null });
  renderLive();
  expect(await screen.findByText("No forecast for this point yet.")).toBeTruthy();
  expect(FORECAST_WIDGET_WINDOW_MINUTES).toBe(1440);
  expect(mocks.fetchPointAggregate).toHaveBeenCalledWith(REF, {
    windowMinutes: 1440,
    bucketFunction: "avg",
    bucketStats: true,
  });
  expect(mocks.fetchPointForecast).toHaveBeenCalledWith(REF);
  const actual = mocks.recorded.at(-1)?.option.series[0];
  expect(actual?.name).toBe("chw_kw");
  expect(actual?.data).toEqual([["2026-11-16T09:00:00.000Z", 32.5]]);
}

/** A 403 on the actual read draws the access sentence and nothing else. */
export async function aForbiddenReadDrawsTheAccessSentence(): Promise<void> {
  mocks.fetchPointAggregate.mockRejectedValue(new Error("telemetry aggregate 403"));
  mocks.fetchPointForecast.mockRejectedValue(new Error("ml forecast 403"));
  renderLive();
  expect(await screen.findByText(ACCESS_SENTENCE)).toBeTruthy();
  await waitFor(() => expect(mocks.fetchPointForecast).toHaveBeenCalled());
  expect(mocks.recorded).toHaveLength(0);
}
