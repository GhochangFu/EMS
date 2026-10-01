import type { ResolvedSiteControlRoomViewDto, SiteLayoutAmbiguousDto, SiteLayoutResultDto } from "@bms/shared";
import {
  resolvedSiteControlRoomViewDtoSchema,
  siteLayoutAmbiguousDtoSchema,
  siteLayoutResultDtoSchema,
} from "@bms/shared/contracts";

import { ApiError } from "../lib/api-error";
import { clearSessionOnAuthFailure, withAuth } from "./http";
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

/** The body of `POST /admin/locations/:id/site-layout` (`siteLayoutBodySchema`, `site-layout.schema.ts`). */
export type MakeSiteLayoutBody = {
  /** Template tab key → asset group id, for the tabs the last answer called ambiguous. */
  tabGroups?: Record<string, string>;
};

/**
 * What "Make site layout" answers: the copy, or the tabs an administrator must choose a group for.
 * The ambiguous arm is a value, not a throw — it is the one 409 the caller acts on rather than
 * shows.
 */
export type MakeSiteLayoutAnswer =
  | { kind: "made"; result: SiteLayoutResultDto }
  | { kind: "ambiguous"; ambiguous: SiteLayoutAmbiguousDto["ambiguous"] };

/**
 * `F3.73` plan D6/D10 (ruling Q4) — `POST /api/v1/admin/locations/:locationId/site-layout`, the
 * notice's **Make site layout** action: copy the organization's newest published site template
 * onto the site and point its Control Room view at the copy.
 *
 * A 409 whose body passes `siteLayoutAmbiguousDtoSchema` with at least one tab answers
 * `ambiguous` with the candidates **from that body**, so the picker needs no second read. Every
 * other refusal — the other 409s (the site already has a view, no published site template, the
 * slug is taken, no assets), a 400, a 403 — throws `ApiError` carrying the whole body, which
 * `apiErrorMessage` turns into the API's sentence (the `adminFetch` rule). A 401 clears the
 * session, as `adminFetch` does.
 */
export async function makeSiteLayout(locationId: string, body: MakeSiteLayoutBody): Promise<MakeSiteLayoutAnswer> {
  const res = await fetch(
    `${base}/api/v1/admin/locations/${encodeURIComponent(locationId)}/site-layout`,
    withAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  if (!res.ok) {
    clearSessionOnAuthFailure(res);
    const text = await res.text();
    if (res.status === 409) {
      const ambiguous = ambiguousTabsOf(text);
      if (ambiguous !== null) {
        return { kind: "ambiguous", ambiguous };
      }
    }
    throw new ApiError(text || `admin /admin/locations/:id/site-layout ${res.status}`, res.status);
  }
  return {
    kind: "made",
    result: checkResponse(siteLayoutResultDtoSchema, await res.json(), "admin /admin/locations/:id/site-layout"),
  };
}

/** The 409 body's ambiguous tabs, or null when the body is not the ambiguous answer. */
function ambiguousTabsOf(text: string): SiteLayoutAmbiguousDto["ambiguous"] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = siteLayoutAmbiguousDtoSchema.safeParse(parsed);
  return result.success && result.data.ambiguous.length > 0 ? result.data.ambiguous : null;
}
