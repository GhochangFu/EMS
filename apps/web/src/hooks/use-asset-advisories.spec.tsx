import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, vi } from "vitest";

import type { AdvisoriesResponse } from "@bms/shared/contracts";

import * as advisoriesApi from "../api/advisories";
import { anAdvisory, FIXTURE_ASSET } from "../components/advisories/advisory-card.spec";
import { ADVISORIES_REFETCH_MS } from "../lib/advisories";
import { useAssetAdvisories } from "./use-asset-advisories";

/**
 * `E1.6b` / ADR 0137 (plan T2.5) — `useAssetAdvisories`: one read per asset, re-read every 15
 * minutes until a 403, nothing for an id that is not a uuid, and a failed read — first or later —
 * is simply no advisories (R-l). Entry point: `use-asset-advisories.test.tsx` (ADR 0014).
 */
const ANSWER: AdvisoriesResponse = {
  asOf: "2026-11-16T10:20:00.000Z",
  candidates: 1,
  considered: 1,
  advisories: [anAdvisory()],
};
const FORBIDDEN = new Error("asset advisories 403");

function harness(): { client: QueryClient; wrapper: (props: { children: ReactNode }) => JSX.Element } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    wrapper: function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    },
  };
}

/** One read for the asset; its query re-reads every 15 minutes until a 403. */
export async function oneReadForTheAsset(): Promise<void> {
  const spy = vi.spyOn(advisoriesApi, "fetchAssetAdvisories").mockResolvedValue(ANSWER);
  const { client, wrapper } = harness();
  const { result } = renderHook(() => useAssetAdvisories(FIXTURE_ASSET), { wrapper });
  await waitFor(() => expect(result.current).toEqual(ANSWER.advisories));
  expect(spy.mock.calls).toEqual([[FIXTURE_ASSET]]);
  const queries = client.getQueryCache().findAll({ queryKey: ["asset-advisories"] });
  expect(queries).toHaveLength(1);
  const interval = (queries[0]?.options as { readonly refetchInterval?: unknown }).refetchInterval as (q: {
    state: { error: unknown };
  }) => number | false;
  expect(interval({ state: { error: null } })).toBe(ADVISORIES_REFETCH_MS);
  expect(interval({ state: { error: FORBIDDEN } })).toBe(false);
  spy.mockRestore();
}

/** An id that is not a uuid asks nothing. */
export async function aNonUuidAsksNothing(): Promise<void> {
  const spy = vi.spyOn(advisoriesApi, "fetchAssetAdvisories").mockResolvedValue(ANSWER);
  const { result } = renderHook(() => useAssetAdvisories("not-a-uuid"), { wrapper: harness().wrapper });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(spy).not.toHaveBeenCalled();
  expect(result.current).toBeUndefined();
  spy.mockRestore();
}

/** A failed first read, settled, is no advisories, asked once. */
export async function aFailedReadIsNoAdvisories(): Promise<void> {
  const spy = vi.spyOn(advisoriesApi, "fetchAssetAdvisories").mockRejectedValue(FORBIDDEN);
  const { client, wrapper } = harness();
  const { result } = renderHook(() => useAssetAdvisories(FIXTURE_ASSET), { wrapper });
  await waitFor(() =>
    expect(client.getQueryCache().findAll({ queryKey: ["asset-advisories"] })[0]?.state.status).toBe("error"),
  );
  expect(spy).toHaveBeenCalledTimes(1);
  expect(result.current).toBeUndefined();
  spy.mockRestore();
}

/** A later read that fails drops the last advisories rather than showing them on. */
export async function aFailedRefetchDropsTheAdvisories(): Promise<void> {
  const spy = vi
    .spyOn(advisoriesApi, "fetchAssetAdvisories")
    .mockResolvedValueOnce(ANSWER)
    .mockRejectedValue(FORBIDDEN);
  const { client, wrapper } = harness();
  const { result } = renderHook(() => useAssetAdvisories(FIXTURE_ASSET), { wrapper });
  await waitFor(() => expect(result.current).toEqual(ANSWER.advisories));
  await client.refetchQueries({ queryKey: ["asset-advisories"] });
  await waitFor(() => expect(result.current).toBeUndefined());
  spy.mockRestore();
}
