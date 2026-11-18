import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, vi } from "vitest";

import type { DegradationResponse } from "@bms/shared/contracts";

import * as degradationApi from "../api/degradation";
import { DEGRADATION_STALE_MS } from "../lib/degradation";
import { useAssetDegradation, useDegradationList } from "./use-degradation";

/**
 * `E1.5b` / ADR 0138 (plan T2.1) — `useAssetDegradation` and `useDegradationList`. Entry point:
 * `use-degradation.test.tsx` (ADR 0014). Fixtures are made up.
 */
const ASSET = "11111111-1111-4111-8111-111111111111";
const ORG = "44444444-4444-4444-8444-444444444444";
const SITE = "55555555-5555-4555-8555-555555555555";
const GROUP = "66666666-6666-4666-8666-666666666666";
const ANSWER: DegradationResponse = { asOf: "2026-11-16T10:20:00.000Z", candidates: 0, considered: 0, assets: [] };
const FORBIDDEN = new Error("asset degradation 403");

function harness(): { client: QueryClient; wrapper: (props: { children: ReactNode }) => JSX.Element } {
  // The hooks set their own retry policy; the client default is deliberately generous so a hook that forgets it shows.
  const client = new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 1 } } });
  return {
    client,
    wrapper: function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    },
  };
}

/** One read for the asset; its data is the response. */
export async function oneReadForTheAsset(): Promise<void> {
  const spy = vi.spyOn(degradationApi, "fetchAssetDegradation").mockResolvedValue(ANSWER);
  const { wrapper } = harness();
  const { result } = renderHook(() => useAssetDegradation(ASSET), { wrapper });
  await waitFor(() => expect(result.current).toEqual(ANSWER));
  expect(spy.mock.calls).toEqual([[ASSET]]);
  spy.mockRestore();
}

/** An id that is not a uuid asks nothing. */
export async function aNonUuidAsksNothing(): Promise<void> {
  const spy = vi.spyOn(degradationApi, "fetchAssetDegradation").mockResolvedValue(ANSWER);
  const { result } = renderHook(() => useAssetDegradation("not-a-uuid"), { wrapper: harness().wrapper });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(spy).not.toHaveBeenCalled();
  expect(result.current).toBeUndefined();
  spy.mockRestore();
}

/** A 403 is asked once (no retry), reads as `undefined`, and never throws to the caller. */
export async function aForbiddenReadIsUndefinedAndNotRetried(): Promise<void> {
  const spy = vi.spyOn(degradationApi, "fetchAssetDegradation").mockRejectedValue(FORBIDDEN);
  const { client, wrapper } = harness();
  const { result } = renderHook(() => useAssetDegradation(ASSET), { wrapper });
  await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: ["asset-degradation"] })[0]?.state.status).toBe("error"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(spy).toHaveBeenCalledTimes(1);
  expect(result.current).toBeUndefined();
  spy.mockRestore();
}

/** A later read that fails drops the last data rather than showing it on. */
export async function aFailedRefetchDropsTheData(): Promise<void> {
  const spy = vi
    .spyOn(degradationApi, "fetchAssetDegradation")
    .mockResolvedValueOnce(ANSWER)
    .mockRejectedValue(FORBIDDEN);
  const { client, wrapper } = harness();
  const { result } = renderHook(() => useAssetDegradation(ASSET), { wrapper });
  await waitFor(() => expect(result.current).toEqual(ANSWER));
  await client.refetchQueries({ queryKey: ["asset-degradation"] });
  await waitFor(() => expect(result.current).toBeUndefined());
  spy.mockRestore();
}

/** The list hook's queryFn is a thunk: the fetch receives the filter, never a React Query context. */
export async function theListQueryFnIsAThunkHoldingTheFilter(): Promise<void> {
  const spy = vi.spyOn(degradationApi, "fetchDegradation").mockResolvedValue(ANSWER);
  const filter = { organizationId: ORG, locationId: SITE, assetGroupId: GROUP };
  const { wrapper } = harness();
  const { result } = renderHook(() => useDegradationList(filter, true), { wrapper });
  await waitFor(() => expect(result.current.data).toEqual(ANSWER));
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy.mock.calls[0]).toEqual([filter]);
  spy.mockRestore();
}

/** Key, stale time, retry and focus policy of the list query; `enabled=false` asks nothing. */
export async function theListQueryPolicy(): Promise<void> {
  const spy = vi.spyOn(degradationApi, "fetchDegradation").mockResolvedValue(ANSWER);
  const { client, wrapper } = harness();
  const { result } = renderHook(() => useDegradationList({ organizationId: ORG, locationId: SITE }, true), { wrapper });
  await waitFor(() => expect(result.current.data).toEqual(ANSWER));
  const query = client.getQueryCache().findAll({ queryKey: ["degradation", "list"] })[0];
  expect(query?.queryKey).toEqual(["degradation", "list", SITE, ORG]);
  const options = query?.options as { staleTime?: number; retry?: unknown; refetchOnWindowFocus?: unknown };
  expect(options.staleTime).toBe(DEGRADATION_STALE_MS);
  expect(options.retry).toBe(false);
  expect(options.refetchOnWindowFocus).toBe(false);
  spy.mockRestore();

  const off = vi.spyOn(degradationApi, "fetchDegradation").mockResolvedValue(ANSWER);
  const none = renderHook(() => useDegradationList({}, false), { wrapper: harness().wrapper });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(off).not.toHaveBeenCalled();
  expect(none.result.current.data).toBeUndefined();
  off.mockRestore();

  const k = harness();
  renderHook(() => useDegradationList({}, true), { wrapper: k.wrapper });
  await waitFor(() =>
    expect(k.client.getQueryCache().findAll({ queryKey: ["degradation", "list"] })[0]?.queryKey).toEqual(["degradation", "list", null, null]),
  );
}
