import { degradationResponseSchema } from "@bms/shared/contracts";
import type { DegradationResponse } from "@bms/shared/contracts";

import { ApiError } from "../lib/api-error";
import type { ScopeFilter } from "../lib/scope-filter";
import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/** The only scope keys the list route reads, in the order they are sent. */
const DEGRADATION_FILTER_KEYS = ["organizationId", "locationId"] as const;

/**
 * `E1.5b` / ADR 0138 (plan T2.1) — the two degradation reads. Both parse through the shared contract
 * (`checkResponse`, never a cast). A 401 clears the session first; a failure throws an `ApiError`
 * named `"<name> <status>"`, the shape `isForbidden` reads.
 */

/** `GET /api/v1/degradation[?organizationId=&locationId=]` — bare path with none set. */
export async function fetchDegradation(filter?: ScopeFilter): Promise<DegradationResponse> {
  const params = new URLSearchParams();
  for (const key of DEGRADATION_FILTER_KEYS) {
    const value = filter?.[key];
    if (value) {
      params.set(key, value);
    }
  }
  const query = params.toString();
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/degradation${query ? `?${query}` : ""}`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new ApiError(`degradation ${res.status}`, res.status);
  }
  return checkResponse(degradationResponseSchema, await res.json(), "degradation");
}

/** `GET /api/v1/assets/:assetId/degradation` — one asset's degradation, for its history page. */
export async function fetchAssetDegradation(assetId: string): Promise<DegradationResponse> {
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/assets/${encodeURIComponent(assetId)}/degradation`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new ApiError(`asset degradation ${res.status}`, res.status);
  }
  return checkResponse(degradationResponseSchema, await res.json(), "assets/:assetId/degradation");
}
