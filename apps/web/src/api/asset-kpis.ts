import { assetKpisResponseSchema } from "@bms/shared/contracts";
import type { AssetKpisResponse } from "@bms/shared";

import { withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `F2.33` (ADR 0097 decision 1) — `GET /api/v1/assets/:assetId/kpis`, the
 * asset's template KPIs evaluated at read time. No `windowMinutes`: the card
 * shows the API's default window. The `asset-health.ts` shape — a plain
 * thrown `Error` on `!res.ok`, and the body checked against the contract.
 */
export async function fetchAssetKpis(assetId: string): Promise<AssetKpisResponse> {
  const res = await fetch(`${base}/api/v1/assets/${encodeURIComponent(assetId)}/kpis`, withAuth());
  if (!res.ok) {
    throw new Error(`assets/:assetId/kpis ${res.status}`);
  }
  return checkResponse(assetKpisResponseSchema, await res.json(), "assets/:assetId/kpis");
}
