/**
 * `F4.320` PR 2 (ADR 0087 Amendment 4) — the four Replace clients: the per-site write and its
 * preview (`location.siteLayout.replace`), and the bulk write and its preview
 * (`dashboardTemplate.replaceSiteLayouts`). Every answer is checked against its shared schema
 * (ADR 0030); no call site casts a response.
 *
 * The per-site write is a plain `fetch`, as `makeSiteLayout` (`../control-room.ts`) is: a 409
 * whose body is the ambiguous answer is a value the wizard acts on (it re-opens Groups with the
 * body's candidates), not a throw. Every other refusal throws `ApiError` with the whole body for
 * `apiErrorMessage`, and a 401 clears the session.
 */
import type {
  SiteLayoutAmbiguousDto,
  SiteLayoutBody,
  SiteLayoutBulkReplaceResultDto,
  SiteLayoutReplacePreviewDto,
  SiteLayoutReplaceResultDto,
} from "@bms/shared";
import {
  siteLayoutBulkReplaceResultDtoSchema,
  siteLayoutReplacePreviewDtoSchema,
  siteLayoutReplaceResultDtoSchema,
} from "@bms/shared/contracts";

import { ApiError } from "../../lib/api-error";
import { ambiguousTabsOf } from "../control-room";
import { clearSessionOnAuthFailure, withAuth } from "../http";
import { checkResponse } from "../validate";
import { adminFetch } from "./client";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * The per-site preview's key. It sits under the site page's resolve read
 * (`["control-room", "site-view", locationId]`), so every invalidation of that read — the
 * wizard's Close, the copilot's `SITE_VIEW` row, `Try again` — reads the preview again.
 */
export function siteLayoutReplacePreviewKey(locationId: string): readonly unknown[] {
  return ["control-room", "site-view", locationId, "replace-preview"];
}

/**
 * The bulk preview's key, under the template detail page's read
 * (`["admin", "dashboard-template", templateId]`), so the copilot's `TEMPLATE` row reaches it.
 */
export function siteLayoutsReplacePreviewKey(templateId: string): readonly unknown[] {
  return ["admin", "dashboard-template", templateId, "replace-preview"];
}

/** What "Replace with this version" answers: the rebuilt copy, or the tabs that need a group. */
export type ReplaceSiteLayoutAnswer =
  | { kind: "replaced"; result: SiteLayoutReplaceResultDto }
  | { kind: "ambiguous"; ambiguous: SiteLayoutAmbiguousDto["ambiguous"] };

/**
 * `POST /api/v1/admin/locations/:id/site-layout/replace` — delete the site's template copy and
 * make it again (decision 3). With no `templateId` the API takes the newest published version
 * of the copy's own template code.
 */
export async function replaceSiteLayout(locationId: string, body: SiteLayoutBody): Promise<ReplaceSiteLayoutAnswer> {
  const sent = withAuth({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await fetch(
    `${base}/api/v1/admin/locations/${encodeURIComponent(locationId)}/site-layout/replace`,
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
    throw new ApiError(text || `admin /admin/locations/:id/site-layout/replace ${res.status}`, res.status);
  }
  return {
    kind: "replaced",
    result: checkResponse(siteLayoutReplaceResultDtoSchema, await res.json(), "admin /admin/locations/:id/site-layout/replace"),
  };
}

/** `GET /api/v1/admin/locations/:id/site-layout/replace-preview` — the confirm step's read (decision 9). */
export async function fetchSiteLayoutReplacePreview(locationId: string): Promise<SiteLayoutReplacePreviewDto> {
  return adminFetch(
    `/admin/locations/${encodeURIComponent(locationId)}/site-layout/replace-preview`,
    siteLayoutReplacePreviewDtoSchema,
  );
}

/** `POST /api/v1/admin/dashboard-templates/:id/replace-site-layouts` — the bulk Replace, no body. */
export async function replaceSiteLayouts(templateId: string): Promise<SiteLayoutBulkReplaceResultDto> {
  return adminFetch(
    `/admin/dashboard-templates/${encodeURIComponent(templateId)}/replace-site-layouts`,
    siteLayoutBulkReplaceResultDtoSchema,
    { method: "POST" },
  );
}

/** `GET /api/v1/admin/dashboard-templates/:id/replace-site-layouts/preview` — every site, before the confirm. */
export async function fetchSiteLayoutsReplacePreview(templateId: string): Promise<SiteLayoutReplacePreviewDto> {
  return adminFetch(
    `/admin/dashboard-templates/${encodeURIComponent(templateId)}/replace-site-layouts/preview`,
    siteLayoutReplacePreviewDtoSchema,
  );
}
