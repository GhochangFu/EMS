import { siteTrendPointsDtoSchema } from "@bms/shared/contracts";
import type { SiteTrendPointsDto } from "@bms/shared";

import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `F4.306` PR 2 U10 (ADR 0108 Amendment 7) — a site's effective trend-point lists, the read the
 * trend strip wizard and the builder's selection summary share. The `api/trend-strip.ts` shape:
 * `withAuth`, `clearSessionOnAuthFailure` on a non-OK status, a plain thrown `Error` naming the
 * route and status, and the body checked against the contract. Not `api/admin/trend-points.ts`:
 * that is the organization admin route over `adminFetch`.
 */

/** GET /api/v1/control-room/sites/:locationId/trend-points */
export async function fetchSiteTrendPoints(locationId: string): Promise<SiteTrendPointsDto> {
  const sent = withAuth();
  const res = await fetch(
    `${base}/api/v1/control-room/sites/${encodeURIComponent(locationId)}/trend-points`,
    sent,
  );
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new Error(`control-room/sites/:id/trend-points ${res.status}`);
  }
  return checkResponse(siteTrendPointsDtoSchema, await res.json(), "control-room/sites/:id/trend-points");
}
