import { vi } from "vitest";

import { fetchCurrentUser, refreshScope } from "./login";
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

/** A `fetch` stub whose one response the case releases by hand, after the send. */
function stubDeferredFetch(): {
  sent: Promise<void>;
  answer: (res: Response) => void;
} {
  let answer: (res: Response) => void = () => undefined;
  let markSent: () => void = () => undefined;
  const sent = new Promise<void>((resolve) => {
    markSent = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
          markSent();
        }),
    ),
  );
  return { sent, answer: (res) => answer(res) };
}

/**
 * `F4.214` M1 — the store changes MID-REQUEST: `/me` is sent while the store
 * holds the old token, a newer sign-in lands before the 401 answers, and the
 * late 401 records no reason and leaves the new session.
 */
export async function runALateMe401ForAnOldTokenRecordsNothing(): Promise<void> {
  const deferred = stubDeferredFetch();
  signInAs("token-old", "first@bms.local");

  const pending = expectMe401("token-old");
  await deferred.sent;
  signInAs("token-new", "second@bms.local");
  deferred.answer(json401(DEACTIVATED_BODY));
  await pending;
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
 * `F4.214` review M5 — on `/auth/callback` (a full page load) the store can
 * rehydrate an OLDER live token A while `/me` goes out for the new sign-in B.
 * The store did not change during the request, so B's deactivated 401 records
 * its reason and the callback can show the F4.203 sentence.
 */
export async function runAMe401WithAnUnrelatedOlderTokenRecordsTheReason(): Promise<void> {
  stubDeactivatedMe();
  signInAs("token-a", "first@bms.local");

  await expectMe401("token-b");

  await vi.waitFor(() => {
    assert(
      reason() === "account_deactivated",
      `a /me 401 for B while the store holds an unchanged A must record the reason, got ${String(reason())}`,
    );
  });
}

/**
 * `F4.214` review M6 — the check runs after the body read: a `setSession` that
 * lands between the 401's headers and its body records nothing.
 */
export async function runASessionSetDuringTheBodyReadRecordsNothing(): Promise<void> {
  const deferred = stubDeferredFetch();
  signInAs("token-a", "first@bms.local");

  let push: (chunk: string) => void = () => undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (chunk) => {
        controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      };
    },
  });

  const pending = expectMe401("token-a");
  await deferred.sent;
  deferred.answer(
    new Response(body, {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }),
  );
  // The headers are in; let fetchCurrentUser reach the body read.
  await settle();
  signInAs("token-new", "second@bms.local");
  push(JSON.stringify(DEACTIVATED_BODY));
  await pending;
  await settle();

  assert(
    reason() === null,
    `a session set during the 401 body read must record no reason, got ${String(reason())}`,
  );
  assert(
    useAuthStore.getState().accessToken === "token-new",
    "a session set during the 401 body read must stay",
  );
}

/**
 * `F4.214` review M6 control — the same streamed body with no sign-in during
 * the read records the reason. Without it, a stream that stopped parsing
 * would leave M6 green under the check-before-read mutation.
 */
export async function runAStreamedBodyWithNoNewSessionRecordsTheReason(): Promise<void> {
  const deferred = stubDeferredFetch();
  signInAs("token-a", "first@bms.local");

  let push: (chunk: string) => void = () => undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (chunk) => {
        controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      };
    },
  });

  const pending = expectMe401("token-a");
  await deferred.sent;
  deferred.answer(
    new Response(body, {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }),
  );
  await settle();
  push(JSON.stringify(DEACTIVATED_BODY));
  await pending;
  await settle();

  assert(
    reason() === "account_deactivated",
    `a streamed 401 body with no new session must record the reason, got ${String(reason())}`,
  );
}

/**
 * `F4.214` review M7 — the store changed during the request, but to the token
 * this `/me` carried: the 401 is about the current session and records.
 */
export async function runAStoreChangedToTheRequestTokenRecordsTheReason(): Promise<void> {
  const deferred = stubDeferredFetch();
  assert(useAuthStore.getState().accessToken === null, "the store must start empty");

  const pending = expectMe401("token-b");
  await deferred.sent;
  signInAs("token-b", "second@bms.local");
  deferred.answer(json401(DEACTIVATED_BODY));
  await pending;

  await vi.waitFor(() => {
    assert(
      reason() === "account_deactivated",
      `a /me 401 for the token the store changed to must record the reason, got ${String(reason())}`,
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

/**
 * `F2.10` (ADR 0098 B8) — `refreshScope` reads `/auth/me` with the token it was given and
 * replaces the stored scope with the served one (a create or a move changed the tree).
 */
export async function runRefreshScopeReplacesTheStoredScope(): Promise<void> {
  signInAs("tok-r", "r@example.test");
  const fresh = {
    kind: "location" as const,
    locations: [
      { id: "loc-r", code: "R", slug: "r", name: "Root", type: "site", province: null, parentId: null },
      { id: "loc-c", code: "C", slug: "c", name: "Child", type: "site", province: null, parentId: "loc-r" },
    ],
    assetGroups: [],
    assetIds: [],
  };
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          user: { id: "id-tok-r", email: "r@example.test", displayName: "r", role: "location_admin" },
          scope: fresh,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  await refreshScope("tok-r");
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  assert(String(url).endsWith("/api/v1/auth/me"), `expected the /me URL, got ${String(url)}`);
  const auth = new Headers(init?.headers).get("Authorization");
  assert(auth === "Bearer tok-r", `expected the given token, got ${String(auth)}`);
  assert(
    JSON.stringify(useAuthStore.getState().scope) === JSON.stringify(fresh),
    "expected the stored scope to equal the served one",
  );
}
