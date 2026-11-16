import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";

import type { DashboardWidgetDto } from "@bms/shared";

import { ACCESS_SENTENCE } from "../asset-history/history-format";
import { AnomalyWidgetLive, anomalyWidgetWindow } from "./anomaly-widget-live";

/**
 * `E1.2d` — the live anomaly widget reads the bound point's asset for the last 168 hours, every 15
 * minutes. The api client is a module mock and `echarts-for-react` records the option.
 * Entry point: `anomaly-widget-live.test.tsx`.
 */
const mocks = vi.hoisted(() => ({
  fetchAssetAnomalies: vi.fn(),
  recorded: [] as { option: { series: { name: string; data: [string, number | null][] }[] } }[],
}));

vi.mock("../../api/ml", () => ({ fetchAssetAnomalies: mocks.fetchAssetAnomalies }));
vi.mock("echarts-for-react", () => ({
  default: (props: (typeof mocks.recorded)[number]) => {
    mocks.recorded.push(props);
    return null;
  },
}));

/** Clears the mock and the recorded props between cases. */
export function resetLiveMocks(): void {
  mocks.fetchAssetAnomalies.mockReset();
  mocks.recorded.length = 0;
}

const ASSET = "66666666-6666-4666-8666-666666666666";
const NOW = Date.parse("2026-11-16T10:20:00.000Z");
const TO = "2026-11-16T11:00:00.000Z";
const FROM = "2026-11-09T11:00:00.000Z";

const WIDGET = {
  id: "w-1",
  dashboardId: "d-1",
  organizationId: "o-1",
  title: "Chiller anomaly",
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
  widgetType: "anomaly",
  config: {},
} as Extract<DashboardWidgetDto, { widgetType: "anomaly" }>;

function renderLive(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AnomalyWidgetLive widget={WIDGET} now={NOW} />
    </QueryClientProvider>,
  );
  return client;
}

/** The read names the bound point's asset and a 7-day window of whole UTC hours. */
export async function theReadNamesTheAssetAndSevenDays(): Promise<void> {
  mocks.fetchAssetAnomalies.mockResolvedValue({
    asOf: "2026-11-16T10:20:00.000Z",
    scores: [{ t: "2026-11-16T09:00:00.000Z", detector: "baseline_mad", score: 0.5, contributingPoints: [] }],
  });
  renderLive();
  await waitFor(() => expect(mocks.recorded.length).toBeGreaterThan(0));
  expect(mocks.fetchAssetAnomalies).toHaveBeenCalledWith(ASSET, FROM, TO);
  expect(Date.parse(TO) - Date.parse(FROM)).toBe(7 * 24 * 3_600_000);
  expect(anomalyWidgetWindow(NOW)).toEqual({ from: Date.parse(FROM), to: Date.parse(TO) });
  const line = mocks.recorded.at(-1)?.option.series[0];
  expect(line?.data).toHaveLength(168);
  expect(line?.data.find(([t]) => t === "2026-11-16T09:00:00.000Z")?.[1]).toBe(0.5);
}

/** An asset with no score: the empty sentence. */
export async function noScoresDrawsTheEmptySentence(): Promise<void> {
  mocks.fetchAssetAnomalies.mockResolvedValue({ asOf: "2026-11-16T10:20:00.000Z", scores: [] });
  renderLive();
  expect(await screen.findByText("No anomaly scores for this asset yet.")).toBeTruthy();
  expect(mocks.recorded).toHaveLength(0);
}

/** A 403 draws the access sentence, and the re-poll and the focus refetch stop. */
export async function aForbiddenReadDrawsTheAccessSentenceAndStops(): Promise<void> {
  mocks.fetchAssetAnomalies.mockRejectedValue(new Error("ml asset anomalies 403"));
  const client = renderLive();
  expect(await screen.findByText(ACCESS_SENTENCE)).toBeTruthy();
  expect(mocks.recorded).toHaveLength(0);
  const query = client.getQueryCache().findAll({ queryKey: ["anomaly-widget"] })[0];
  const options = query?.options as
    | { readonly refetchInterval?: unknown; readonly refetchOnWindowFocus?: unknown }
    | undefined;
  const interval = options?.refetchInterval as (q: { state: { error: unknown } }) => number | false;
  const onFocus = options?.refetchOnWindowFocus as (q: { state: { error: unknown } }) => boolean;
  expect(interval({ state: { error: null } })).toBe(900_000);
  expect(interval({ state: { error: new Error("ml asset anomalies 403") } })).toBe(false);
  expect(onFocus({ state: { error: new Error("ml asset anomalies 403") } })).toBe(false);
}
