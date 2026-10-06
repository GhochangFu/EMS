import { vi } from "vitest";

import { fetchCurrentUser } from "./login";
import { useAuthStore } from "../stores/auth-store";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** A session shaped like the one `POST /auth/login` writes, for `token` and `email`. */
function signInAs(token: string, email: string): void {
  useAuthStore.getState().setSession(
    token,
    { id: `id-${token}`, email, displayName: email, role: "location_admin" },
    { kind: "location", locations: [], assetGroups: [], assetIds: [] },
    null,
  );
}

const DEACTIVATED_BODY = {
  statusCode: 401,
  message: "This account is deactivated",
  error: "Unauthorized",
  code: "account_deactivated",
};

function json401(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

/** Lets an async body read settle; long enough that a wrong write lands first. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

function reason(): string | null {
  return useAuthStore.getState().authFailureReason;
}

/** Every `/me` answers a deactivated 401; returns the stub so a case can read its calls. */
function stubDeactivatedMe(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() => Promise.resolve(json401(DEACTIVATED_BODY)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Awaits `fetchCurrentUser(token)` and asserts it took the 401 branch. */
async function expectMe401(token: string): Promise<void> {
  let message: string | null = null;
  try {
    await fetchCurrentUser(token);
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  assert(
    message === "Current user failed (401)",
    `expected /me to reject with the 401 message, got ${String(message)}`,
  );
}

/**
 * `F4.214` M1 — a `/me` sent with an old token that answers 401 after a newer
 * session holds the store records no reason, and leaves the new session.
 */
export async function runALateMe401ForAnOldTokenRecordsNothing(): Promise<void> {
  stubDeactivatedMe();
  signInAs("token-new", "second@bms.local");

  await expectMe401("token-old");
  await settle();

  assert(
    reason() === null,
    `a late /me 401 for an old token must record no reason, got ${String(reason())}`,
  );
  assert(
    useAuthStore.getState().accessToken === "token-new",
    "a late /me 401 for an old token must leave the new session",
  );
}

/**
 * `F4.214` M2 control — the OIDC callback and local login run `/me` before
 * `setSession`, so an empty store still records the reason.
 */
export async function runAMe401WithAnEmptyStoreRecordsTheReason(): Promise<void> {
  stubDeactivatedMe();
  assert(useAuthStore.getState().accessToken === null, "the store must start empty");

  await expectMe401("token-fresh");

  await vi.waitFor(() => {
    assert(
      reason() === "account_deactivated",
      `a /me 401 with an empty store must record the reason, got ${String(reason())}`,
    );
  });
}

/** `F4.214` M3 control — the reload path: a `/me` 401 for the current token records. */
export async function runAMe401ForTheCurrentTokenRecordsTheReason(): Promise<void> {
  stubDeactivatedMe();
  signInAs("token-a", "wc-admin@bms.local");

  await expectMe401("token-a");

  await vi.waitFor(() => {
    assert(
      reason() === "account_deactivated",
      `a /me 401 for the current token must record the reason, got ${String(reason())}`,
    );
  });
}

/**
 * `F4.214` M4 — `/me` carries the token it was given, not the store's, so the
 * token the guard compares is the one the request was sent with.
 */
export async function runTheRequestCarriesTheTokenItWasGiven(): Promise<void> {
  const fetchMock = stubDeactivatedMe();
  signInAs("token-new", "second@bms.local");

  await expectMe401("token-old");

  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  const auth = new Headers(init?.headers).get("Authorization");
  assert(
    auth === "Bearer token-old",
    `/me must carry the token it was given, got ${String(auth)}`,
  );
}
