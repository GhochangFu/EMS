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
 * in its message only — `U4` shows the "not available in your access scope"
 * card for every rejection (plan D6) and does not branch on the status.
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
