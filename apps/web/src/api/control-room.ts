import type {
  OrganizationControlRoomViewDto,
  OrganizationLayoutResultDto,
  ResolvedSiteControlRoomViewDto,
  SiteLayoutAmbiguousDto,
  SiteLayoutBody,
  SiteLayoutResultDto,
} from "@bms/shared";
import {
  organizationControlRoomViewDtoSchema,
  organizationLayoutResultDtoSchema,
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
export async function makeSiteLayout(locationId: string, body: SiteLayoutBody): Promise<MakeSiteLayoutAnswer> {
  const sent = withAuth({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await fetch(
    `${base}/api/v1/admin/locations/${encodeURIComponent(locationId)}/site-layout`,
    sent,
  );
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
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

/**
 * `F3.86` PR 2 — the ambiguous tabs a refused request carries: a 409 `ApiError` whose body is the
 * ambiguous answer, else `null`. Here, in `api/`, so a render site never reads an error's raw
 * message (`tests/f4.204-raw-error-message-render`).
 */
export function ambiguousTabsOfError(err: unknown): SiteLayoutAmbiguousDto["ambiguous"] | null {
  return err instanceof ApiError && err.status === 409 ? ambiguousTabsOf(err.message) : null;
}

/**
 * The 409 body's ambiguous tabs, or null when the body is not the ambiguous answer. Exported
 * since `F3.86` PR 2: the copilot's Confirm card reads the same body after a confirmed
 * site-layout change answers 409.
 */
export function ambiguousTabsOf(text: string): SiteLayoutAmbiguousDto["ambiguous"] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const result = siteLayoutAmbiguousDtoSchema.safeParse(parsed);
  return result.success && result.data.ambiguous.length > 0 ? result.data.ambiguous : null;
}

/**
 * `F4.317` task 5.1 (ADR 0112 decisions 3 to 5) — `GET /api/v1/control-room/organizations/
 * :organizationId/view`, the organization strip's read: the stock template's content, or the
 * organization's own layout, every tile resolved over the caller's readable assets. A 404 (an
 * organization the caller cannot read) throws `ApiError` with the status.
 */
export async function fetchOrganizationControlRoomView(
  organizationId: string,
): Promise<OrganizationControlRoomViewDto> {
  const sent = withAuth();
  const res = await fetch(
    `${base}/api/v1/control-room/organizations/${encodeURIComponent(organizationId)}/view`,
    sent,
  );
  if (!res.ok) {
    throw new ApiError((await res.text()) || `control-room/organizations/:id/view ${res.status}`, res.status);
  }
  return checkResponse(
    organizationControlRoomViewDtoSchema,
    await res.json(),
    "control-room/organizations/:id/view",
  );
}

/**
 * "Make organization layout" — `PUT …/view` with an empty body (the newest published
 * `organization` template). Every refusal, the 409 "Reset to default first" included, throws
 * `ApiError` carrying the whole body for `apiErrorMessage`. A 401 clears the session.
 */
export async function makeOrganizationLayout(organizationId: string): Promise<OrganizationLayoutResultDto> {
  const sent = withAuth({
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const res = await fetch(
    `${base}/api/v1/control-room/organizations/${encodeURIComponent(organizationId)}/view`,
    sent,
  );
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new ApiError((await res.text()) || `control-room/organizations/:id/view ${res.status}`, res.status);
  }
  return checkResponse(
    organizationLayoutResultDtoSchema,
    await res.json(),
    "control-room/organizations/:id/view",
  );
}

/** "Reset to default" — `DELETE …/view` (204); the copy stays, only the pointer row goes. */
export async function resetOrganizationLayout(organizationId: string): Promise<void> {
  const sent = withAuth({ method: "DELETE" });
  const res = await fetch(
    `${base}/api/v1/control-room/organizations/${encodeURIComponent(organizationId)}/view`,
    sent,
  );
  if (!res.ok) {
    clearSessionOnAuthFailure(res, sent);
    throw new ApiError((await res.text()) || `control-room/organizations/:id/view ${res.status}`, res.status);
  }
}
