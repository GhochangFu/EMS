import { expect, vi } from "vitest";

import { useAuthStore } from "../stores/auth-store";
import { fetchGeneratedSiteView } from "./generated-site-view";

/**
 * `F3.68` U6 — what the generated-site-view client sends and how it fails.
 * Same shape as `system-status.spec.ts`: the URL and headers `fetch` receives
 * are the observable surface, parsed rather than compared whole.
 *
 * `node` environment — this module renders nothing.
 */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const LOCATION_ID = "22222222-2222-4222-8222-222222222222";

const VALID_BODY = {
  locationId: LOCATION_ID,
  asOf: "2026-09-26T10:00:00.000Z",
  domains: [],
};

/** Captures the one request and answers with `status`/`body`. Per-call state. */
function stubFetch(status: number, body: unknown): () => { url: string; init: RequestInit } {
  let seen: { url: string; init: RequestInit } = { url: "", init: {} };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify(body), { status });
  });
  return () => seen;
}

/** A1a — the read goes to `/api/v1/control-room/sites/:locationId/generated`. */
export async function hitsTheGeneratedPath(): Promise<void> {
  const seen = stubFetch(200, VALID_BODY);
  await fetchGeneratedSiteView(LOCATION_ID);
  const url = new URL(seen().url);
  expect(`${url.origin}${url.pathname}`).toBe(
    `${BASE}/api/v1/control-room/sites/${LOCATION_ID}/generated`,
  );
}

/** A1b — the read carries the bearer token `withAuth()` attaches. */
export async function sendsTheBearerToken(): Promise<void> {
  useAuthStore.getState().setSession(
    "token-gsv",
    { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "organization_admin" },
    { kind: "global", locations: [], assetGroups: [], assetIds: [] },
    null,
  );
  try {
    const seen = stubFetch(200, VALID_BODY);
    await fetchGeneratedSiteView(LOCATION_ID);
    expect(new Headers(seen().init.headers).get("Authorization")).toBe("Bearer token-gsv");
  } finally {
    useAuthStore.getState().clearSession();
  }
}

/** A2 — a non-2xx throws, and the message carries the status. */
export async function throwsWithTheStatusOnNon2xx(): Promise<void> {
  stubFetch(404, { message: "Location not found or outside your access scope" });
  await expect(fetchGeneratedSiteView(LOCATION_ID)).rejects.toThrow(/404/);
}

/** A3 — an off-shape body throws (`checkResponse` throws on drift under vitest). */
export async function throwsOnAnOffShapeBody(): Promise<void> {
  stubFetch(200, { locationId: LOCATION_ID, asOf: VALID_BODY.asOf });
  await expect(fetchGeneratedSiteView(LOCATION_ID)).rejects.toThrow();
}

/** A3 positive control — the valid body resolves to itself. */
export async function resolvesAValidBody(): Promise<void> {
  stubFetch(200, VALID_BODY);
  await expect(fetchGeneratedSiteView(LOCATION_ID)).resolves.toEqual(VALID_BODY);
}
