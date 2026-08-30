import { assetHealthResponseSchema, healthSummaryResponseSchema } from "@bms/shared/contracts";
import type { AssetHealthResponse, HealthSummaryResponse } from "@bms/shared";

import { withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `E1.3` Unit 8 — the client for the asset health score read API (ADR 0050 +
 * Amendment 1 decision 5). Follows `dashboard.ts`'s shape: a plain thrown
 * `Error` on `!res.ok`, not `ApiError` — neither read here is followed by a
 * write whose 403 needs to survive to an inline render the way
 * `dashboards.ts`'s does.
 */

/** `GET /api/v1/asset-health/assets/:assetId` — one asset's score. */
export async function fetchAssetHealth(assetId: string): Promise<AssetHealthResponse> {
  const res = await fetch(`${base}/api/v1/asset-health/assets/${encodeURIComponent(assetId)}`, withAuth());
  if (!res.ok) {
    throw new Error(`asset-health/assets/:assetId ${res.status}`);
  }
  return checkResponse(assetHealthResponseSchema, await res.json(), "asset-health/assets/:assetId");
}

/** `GET /api/v1/asset-health/summary`, optionally narrowed by `locationId`. */
export async function fetchHealthSummary(locationId?: string): Promise<HealthSummaryResponse> {
  const query = locationId ? `?locationId=${encodeURIComponent(locationId)}` : "";
  const res = await fetch(`${base}/api/v1/asset-health/summary${query}`, withAuth());
  if (!res.ok) {
    throw new Error(`asset-health/summary ${res.status}`);
  }
  return checkResponse(healthSummaryResponseSchema, await res.json(), "asset-health/summary");
}
