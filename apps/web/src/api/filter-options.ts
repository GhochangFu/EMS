import { filterOptionsResponseSchema, type FilterOptionsResponse } from "@bms/shared/contracts";

import { ApiError } from "../lib/api-error";
import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/** One cache entry for `/alarms` and `/rules` alike; the pickers read it with a 5-minute `staleTime`. */
export const filterOptionsQueryKey = ["filter-options"] as const;

/**
 * `F4.361` (ADR 0132 decision 2) — `GET /api/v1/filter-options`: the organizations, location tree,
 * asset groups and assets the caller reads. No query; any signed-in user.
 */
export async function fetchFilterOptions(): Promise<FilterOptionsResponse> {
  const sent = withAuth();
  const res = await fetch(`${base}/api/v1/filter-options`, sent);
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    // An `ApiError`, so `shouldRetryQuery` does not retry a 403/404 while a scoped list waits (D13).
    throw new ApiError(`filter-options ${res.status}`, res.status);
  }
  return checkResponse(filterOptionsResponseSchema, await res.json(), "filter-options");
}
