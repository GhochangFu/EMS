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
    null,
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

/**
 * Replaces `AbortSignal.timeout` with a signal Vitest's fake timers drive.
 * The native one runs on Node's internal timer, which `vi.useFakeTimers()`
 * does not reach (probed 2026-09-25: 10 001 ms of fake time left it
 * unaborted), so without this a 10 s claim would need 10 s of wall clock.
 * Call after `vi.useFakeTimers()`.
 */
export function stubAbortSignalTimeout(): void {
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("signal timed out", "TimeoutError")), ms);
    return controller.signal;
  });
}

/**
 * The request carries an abort signal that fires at `SYSTEM_STATUS_TIMEOUT_MS`
 * (10 s) — not before, and not never. A hung API must end the request so the
 * query can fail and the footer can say so (code review, Correctness 1).
 */
export async function fetchSystemStatusAbortsAfterTenSeconds(): Promise<void> {
  vi.useFakeTimers();
  stubAbortSignalTimeout();
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
    signal = init.signal;
    return new Promise<Response>(() => undefined);
  });
  void fetchSystemStatus();
  expect(signal, "the request carries no abort signal").toBeInstanceOf(AbortSignal);
  await vi.advanceTimersByTimeAsync(9_999);
  expect(signal?.aborted, "the signal fired before 10 s").toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(signal?.aborted, "the signal had not fired at 10 s").toBe(true);
}

/**
 * The query's own signal still reaches the request: aborting it (TanStack
 * Query cancelling the read) aborts the request with no timer advanced.
 */
export async function fetchSystemStatusForwardsTheQuerySignal(): Promise<void> {
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
    signal = init.signal;
    return new Promise<Response>(() => undefined);
  });
  const query = new AbortController();
  void fetchSystemStatus(query.signal);
  expect(signal?.aborted, "control: the request signal starts unaborted").toBe(false);
  query.abort();
  expect(signal?.aborted, "aborting the query signal did not abort the request").toBe(true);
}

/** A 401 clears the stale session, as every other read in `api/` does. */
export async function fetchSystemStatusClearsTheSessionOn401(): Promise<void> {
  useAuthStore.getState().setSession(
    "token-401",
    { id: "u1", email: "admin@bms.local", displayName: "Admin", role: "organization_admin" },
    { kind: "location", locations: [], assetGroups: [], assetIds: [] },
    null,
  );
  try {
    expect(useAuthStore.getState().accessToken, "control: the session is set").toBe("token-401");
    stubFetch(401, { message: "Unauthorized" });
    await expect(fetchSystemStatus()).rejects.toThrow();
    expect(useAuthStore.getState().accessToken).toBeNull();
  } finally {
    useAuthStore.getState().clearSession();
  }
}
