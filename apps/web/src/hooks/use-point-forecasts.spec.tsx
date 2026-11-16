import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, vi } from "vitest";

import { encodePointRef } from "@bms/shared";
import type { PointForecastResponse } from "@bms/shared";

import * as mlApi from "../api/ml";
import { FORECAST_REFETCH_MS, forecastRefetchMs, usePointForecasts } from "./use-point-forecasts";

/**
 * `E1.4a` — `usePointForecasts`: one read per point, nothing when disabled, the 15-minute re-poll
 * wired into each query, and a failed read — first or later — is simply no forecast. Every failure
 * here is a 403, which `retryUnlessForbidden` treats as final, so each assertion sees a settled
 * error and never the loading state of a retry (PR 2 code review). Entry point:
 * `use-point-forecasts.test.tsx` (ADR 0014).
 */
const ASSET = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ANSWER: PointForecastResponse = {
  asOf: "2026-11-16T10:20:00.000Z",
  forecast: {
    issuedAt: "2026-11-16T10:05:00.000Z",
    modelName: "amazon/chronos-2",
    modelVersion: "0".repeat(40),
    stale: false,
    buckets: [{ t: "2026-11-16T10:00:00.000Z", p10: 1, p50: 2, p90: 3 }],
  },
};
const FORBIDDEN = new Error("ml forecast 403");

function harness(): { client: QueryClient; wrapper: (props: { children: ReactNode }) => JSX.Element } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    wrapper: function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    },
  };
}

/** One read per charted point, and each query carries the 15-minute re-poll that stops after a 403. */
export async function onePointReadPerChartedPoint(): Promise<void> {
  const spy = vi.spyOn(mlApi, "fetchPointForecast").mockResolvedValue(ANSWER);
  const { client, wrapper } = harness();
  const { result } = renderHook(() => usePointForecasts(ASSET, ["kw", "temp c"], true), { wrapper });
  await waitFor(() => expect(result.current.every((r) => r.data !== undefined)).toBe(true));
  expect(spy.mock.calls.map((call) => call[0]).sort()).toEqual(
    [encodePointRef(ASSET, "kw"), encodePointRef(ASSET, "temp c")].sort(),
  );
  expect(result.current.map((r) => r.pointKey)).toEqual(["kw", "temp c"]);
  const queries = client.getQueryCache().findAll({ queryKey: ["point-forecast"] });
  expect(queries).toHaveLength(2);
  for (const query of queries) {
    // An observer option: TanStack merges it into the query's options at run time, but the
    // `QueryOptions` type does not declare it.
    const interval = (query.options as { readonly refetchInterval?: unknown }).refetchInterval;
    expect(typeof interval).toBe("function");
    const call = interval as (q: { state: { error: unknown } }) => number | false;
    expect(call({ state: { error: null } })).toBe(FORECAST_REFETCH_MS);
    expect(call({ state: { error: FORBIDDEN } })).toBe(false);
  }
  spy.mockRestore();
}

/** Disabled asks nothing. */
export async function disabledAsksNothing(): Promise<void> {
  const spy = vi.spyOn(mlApi, "fetchPointForecast").mockResolvedValue(ANSWER);
  const { result } = renderHook(() => usePointForecasts(ASSET, ["kw"], false), { wrapper: harness().wrapper });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(spy).not.toHaveBeenCalled();
  expect(result.current).toEqual([{ pointKey: "kw", data: undefined }]);
  spy.mockRestore();
}

/** Turning the gate off (avg → max) hides an already-cached forecast: the key holds no `fn`. */
export async function aCachedForecastIsHiddenOnceDisabled(): Promise<void> {
  const spy = vi.spyOn(mlApi, "fetchPointForecast").mockResolvedValue(ANSWER);
  const { result, rerender } = renderHook(({ on }: { on: boolean }) => usePointForecasts(ASSET, ["kw"], on), {
    wrapper: harness().wrapper,
    initialProps: { on: true },
  });
  await waitFor(() => expect(result.current[0]?.data).toEqual(ANSWER));
  rerender({ on: false });
  expect(result.current).toEqual([{ pointKey: "kw", data: undefined }]);
  spy.mockRestore();
}

/** A first read that fails, once settled, is no forecast. */
export async function aFailedReadIsNoForecast(): Promise<void> {
  const spy = vi.spyOn(mlApi, "fetchPointForecast").mockRejectedValue(FORBIDDEN);
  const { client, wrapper } = harness();
  const { result } = renderHook(() => usePointForecasts(ASSET, ["kw"], true), { wrapper });
  await waitFor(() =>
    expect(client.getQueryCache().find({ queryKey: ["point-forecast", encodePointRef(ASSET, "kw")] })?.state.status).toBe(
      "error",
    ),
  );
  expect(spy).toHaveBeenCalledTimes(1);
  expect(result.current).toEqual([{ pointKey: "kw", data: undefined }]);
  spy.mockRestore();
}

/** A later refetch that fails drops the last forecast too, rather than drawing it on, hours old. */
export async function aFailedRefetchDropsTheLastForecast(): Promise<void> {
  const spy = vi.spyOn(mlApi, "fetchPointForecast").mockResolvedValueOnce(ANSWER).mockRejectedValue(FORBIDDEN);
  const { client, wrapper } = harness();
  const { result } = renderHook(() => usePointForecasts(ASSET, ["kw"], true), { wrapper });
  await waitFor(() => expect(result.current[0]?.data).toEqual(ANSWER));
  await client.refetchQueries({ queryKey: ["point-forecast"] });
  await waitFor(() => expect(result.current).toEqual([{ pointKey: "kw", data: undefined }]));
  spy.mockRestore();
}

/** A 403 is not polled again (security review L1); any other failure keeps the 15-minute re-poll. */
export function aForbiddenReadIsNotPolledAgain(): void {
  expect(forecastRefetchMs(FORBIDDEN)).toBe(false);
  expect(forecastRefetchMs(new Error("ml forecast 500"))).toBe(FORECAST_REFETCH_MS);
  expect(forecastRefetchMs(null)).toBe(FORECAST_REFETCH_MS);
}
