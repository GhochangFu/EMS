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
  /** `F4.306` (ADR 0108 Amendment 7): the segment codes the strip draws; absent is every segment. */
  readonly segments?: readonly string[];
  /** `F4.306`: the `<segment>:<point code>` entries the strip draws; absent is each segment's default. */
  readonly points?: readonly string[];
}

/**
 * The search of one strip request; the whole site (`assetGroupId: null`) sends no group key. A
 * selection list goes comma-joined, and only when it holds an entry: the route refuses an empty
 * one (`.min(1)`), and no selection is exactly the `F4.305` bytes.
 */
export function trendStripSearch({ range, assetGroupId, segments, points }: TrendStripRequest): URLSearchParams {
  const params = new URLSearchParams({ range });
  if (assetGroupId !== null) {
    params.append("assetGroupId", assetGroupId);
  }
  if (segments !== undefined && segments.length > 0) {
    params.append("segments", segments.join(","));
  }
  if (points !== undefined && points.length > 0) {
    params.append("points", points.join(","));
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
