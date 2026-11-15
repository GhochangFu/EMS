import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, vi } from "vitest";

import type { DashboardKpis } from "@bms/shared";

import * as dashboardApi from "../api/dashboard";
import { useExecutiveDashboard } from "./use-executive-dashboard";

/**
 * `F4.375` (ADR 0133 Amendment 2, plan Q1 and U4) — the estate Total load tile shows the
 * server's `totalKw`, the shown-locations sum, not the sum of the last telemetry socket frame
 * (which summed every `kw` reading the socket carried, an `off` organization's included). The
 * socket still drives the Live/Stale pill and the chart's live tail.
 *
 * `socket.io-client` is stubbed: the stub keeps each handler so a case can deliver a frame.
 * Assertions live here; `use-executive-dashboard.test.tsx` is the Vitest entry point (ADR 0014).
 */

const handlers = new Map<string, (payload: unknown) => void>();

vi.mock("socket.io-client", () => ({
  io: () => ({
    on: (event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler);
    },
    disconnect: () => undefined,
  }),
}));

const KPIS: DashboardKpis = {
  totalKw: 42,
  energyShown: true,
  sitesOnline: 1,
  sitesTotal: 1,
  alarmsOpen: 0,
  alarmsCritical: 0,
  pueEstimate: null,
  asOf: "2026-11-15T10:00:00.000Z",
  prior: { asOf: "2026-11-14T10:00:00.000Z", totalKw: null, alarmsOpen: 0, pueEstimate: null },
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/** H1 — after a socket frame carrying `kw` 999, the tile still reads the server's 42; the chart tail takes 999. */
export async function theTileShowsTheServerFigureNotTheSocketSum(): Promise<void> {
  handlers.clear();
  vi.spyOn(dashboardApi, "fetchDashboardKpis").mockResolvedValue(KPIS);
  vi.spyOn(dashboardApi, "fetchLoadTrend").mockResolvedValue({ points: [] });
  const { result } = renderHook(() => useExecutiveDashboard(), { wrapper });

  await waitFor(() => expect(result.current.kpiQuery.data?.totalKw).toBe(42));
  const frame = handlers.get("telemetry");
  expect(frame).toBeDefined();
  act(() => {
    frame?.({
      readings: [{ time: "2026-11-15T10:00:05.000Z", assetId: "a-1", pointKey: "kw", value: 999, unit: "kW" }],
    });
  });

  expect(result.current.displayTotalKw).toBe(42);
  expect(result.current.stale).toBe(false);
  expect(result.current.chartPoints.map((point) => point.totalKw)).toEqual([999]);
}

/** H2 — a server answer of `null` (nothing in scope shows energy) is shown as `null`, never a socket sum. */
export async function aNullServerFigureStaysNull(): Promise<void> {
  handlers.clear();
  vi.spyOn(dashboardApi, "fetchDashboardKpis").mockResolvedValue({ ...KPIS, totalKw: null, energyShown: false });
  vi.spyOn(dashboardApi, "fetchLoadTrend").mockResolvedValue({ points: [] });
  const { result } = renderHook(() => useExecutiveDashboard(), { wrapper });

  await waitFor(() => expect(result.current.kpiQuery.data?.energyShown).toBe(false));
  act(() => {
    handlers.get("telemetry")?.({
      readings: [{ time: "2026-11-15T10:00:05.000Z", assetId: "a-1", pointKey: "kw", value: 7, unit: "kW" }],
    });
  });

  expect(result.current.displayTotalKw).toBeNull();
}
