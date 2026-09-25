import type { SystemStatusResponse } from "@bms/shared";
import { systemStatusResponseSchema } from "@bms/shared/contracts";

import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * How long one status read may take before it is aborted (owner ruling
 * 2026-09-25, code review Correctness 1). Without it a hung API left the
 * last good "operational" on screen for as long as the request stayed open:
 * TanStack Query does not start the next poll while one is in flight.
 */
export const SYSTEM_STATUS_TIMEOUT_MS = 10_000;

/**
 * `GET /api/v1/system/status` (`F3.30`, ADR 0075 decision 5) — the footer
 * indicator's read. Same `fetch` + `withAuth` + `checkResponse` shape as
 * `fetchAssets` in `./assets.ts`: no query, no body, bearer token from the
 * signed-in session, and the response is checked against
 * `systemStatusResponseSchema` and returned unchanged.
 *
 * The request aborts on whichever comes first: the query's own `signal`
 * (TanStack Query cancelling the read) or `SYSTEM_STATUS_TIMEOUT_MS`. A 401
 * clears the stale session, as `./alarms.ts` does.
 */
export async function fetchSystemStatus(signal?: AbortSignal): Promise<SystemStatusResponse> {
  const timeout = AbortSignal.timeout(SYSTEM_STATUS_TIMEOUT_MS);
  const res = await fetch(
    `${base}/api/v1/system/status`,
    withAuth({ signal: signal ? AbortSignal.any([signal, timeout]) : timeout }),
  );
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    throw new Error(`system/status ${res.status}`);
  }
  return checkResponse(systemStatusResponseSchema, await res.json(), "system/status");
}
