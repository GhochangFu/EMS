import type { SystemStatusResponse } from "@bms/shared";
import { systemStatusResponseSchema } from "@bms/shared/contracts";

import { withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `GET /api/v1/system/status` (`F3.30`, ADR 0075 decision 5) — the footer
 * indicator's read. Same `fetch` + `withAuth` + `checkResponse` shape as
 * `fetchAssets` in `./assets.ts`: no query, no body, bearer token from the
 * signed-in session, and the response is checked against
 * `systemStatusResponseSchema` and returned unchanged.
 */
export async function fetchSystemStatus(): Promise<SystemStatusResponse> {
  const res = await fetch(`${base}/api/v1/system/status`, withAuth());
  if (!res.ok) {
    throw new Error(`system/status ${res.status}`);
  }
  return checkResponse(systemStatusResponseSchema, await res.json(), "system/status");
}
