import { siteTrendStripSchema } from "@bms/shared/contracts";
import type { SiteTrendStripDto, TrendStripRange } from "@bms/shared";

import { clearSessionOnAuthFailure, withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `F4.301` (ADR 0108 Amendment 2, item 3) — the Control Room trend strip's one read. The
 * `energy-view.ts` shape: `withAuth`, `clearSessionOnAuthFailure` on a non-OK status, a plain
 * thrown `Error` naming the route and status, and the body checked against the contract.
 */

export interface TrendStripRequest {
  readonly range: TrendStripRange;
  /** The tab's asset group; `null` is the whole site and sends no key. */
  readonly assetGroupId: string | null;
}

/** The search of one strip request; the whole site (`assetGroupId: null`) sends no group key. */
export function trendStripSearch({ range, assetGroupId }: TrendStripRequest): URLSearchParams {
  const params = new URLSearchParams({ range });
  if (assetGroupId !== null) {
    params.append("assetGroupId", assetGroupId);
  }
  return params;
}

/** GET /api/v1/control-room/sites/:locationId/trend-strip */
export async function fetchSiteTrendStrip(
  locationId: string,
  request: TrendStripRequest,
): Promise<SiteTrendStripDto> {
  const params = trendStripSearch(request);
  const sent = withAuth();
  const res = await fetch(
    `${base}/api/v1/control-room/sites/${encodeURIComponent(locationId)}/trend-strip?${params}`,
    sent,
  );
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new Error(`control-room/sites/:id/trend-strip ${res.status}`);
  }
  return checkResponse(siteTrendStripSchema, await res.json(), "control-room/sites/:id/trend-strip");
}
