import { expect, vi } from "vitest";

import { useAuthStore } from "../stores/auth-store";
import { fetchSystemStatus } from "./system-status";

/**
 * `F3.30` (ADR 0075 decision 5) — what the status client sends on the wire
 * and how it fails. Same shape as `assets.spec.ts`: the URL and headers
 * `fetch` receives are the only observable surface, parsed rather than
 * compared whole so a mutation to one part reddens only the claim about
 * that part.
 *
 * `node` environment, like `assets.spec.ts` — this module renders nothing.
 */

/** The base the client prepends — read the same way the client reads it. */
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

const VALID_BODY = {
  status: "operational",
  components: [
    { key: "queue", state: "ok" },
    { key: "storage", state: "not_configured" },
    { key: "field_data", state: "ok" },
  ],
  dataQuality: { percent: 100, freshAssets: 2, streamingAssets: 2, windowSeconds: 25 },
  checkedAt: "2026-09-25T00:00:00.000Z",
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

/** The read goes to `/api/v1/system/status`. */
export async function fetchSystemStatusHitsTheStatusPath(): Promise<void> {
  const seen = stubFetch(200, VALID_BODY);
  await fetchSystemStatus();
  const url = new URL(seen().url);
  expect(`${url.origin}${url.pathname}`).toBe(`${BASE}/api/v1/system/status`);
}

/** The read carries the bearer token `withAuth()` attaches from the session. */
export async function fetchSystemStatusSendsTheBearerToken(): Promise<void> {
  useAuthStore.getState().setSession(
    "token-xyz",
    { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "organization_admin" },
    { kind: "location", locations: [], assetGroups: [], assetIds: [] },
  );
  try {
    const seen = stubFetch(200, VALID_BODY);
    await fetchSystemStatus();
    const headers = new Headers(seen().init.headers);
    expect(headers.get("Authorization")).toBe("Bearer token-xyz");
  } finally {
    useAuthStore.getState().clearSession();
  }
}

/** A non-2xx response throws rather than returning a body. */
export async function fetchSystemStatusThrowsOnNon2xx(): Promise<void> {
  stubFetch(500, { message: "boom" });
  await expect(fetchSystemStatus()).rejects.toThrow();
}

/**
 * A body that fails `systemStatusResponseSchema` throws too — under vitest
 * `checkResponse` throws on drift rather than logging and passing
 * (`api/validate.ts`'s `shouldThrowOnDrift`).
 */
export async function fetchSystemStatusThrowsOnSchemaMismatch(): Promise<void> {
  stubFetch(200, { status: "operational" });
  await expect(fetchSystemStatus()).rejects.toThrow();
}
