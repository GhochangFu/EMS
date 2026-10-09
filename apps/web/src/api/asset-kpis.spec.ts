import { expect, vi } from "vitest";

import { fetchAssetKpis } from "./asset-kpis";

/**
 * `F2.33` (ADR 0097 decision 1) — the KPI client reaches the right URL and
 * validates the body. `node` environment, as `asset-health.spec.ts`.
 */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const ASSET_ID = "22222222-2222-4222-8222-222222222222";

const BODY = {
  assetId: ASSET_ID,
  windowMinutes: 15,
  items: [
    { code: "kw_now", name: "kW now", unit: "kW", value: 4, state: "ok", inputAsOf: null, excluded: 0, memberCount: 0 },
  ],
};

function stubFetch(body: unknown, status = 200): () => string {
  let seen = "";
  vi.stubGlobal("fetch", async (url: string) => {
    seen = url;
    return new Response(JSON.stringify(body), { status });
  });
  return () => seen;
}

/** The exact URL — no query string, so the API applies its default window. */
export async function fetchesTheKpisRouteForTheAsset(): Promise<void> {
  const seen = stubFetch(BODY);
  const response = await fetchAssetKpis(ASSET_ID);
  expect(seen()).toBe(`${BASE}/api/v1/assets/${ASSET_ID}/kpis`);
  expect(response.items[0]?.code).toBe("kw_now");
}

/** A body carrying a member id is refused by the strict contract (decision 6). */
export async function refusesABodyOutsideTheContract(): Promise<void> {
  stubFetch({ ...BODY, items: [{ ...BODY.items[0], memberIds: ["x"] }] });
  await expect(fetchAssetKpis(ASSET_ID)).rejects.toThrow();
}

export async function throwsOnANonOkStatus(): Promise<void> {
  stubFetch({ message: "Forbidden" }, 403);
  await expect(fetchAssetKpis(ASSET_ID)).rejects.toThrow(/403/);
}
