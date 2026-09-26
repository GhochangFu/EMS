import { expect, vi } from "vitest";

import { useAuthStore } from "../stores/auth-store";
import { fetchResolvedSiteControlRoomView } from "./control-room";

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
