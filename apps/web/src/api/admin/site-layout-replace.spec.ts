import { expect, vi } from "vitest";

import { ApiError } from "../../lib/api-error";
import {
  fetchSiteLayoutReplacePreview,
  fetchSiteLayoutsReplacePreview,
  replaceSiteLayout,
  replaceSiteLayouts,
} from "./site-layout-replace";

/**
 * `F4.320` PR 2 — what the four Replace clients put on the wire, and how a refusal reads. The URL,
 * the init and the answer `fetch` returns are the only observable surface (`control-room.spec.ts`).
 * `node` environment: the module renders nothing.
 */

const LOCATION_ID = "11111111-1111-4111-8111-111111111111";
const TEMPLATE_ID = "55555555-5555-4555-8555-555555555555";
const OLD_TEMPLATE_ID = "66666666-6666-4666-8666-666666666666";
const DASHBOARD_ID = "22222222-2222-4222-8222-222222222222";
const OLD_DASHBOARD_ID = "77777777-7777-4777-8777-777777777777";
const GROUP_B = "44444444-4444-4444-8444-444444444444";
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export const REPLACED_BODY = {
  locationId: LOCATION_ID,
  dashboardId: DASHBOARD_ID,
  dashboardSlug: "site-layout-lotapata",
  omittedTabs: [],
  droppedCards: [],
  omittedTiles: [],
  resolution: [],
  templateId: TEMPLATE_ID,
  version: 2,
  previousDashboardId: OLD_DASHBOARD_ID,
  previousTemplateId: OLD_TEMPLATE_ID,
  previousVersion: 1,
};

const PREVIEW_BODY = {
  templateId: TEMPLATE_ID,
  templateCode: "pump-station-standard",
  version: 2,
  sites: [
    {
      locationId: LOCATION_ID,
      locationName: "Lotapata",
      held: { dashboardId: OLD_DASHBOARD_ID, templateId: OLD_TEMPLATE_ID, templateCode: "pump-station-standard", version: 1 },
      outcome: "replace",
      edits: { count: 3, lastEditedAt: "2026-11-06T10:00:00.000Z", lastEditedBy: "phe-admin@bms.local" },
    },
  ],
};

/** The one request the call makes, answered with `status`/`body`; per-call state, never a lifetime counter. */
function stubFetch(status: number, body: unknown): () => { url: string; init: RequestInit } {
  let seen: { url: string; init: RequestInit } = { url: "", init: {} };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify(body), { status });
  });
  return () => seen;
}

const pathOf = (url: string): string => {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
};

/** R1 — Replace POSTs its body as JSON to `…/site-layout/replace`, with no copilot header, and answers `replaced`. */
export async function replacePostsTheBody(): Promise<void> {
  const seen = stubFetch(201, REPLACED_BODY);
  const answer = await replaceSiteLayout(LOCATION_ID, { tabGroups: { sld: GROUP_B } });
  expect(pathOf(seen().url)).toBe(`${BASE}/api/v1/admin/locations/${LOCATION_ID}/site-layout/replace`);
  expect(seen().init.method).toBe("POST");
  expect(new Headers(seen().init.headers).get("Content-Type")).toBe("application/json");
  expect(new Headers(seen().init.headers).get("X-Copilot-Change")).toBeNull();
  expect(JSON.parse(String(seen().init.body))).toEqual({ tabGroups: { sld: GROUP_B } });
  expect(answer).toEqual({ kind: "replaced", result: REPLACED_BODY });
}

/** R2 — a 409 with the ambiguous body answers its candidates; another 409 throws `ApiError` with the body. */
export async function replaceReadsTheAmbiguousBodyAndThrowsOtherwise(): Promise<void> {
  const ambiguous = [
    { tabKey: "sld", domain: "electrical", candidates: [{ id: GROUP_B, code: "incomer-b", name: "Incomer B" }] },
  ];
  stubFetch(409, { statusCode: 409, error: "Conflict", message: "choose", ambiguous });
  expect(await replaceSiteLayout(LOCATION_ID, {})).toEqual({ kind: "ambiguous", ambiguous });

  const refusal = {
    statusCode: 409,
    error: "Conflict",
    message: "This site holds no site-template copy to replace; use Make site layout, or change the Control Room view",
  };
  stubFetch(409, refusal);
  const error = await replaceSiteLayout(LOCATION_ID, {}).then(
    () => null,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect([(error as ApiError).status, (error as ApiError).message]).toEqual([409, JSON.stringify(refusal)]);
}

/** R3 — the bulk Replace POSTs to `…/replace-site-layouts` with no body and checks the answer. */
export async function bulkReplacePostsWithNoBody(): Promise<void> {
  const answer = {
    replaced: [REPLACED_BODY],
    skipped: [{ locationId: OLD_DASHBOARD_ID, reason: "same_version" }],
  };
  const seen = stubFetch(201, answer);
  expect(await replaceSiteLayouts(TEMPLATE_ID)).toEqual(answer);
  expect(pathOf(seen().url)).toBe(`${BASE}/api/v1/admin/dashboard-templates/${TEMPLATE_ID}/replace-site-layouts`);
  expect(seen().init.method).toBe("POST");
  expect(seen().init.body).toBeUndefined();
}

/** R4 — the two preview reads GET their paths and pass the answer through the shared schema. */
export async function previewsGetTheirPaths(): Promise<void> {
  let seen = stubFetch(200, PREVIEW_BODY);
  expect(await fetchSiteLayoutReplacePreview(LOCATION_ID)).toEqual(PREVIEW_BODY);
  expect(pathOf(seen().url)).toBe(`${BASE}/api/v1/admin/locations/${LOCATION_ID}/site-layout/replace-preview`);
  expect(seen().init.method ?? "GET").toBe("GET");

  seen = stubFetch(200, PREVIEW_BODY);
  expect(await fetchSiteLayoutsReplacePreview(TEMPLATE_ID)).toEqual(PREVIEW_BODY);
  expect(pathOf(seen().url)).toBe(
    `${BASE}/api/v1/admin/dashboard-templates/${TEMPLATE_ID}/replace-site-layouts/preview`,
  );
}

/** R5 — a preview answer that breaks the contract (an unknown outcome) is refused, not passed on. */
export async function aPreviewOffContractIsRefused(): Promise<void> {
  stubFetch(200, { ...PREVIEW_BODY, sites: [{ ...PREVIEW_BODY.sites[0], outcome: "ambiguous" }] });
  const error = await fetchSiteLayoutReplacePreview(LOCATION_ID).then(
    () => null,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(Error);
}
