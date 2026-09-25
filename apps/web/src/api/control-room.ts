import type { ResolvedSiteControlRoomViewDto } from "@bms/shared";
import { resolvedSiteControlRoomViewDtoSchema } from "@bms/shared/contracts";

import { withAuth } from "./http";
import { checkResponse } from "./validate";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * `F3.67` / `F3.66` U2 — `GET /api/v1/control-room/sites/:locationId/view`,
 * the site Control Room view's fail-safe resolve read. Same `fetch` +
 * `withAuth` + `checkResponse` shape as `fetchLocationKpis` in
 * `./locations.ts`: no `clearSessionOnAuthFailure`, because none of the
 * other read clients in this directory that share that shape call it either
 * — `ControlRoomScopeRoute` (D3) and `ControlRoomSitePage` (U4) are what
 * react to the rejection, not a forced logout.
 *
 * The API answers 404 for a site outside the caller's readable scope
 * (`site-control-room-view.service.ts`); the throw below carries that status
 * so `U4`'s "not available in your access scope" card can tell it apart from
 * any other failure.
 */
export async function fetchResolvedSiteControlRoomView(
  locationId: string,
): Promise<ResolvedSiteControlRoomViewDto> {
  const res = await fetch(
    `${base}/api/v1/control-room/sites/${encodeURIComponent(locationId)}/view`,
    withAuth(),
  );
  if (!res.ok) {
    throw new Error(`control-room/site-view ${res.status}`);
  }
  return checkResponse(
    resolvedSiteControlRoomViewDtoSchema,
    await res.json(),
    "control-room/sites/:id/view",
  );
}
