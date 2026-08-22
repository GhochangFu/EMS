import type { MasterDataActiveFilter } from "@bms/shared";
import type { Contract, ContractSchema } from "@bms/shared/contracts";

import { ApiError } from "../../lib/api-error";
import { clearSessionOnAuthFailure, withAuth } from "../http";
import { checkResponse } from "../validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * Performs an authenticated admin API request and checks the response against
 * its contract (ADR 0030 decision 5).
 *
 * **The schema is a required argument, deliberately.** It could have been
 * optional, with a lint rule to catch the calls that omit it — but then the
 * default behaviour of the most-used function in this directory would be "do
 * not check", and 42 call sites would each be one forgotten argument away from
 * silently opting out. Required means the compiler finds them, not a reviewer.
 *
 * The `!res.ok` branch is unchanged and still runs first: an error body is not
 * a response contract, and `clearSessionOnAuthFailure` has to see the 401.
 *
 * **It throws `ApiError`, not `Error` (`F4.63`).** The message is byte-identical
 * to what `new Error(text)` produced, so every one of those 42 call sites and
 * every `apiErrorMessage()` read is untouched; the status is added so a caller
 * can tell "refused" from "failed" without parsing the body. `lib/query-retry.ts`
 * is the first reader — it is what stops a 403 costing four requests.
 */
export async function adminFetch<S extends ContractSchema>(
  path: string,
  schema: S,
  init?: RequestInit,
): Promise<Contract<S>> {
  const res = await fetch(`${base}/api/v1${path}`, withAuth(init));
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    throw new ApiError(text || `admin ${path} ${res.status}`, res.status);
  }
  // The path carries ids; the label must not. See `checkResponse`.
  const endpoint = `admin ${path.split("?")[0]?.replace(/\/[0-9a-f-]{8,}/gi, "/:id") ?? path}`;
  return checkResponse(schema, await res.json(), endpoint);
}

/** Builds an active filter query param. */
export function activeQuery(active: MasterDataActiveFilter): string {
  return `active=${active}`;
}

/** Returns auth headers for non-JSON admin requests (file upload/download). */
export function getAdminAuthHeaders(): Headers {
  const init = withAuth();
  return new Headers(init.headers);
}
