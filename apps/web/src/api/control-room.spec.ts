import { expect, vi } from "vitest";

import { useAuthStore } from "../stores/auth-store";
import { ApiError } from "../lib/api-error";
import { fetchResolvedSiteControlRoomView, makeSiteLayout } from "./control-room";

/**
 * `F3.66` U2 — what the resolve-read client puts on the wire, and how it
 * fails. Same shape as `system-status.spec.ts`: the URL and body `fetch`
 * receives/returns are the only observable surface.
 *
 * `node` environment, like `system-status.spec.ts` — this module renders
 * nothing.
 */

const LOCATION_ID = "11111111-1111-4111-8111-111111111111";

/** The base the client prepends — read the same way the client reads it. */
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

const VALID_BODY = {
  locationId: LOCATION_ID,
  kind: "generated",
  dashboardId: null,
  dashboardSlug: null,
  builtinKey: null,
  notice: null,
};

/**
 * Captures the URL and init of the single request the call makes and
 * answers with `status`/`body`. Per-call closure state, never a lifetime
 * counter (§4.6).
 */
function stubFetch(status: number, body: unknown): () => { url: string; init: RequestInit } {
  let seen: { url: string; init: RequestInit } = { url: "", init: {} };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify(body), { status });
  });
  return () => seen;
}

/**
 * A1 — the read goes to `/api/v1/control-room/sites/:locationId/view` and
 * carries the bearer token `withAuth()` attaches.
 */
export async function fetchResolvedSiteControlRoomViewHitsTheResolvePath(): Promise<void> {
  useAuthStore.getState().setSession(
    "token-xyz",
    { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "organization_admin" },
    { kind: "location", locations: [], assetGroups: [], assetIds: [] },
    null,
  );
  try {
    const seen = stubFetch(200, VALID_BODY);
    await fetchResolvedSiteControlRoomView(LOCATION_ID);
    const url = new URL(seen().url);
    expect(`${url.origin}${url.pathname}`).toBe(
      `${BASE}/api/v1/control-room/sites/${LOCATION_ID}/view`,
    );
    const headers = new Headers(seen().init.headers);
    expect(headers.get("Authorization")).toBe("Bearer token-xyz");
  } finally {
    useAuthStore.getState().clearSession();
  }
}

/** A2 — a 404 (off-scope site) throws, with the status in the message. */
export async function fetchResolvedSiteControlRoomViewThrowsOn404(): Promise<void> {
  stubFetch(404, { message: "not found" });
  await expect(fetchResolvedSiteControlRoomView(LOCATION_ID)).rejects.toThrow(/404/);
}

/** A3 — a body that fails `resolvedSiteControlRoomViewDtoSchema` throws too. */
export async function fetchResolvedSiteControlRoomViewThrowsOnSchemaMismatch(): Promise<void> {
  stubFetch(200, { locationId: LOCATION_ID });
  await expect(fetchResolvedSiteControlRoomView(LOCATION_ID)).rejects.toThrow();
}

const DASHBOARD_ID = "22222222-2222-4222-8222-222222222222";
const GROUP_A = "33333333-3333-4333-8333-333333333333";
const GROUP_B = "44444444-4444-4444-8444-444444444444";

const MADE_BODY = {
  locationId: LOCATION_ID,
  dashboardId: DASHBOARD_ID,
  dashboardSlug: "site-layout-lotapata",
  omittedTabs: [],
  droppedCards: [],
  resolution: [],
};

const AMBIGUOUS_BODY = {
  statusCode: 409,
  error: "Conflict",
  message: "More than one asset group at this site fits a tab; choose one per tab in tabGroups",
  ambiguous: [
    {
      tabKey: "sld",
      domain: "electrical",
      candidates: [
        { id: GROUP_A, code: "incomer-a", name: "Incomer A" },
        { id: GROUP_B, code: "incomer-b", name: "Incomer B" },
      ],
    },
  ],
};

/**
 * A4 — `F3.73` plan Task 5.1: "Make site layout" POSTs its body as JSON to
 * `/api/v1/admin/locations/:id/site-layout` and answers `made` with the checked result.
 */
export async function makeSiteLayoutPostsTheBody(): Promise<void> {
  const seen = stubFetch(201, MADE_BODY);
  const answer = await makeSiteLayout(LOCATION_ID, { tabGroups: { sld: GROUP_B } });
  const url = new URL(seen().url);
  expect(`${url.origin}${url.pathname}`).toBe(`${BASE}/api/v1/admin/locations/${LOCATION_ID}/site-layout`);
  expect(seen().init.method).toBe("POST");
  expect(new Headers(seen().init.headers).get("Content-Type")).toBe("application/json");
  expect(JSON.parse(String(seen().init.body))).toEqual({ tabGroups: { sld: GROUP_B } });
  expect(answer).toEqual({ kind: "made", result: MADE_BODY });
}

/** A5 — a 409 whose body lists `ambiguous` answers the candidates from that body (no second read). */
export async function makeSiteLayoutReadsTheAmbiguousBody(): Promise<void> {
  stubFetch(409, AMBIGUOUS_BODY);
  const answer = await makeSiteLayout(LOCATION_ID, {});
  expect(answer).toEqual({ kind: "ambiguous", ambiguous: AMBIGUOUS_BODY.ambiguous });
}

/** A6 — any other 409 (the site already has a view) throws `ApiError` carrying the status. */
export async function makeSiteLayoutThrowsOnAnotherConflict(): Promise<void> {
  stubFetch(409, { statusCode: 409, error: "Conflict", message: "This site already has a Control Room view" });
  const error = await makeSiteLayout(LOCATION_ID, {}).then(
    () => null,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect([(error as ApiError).status, (error as ApiError).message]).toEqual([
    409,
    JSON.stringify({ statusCode: 409, error: "Conflict", message: "This site already has a Control Room view" }),
  ]);
}
