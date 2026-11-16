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
  fetchPastForecast: vi.fn(),
  recorded: [] as {
    option: { series: { name: string; data: [string, number | null][]; lineStyle?: { type?: string } }[] };
  }[],
}));

vi.mock("../../api/telemetry", () => ({ fetchPointAggregate: mocks.fetchPointAggregate }));
vi.mock("../../api/ml", () => ({
  fetchPointForecast: mocks.fetchPointForecast,
  fetchPastForecast: mocks.fetchPastForecast,
}));
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
  mocks.fetchPastForecast.mockReset();
  // `E1.4e`: no past buckets unless a case says otherwise.
  mocks.fetchPastForecast.mockResolvedValue({ asOf: TO, buckets: [] });
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

function renderLive(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ForecastWidgetLive widget={WIDGET} />
    </QueryClientProvider>,
  );
  return client;
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
  // Every UTC hour of the window, 10:00Z on the 15th to 10:00Z on the 16th, is present (R10 with
  // the window seeded): the one hour with data carries its mean, the rest are gaps, never joined.
  expect(actual?.data).toHaveLength(25);
  expect(actual?.data.find(([t]) => t === "2026-11-16T09:00:00.000Z")).toEqual(["2026-11-16T09:00:00.000Z", 32.5]);
  expect(actual?.data.filter(([, v]) => v !== null)).toHaveLength(1);
  expect(actual?.data[0]?.[0]).toBe("2026-11-15T10:00:00.000Z");
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

/** The aggregate read re-polls every 15 minutes and stops, focus refetch included, after a 403. */
export async function theActualReadRepollsUntilA403(): Promise<void> {
  mocks.fetchPointAggregate.mockResolvedValue(AGGREGATE);
  mocks.fetchPointForecast.mockResolvedValue({ asOf: TO, forecast: null });
  const client = renderLive();
  // `findAll`: `find` matches a key exactly, and the key carries the ref and the window too.
  const actualQuery = () => client.getQueryCache().findAll({ queryKey: ["forecast-widget-actual"] })[0];
  await waitFor(() => expect(actualQuery()?.state.status).toBe("success"));
  // Observer options, merged into the query's options at run time; `QueryOptions` does not declare them.
  const options = actualQuery()?.options as
    | { readonly refetchInterval?: unknown; readonly refetchOnWindowFocus?: unknown }
    | undefined;
  const interval = options?.refetchInterval as (q: { state: { error: unknown } }) => number | false;
  const onFocus = options?.refetchOnWindowFocus as (q: { state: { error: unknown } }) => boolean;
  expect(interval({ state: { error: null } })).toBe(900_000);
  expect(interval({ state: { error: new Error("telemetry aggregate 403") } })).toBe(false);
  expect(onFocus({ state: { error: null } })).toBe(true);
  expect(onFocus({ state: { error: new Error("telemetry aggregate 403") } })).toBe(false);
}

/**
 * `E1.4e` (ADR 0135 Amendment 4 ruling 4): the widget asks for the past forecast over the window
 * its actual read was served, draws it as a dashed line beside the actual one, and captions it.
 */
export async function theWidgetDrawsThePastForecastOverItsWindow(): Promise<void> {
  mocks.fetchPointAggregate.mockResolvedValue(AGGREGATE);
  mocks.fetchPointForecast.mockResolvedValue({ asOf: TO, forecast: null });
  mocks.fetchPastForecast.mockResolvedValue({ asOf: TO, buckets: [{ t: "2026-11-16T09:00:00.000Z", p50: 31 }] });
  renderLive();
  expect(await screen.findByTestId("past-forecast-caption")).toBeTruthy();
  expect(mocks.fetchPastForecast).toHaveBeenCalledWith(REF, AGGREGATE.from, AGGREGATE.to);
  const past = mocks.recorded.at(-1)?.option.series.find((s) => s.name === "Past forecast (1 h ahead)");
  expect(past?.data).toEqual([["2026-11-16T09:00:00.000Z", 31]]);
  expect(past?.lineStyle?.type).toBe("dashed");
}

