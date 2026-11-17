import { advisoriesResponseSchema } from "@bms/shared/contracts";
import type { AdvisoriesResponse } from "@bms/shared/contracts";

import { ApiError } from "../lib/api-error";
import { ML_PAGE_FILTER_KEYS } from "../lib/ml-findings";
import type { ScopeFilter } from "../lib/scope-filter";
import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `E1.6b` / ADR 0137 (plan T2.1) — the two advisory reads. Both parse through the shared contract
 * (`checkResponse`, never a cast). A 401 clears the session first; a failure throws an `ApiError`
 * named `"<name> <status>"`, the shape `isForbidden` reads.
 */

/**
 * `GET /api/v1/advisories[?organizationId=&locationId=]` — the advisories of every meter the
 * caller can read. Only the two page keys are sent, in that order; with none set the URL is the
 * bare path.
 */
export async function fetchAdvisories(filter?: ScopeFilter): Promise<AdvisoriesResponse> {
  const params = new URLSearchParams();
  for (const key of ML_PAGE_FILTER_KEYS) {
    const value = filter?.[key];
    if (value) {
      params.set(key, value);
    }
  }
  const query = params.toString();
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/advisories${query ? `?${query}` : ""}`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new ApiError(`advisories ${res.status}`, res.status);
  }
  return checkResponse(advisoriesResponseSchema, await res.json(), "advisories");
}

/** `GET /api/v1/assets/:assetId/advisories` — one asset's advisories, for its history page. */
export async function fetchAssetAdvisories(assetId: string): Promise<AdvisoriesResponse> {
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/assets/${encodeURIComponent(assetId)}/advisories`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new ApiError(`asset advisories ${res.status}`, res.status);
  }
  return checkResponse(advisoriesResponseSchema, await res.json(), "assets/:assetId/advisories");
}
