import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, vi } from "vitest";

import type { HealthSummaryResponse } from "@bms/shared";
import type { AssetHealthInputsResponse, HealthBadActorsResponse } from "@bms/shared/contracts";

import * as assetHealthApi from "../api/asset-health";
import { useAssetHealthInputs, useHealthBadActors, useHealthSummary } from "./use-asset-health";

/**
 * `F3.72` U1 — `useHealthSummary(filter)`: the filter reaches the fetcher, and the query key
 * carries both fields, so two scopes are two cache entries.
 *
 * **One `QueryClient` for both renders.** A wrapper that builds its client inside would give
 * each render a fresh cache, and a key that dropped `organizationId` would still refetch — the
 * case would stay green with the defect in. The client is shared, so only a key that differs
 * makes the second fetch.
 */

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "44444444-4444-4444-8444-444444444444";
const LOCATION = "33333333-3333-4333-8333-333333333333";

const SUMMARY = { assetCount: 0 } as unknown as HealthSummaryResponse;

function sharedWrapper(
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
): (props: { children: ReactNode }) => JSX.Element {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

/** The filter object is handed to the fetcher whole. */
export async function theFilterReachesTheFetcher(): Promise<void> {
  const spy = vi.spyOn(assetHealthApi, "fetchHealthSummary").mockResolvedValue(SUMMARY);
  renderHook(() => useHealthSummary({ organizationId: ORG_A, locationId: LOCATION }), {
    wrapper: sharedWrapper(),
  });

  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  expect(spy.mock.calls[0]).toEqual([{ organizationId: ORG_A, locationId: LOCATION }]);
}

/** Two organizations on one client are two fetches — the key carries `organizationId`. */
export async function theKeyCarriesTheOrganizationId(): Promise<void> {
  const spy = vi.spyOn(assetHealthApi, "fetchHealthSummary").mockResolvedValue(SUMMARY);
  const { rerender } = renderHook(
    ({ organizationId }: { organizationId: string }) => useHealthSummary({ organizationId }),
    { wrapper: sharedWrapper(), initialProps: { organizationId: ORG_A } },
  );
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

  rerender({ organizationId: ORG_B });

  await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  expect(spy.mock.calls.map(([filter]) => filter?.organizationId)).toEqual([ORG_A, ORG_B]);
}

/** Two locations on one client are two fetches — the key carries `locationId` too. */
export async function theKeyCarriesTheLocationId(): Promise<void> {
  const spy = vi.spyOn(assetHealthApi, "fetchHealthSummary").mockResolvedValue(SUMMARY);
  const { rerender } = renderHook(
    ({ locationId }: { locationId?: string }) => useHealthSummary({ locationId }),
    { wrapper: sharedWrapper(), initialProps: { locationId: undefined as string | undefined } },
  );
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

  rerender({ locationId: LOCATION });

  await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  expect(spy.mock.calls.map(([filter]) => filter?.locationId)).toEqual([undefined, LOCATION]);
}

/** No argument is the enterprise summary: the fetcher receives an empty filter. */
export async function noArgumentIsTheEnterpriseSummary(): Promise<void> {
  const spy = vi.spyOn(assetHealthApi, "fetchHealthSummary").mockResolvedValue(SUMMARY);
  renderHook(() => useHealthSummary(), { wrapper: sharedWrapper() });

  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  expect(spy.mock.calls[0]).toEqual([{}]);
}

// ---------------------------------------------------------------------------
// `E1.8b` T2.2 (plan §7, R-o) — `useAssetHealthInputs` and `useHealthBadActors`.
// ---------------------------------------------------------------------------

const ASSET = "22222222-2222-4222-8222-222222222222";
const INPUTS = { assetId: ASSET } as unknown as AssetHealthInputsResponse;
const BAD_ACTORS = { scoredAssetCount: 0, anomaly: null } as unknown as HealthBadActorsResponse;

/** A client whose defaults would retry and refetch, so only the hook's own options can turn them off. */
function permissiveClient(): QueryClient {
  return new QueryClient();
}

/** The inputs key is the plan's, and the fetcher gets the asset id. */
export async function inputsKeyAndFetch(): Promise<void> {
  const spy = vi.spyOn(assetHealthApi, "fetchAssetHealthInputs").mockResolvedValue(INPUTS);
  const client = permissiveClient();
  renderHook(() => useAssetHealthInputs(ASSET), { wrapper: sharedWrapper(client) });

  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  expect(spy.mock.calls[0]).toEqual([ASSET]);
  expect(client.getQueryCache().getAll().map((q) => q.queryKey)).toEqual([["asset-health", "inputs", ASSET]]);
}

/** An empty id makes no request. */
export async function inputsOffForAnEmptyId(): Promise<void> {
  const spy = vi.spyOn(assetHealthApi, "fetchAssetHealthInputs").mockResolvedValue(INPUTS);
  const { result } = renderHook(() => useAssetHealthInputs(""), { wrapper: sharedWrapper() });

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(spy).not.toHaveBeenCalled();
  expect(result.current.fetchStatus).toBe("idle");
}

/** A rejected inputs read is not retried: the card stays as it is, at once. */
export async function inputsDoesNotRetry(): Promise<void> {
  const spy = vi.spyOn(assetHealthApi, "fetchAssetHealthInputs").mockRejectedValue(new Error("x 500"));
  const { result } = renderHook(() => useAssetHealthInputs(ASSET), { wrapper: sharedWrapper(permissiveClient()) });

  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(spy).toHaveBeenCalledTimes(1);
}

/**
 * The bad-actors key is the plan's, and the fetcher receives the filter itself — a thunk, not the
 * bare function, which TanStack would hand its own context object.
 */
export async function badActorsKeyAndThunk(): Promise<void> {
  const spy = vi.spyOn(assetHealthApi, "fetchHealthBadActors").mockResolvedValue(BAD_ACTORS);
  const client = permissiveClient();
  renderHook(() => useHealthBadActors({ organizationId: ORG_A, locationId: LOCATION }, true), {
    wrapper: sharedWrapper(client),
  });

  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  expect(spy.mock.calls[0]).toEqual([{ organizationId: ORG_A, locationId: LOCATION }]);
  expect(client.getQueryCache().getAll().map((q) => q.queryKey)).toEqual([
    ["asset-health", "bad-actors", LOCATION, ORG_A],
  ]);
}

/** No filter field is `null` in the key, so the enterprise read is one cache entry. */
export async function badActorsEnterpriseKey(): Promise<void> {
  vi.spyOn(assetHealthApi, "fetchHealthBadActors").mockResolvedValue(BAD_ACTORS);
  const client = permissiveClient();
  renderHook(() => useHealthBadActors({}, true), { wrapper: sharedWrapper(client) });

  await waitFor(() => expect(client.getQueryCache().getAll()[0]?.state.status).toBe("success"));
  expect(client.getQueryCache().getAll().map((q) => q.queryKey)).toEqual([["asset-health", "bad-actors", null, null]]);
}

/** `enabled: false` makes no request. */
export async function badActorsOffWhenDisabled(): Promise<void> {
  const spy = vi.spyOn(assetHealthApi, "fetchHealthBadActors").mockResolvedValue(BAD_ACTORS);
  renderHook(() => useHealthBadActors({ organizationId: ORG_A }, false), { wrapper: sharedWrapper() });

  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(spy).not.toHaveBeenCalled();
}

/** Two scopes on one client are two fetches: they never share a key. */
export async function badActorsTwoScopesTwoKeys(): Promise<void> {
  const spy = vi.spyOn(assetHealthApi, "fetchHealthBadActors").mockResolvedValue(BAD_ACTORS);
  const { rerender } = renderHook(
    ({ organizationId, locationId }: { organizationId?: string; locationId?: string }) =>
      useHealthBadActors({ organizationId, locationId }, true),
    { wrapper: sharedWrapper(), initialProps: { organizationId: ORG_A } as { organizationId?: string; locationId?: string } },
  );
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

  rerender({ organizationId: ORG_B });
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));

  rerender({ organizationId: ORG_B, locationId: LOCATION });
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(3));
  expect(spy.mock.calls.map(([filter]) => [filter?.organizationId, filter?.locationId])).toEqual([
    [ORG_A, undefined],
    [ORG_B, undefined],
    [ORG_B, LOCATION],
  ]);
}

/** R-o: 5 minutes fresh, no refetch on window focus, no retry — read off the cached query. */
export async function badActorsCacheOptions(): Promise<void> {
  const spy = vi.spyOn(assetHealthApi, "fetchHealthBadActors").mockRejectedValue(new Error("x 500"));
  const client = permissiveClient();
  const { result } = renderHook(() => useHealthBadActors({}, true), { wrapper: sharedWrapper(client) });

  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(spy, "retry: false — one request, not four").toHaveBeenCalledTimes(1);
  const options = client.getQueryCache().getAll()[0]?.options as {
    staleTime?: number;
    refetchOnWindowFocus?: boolean;
  };
  expect(options.staleTime).toBe(5 * 60 * 1000);
  expect(options.refetchOnWindowFocus).toBe(false);
}
