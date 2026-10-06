import { vi } from "vitest";

import type { AuthFailureCode } from "@bms/shared";

import { clearSessionOnAuthFailure, withAuth } from "./http";
import { RETURN_PATH_KEY } from "../lib/return-path";
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

/** The default session the older cases share. */
function signIn(): void {
  signInAs("token-abc", "wc-admin@bms.local");
}

function response(status: number): Response {
  return new Response(status === 204 ? null : "body", { status });
}

/**
 * `F4.52`. `clearSessionOnAuthFailure` treated 403 exactly like 401 and called
 * `clearSession()`, so an authorization refusal logged the user out and took
 * whatever they had typed with it.
 *
 * The two statuses do not mean the same thing. 401 is *we do not know who you
 * are* — the local token is stale and clearing it is the repair. 403 is *we
 * know exactly who you are and you may not do this* — the session is valid and
 * destroying it fixes nothing.
 *
 * This narrowing is safe because no 403 in this API is repairable by
 * re-authentication: `JwtAuthGuard` is the only `CanActivate` in the app and
 * throws `UnauthorizedException` for a missing, malformed, expired or
 * unverifiable token in both the local and the OIDC path, and no global guard
 * or exception filter can remap a status. Were a 403 ever repairable by
 * signing in again, keeping the session would strand a user on a screen that
 * never recovers. See `http.ts` for the one 403 that carries no principal and
 * why it argues for this behaviour rather than against it.
 */
export function runAuthFailureTests(): void {
  signIn();
  clearSessionOnAuthFailure(response(401), withAuth());
  assert(
    useAuthStore.getState().accessToken === null,
    "a 401 must still clear the session — the token is what is wrong",
  );

  // The defect, stated directly.
  signIn();
  clearSessionOnAuthFailure(response(403), withAuth());
  assert(
    useAuthStore.getState().accessToken === "token-abc",
    "a 403 must keep the session — the user is known and merely not permitted",
  );
  assert(
    useAuthStore.getState().user?.email === "wc-admin@bms.local",
    "a 403 must leave the signed-in user in place, not just the token",
  );

  // The other direction: narrowing must not turn every non-2xx into a keeper.
  // 404 and 500 never cleared the session and still must not.
  for (const status of [404, 409, 500]) {
    signIn();
    clearSessionOnAuthFailure(response(status), withAuth());
    assert(
      useAuthStore.getState().accessToken === "token-abc",
      `a ${status} must not clear the session`,
    );
  }

  // A successful response is the common case and must be inert.
  signIn();
  clearSessionOnAuthFailure(response(200), withAuth());
  assert(
    useAuthStore.getState().accessToken === "token-abc",
    "a 200 must not clear the session",
  );
}

const WALL_PATH = "/control-room/site/x/sld";
const WALL_SEARCH = "?wall=1&every=30";

/** Puts the jsdom tab on `url`, empties the tab's storage and signs in. */
function onPage(url: string): void {
  window.history.replaceState({}, "", url);
  window.sessionStorage.clear();
  signIn();
}

/**
 * `F3.77` H1 (plan D10) — a 401 on a wall URL keeps the wall URL as the return
 * path **and** still clears the session.
 */
export function runWallReturnPathOn401Test(): void {
  onPage(`${WALL_PATH}${WALL_SEARCH}`);
  clearSessionOnAuthFailure(response(401), withAuth());
  assert(
    window.sessionStorage.getItem(RETURN_PATH_KEY) === `${WALL_PATH}${WALL_SEARCH}`,
    "a 401 on a wall URL must store the wall URL as the return path",
  );
  assert(
    useAuthStore.getState().accessToken === null,
    "a 401 on a wall URL must still clear the session",
  );
}

/** `F3.77` H2 — a 401 off a wall URL stores nothing, and still clears the session. */
export function runNoReturnPathOffWallTest(): void {
  onPage("/alarms?state=active");
  clearSessionOnAuthFailure(response(401), withAuth());
  assert(
    window.sessionStorage.getItem(RETURN_PATH_KEY) === null,
    "a 401 off a wall URL must store no return path",
  );
  assert(
    useAuthStore.getState().accessToken === null,
    "a 401 off a wall URL must clear the session",
  );
}

/**
 * `F3.77` H4 — the wall tab's later 401s land after the route guard has moved
 * it to `/login`; they must keep the path the first 401 stored.
 */
export function runLater401KeepsReturnPathTest(): void {
  onPage(`${WALL_PATH}${WALL_SEARCH}`);
  clearSessionOnAuthFailure(response(401), withAuth());
  window.history.replaceState({}, "", "/login");
  // Read after the clear, so the later 401 carries no bearer and reaches the
  // return-path guard rather than stopping at the `F4.206` bearer check.
  clearSessionOnAuthFailure(response(401), withAuth());
  assert(
    window.sessionStorage.getItem(RETURN_PATH_KEY) === `${WALL_PATH}${WALL_SEARCH}`,
    "a later 401 on /login must keep the wall URL the first 401 stored",
  );
}

/**
 * `F3.77` H4, realistic variant — the wall tab's other in-flight requests were
 * sent with the old bearer, so their 401s land after the first one cleared the
 * session and the guard moved the tab to `/login`. They carry a bearer the
 * store no longer holds (`F4.206`), so they must keep the stored wall URL.
 */
export function runLater401WithTheOldBearerKeepsReturnPathTest(): void {
  onPage(`${WALL_PATH}${WALL_SEARCH}`);
  const first = withAuth();
  const second = withAuth(); // sent with token-abc, before the first 401 lands
  clearSessionOnAuthFailure(response(401), first);
  window.history.replaceState({}, "", "/login");
  clearSessionOnAuthFailure(response(401), second);
  assert(
    window.sessionStorage.getItem(RETURN_PATH_KEY) === `${WALL_PATH}${WALL_SEARCH}`,
    "a later 401 that carried the old bearer must keep the wall URL the first 401 stored",
  );
}

/** `F3.77` H3 — a 403 on a wall URL does neither: no return path, the session kept. */
export function runNoReturnPathOn403Test(): void {
  onPage(`${WALL_PATH}${WALL_SEARCH}`);
  clearSessionOnAuthFailure(response(403), withAuth());
  assert(
    window.sessionStorage.getItem(RETURN_PATH_KEY) === null,
    "a 403 must store no return path",
  );
  assert(
    useAuthStore.getState().accessToken === "token-abc",
    "a 403 must keep the session",
  );
}

/**
 * `withAuth` is the other half of this module and had no test either. It is
 * covered here because the 403 fix leaves a session in place that the very next
 * request must still send — a 403 that keeps the session but drops the header
 * would turn into a 401 on the following call and log the user out anyway.
 */
export function runWithAuthTests(): void {
  signIn();
  const headers = new Headers(withAuth().headers);
  assert(
    headers.get("Authorization") === "Bearer token-abc",
    "a signed-in request must carry the bearer token",
  );

  // Caller headers survive; the helper adds to them rather than replacing them.
  const merged = new Headers(
    withAuth({ headers: { "Content-Type": "application/json" } }).headers,
  );
  assert(
    merged.get("Content-Type") === "application/json",
    "withAuth must keep the caller's own headers",
  );
  assert(
    merged.get("Authorization") === "Bearer token-abc",
    "withAuth must add the bearer token alongside them",
  );

  useAuthStore.getState().clearSession();
  const anonymous = new Headers(withAuth().headers);
  assert(
    anonymous.get("Authorization") === null,
    "a signed-out request must send no Authorization header at all",
  );
}

const DEACTIVATED_BODY = {
  statusCode: 401,
  message: "This account is deactivated",
  error: "Unauthorized",
  code: "account_deactivated",
};
const PLAIN_BODY = { statusCode: 401, message: "Invalid token", error: "Unauthorized" };

function json401(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

/** Lets the clone's async body read settle; long enough that a wrong write lands first. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

function reason(): string | null {
  return useAuthStore.getState().authFailureReason;
}

/** `F4.203` R1 — a deactivated 401 records its code, and the session is still cleared. */
export async function runDeactivated401RecordsTheReason(): Promise<void> {
  signIn();
  clearSessionOnAuthFailure(json401(DEACTIVATED_BODY), withAuth());
  assert(useAuthStore.getState().accessToken === null, "a deactivated 401 must clear the session");
  await vi.waitFor(() => {
    assert(reason() === "account_deactivated", `expected account_deactivated, got ${String(reason())}`);
  });
}

/** `F4.203` R2 — a plain 401 records nothing; the cleared session is the positive control. */
export async function runPlain401RecordsNoReason(): Promise<void> {
  signIn();
  clearSessionOnAuthFailure(json401(PLAIN_BODY), withAuth());
  assert(useAuthStore.getState().accessToken === null, "control: a plain 401 must clear the session");
  await settle();
  assert(reason() === null, `a plain 401 must record no reason, got ${String(reason())}`);
}

/**
 * `F4.203` R3 — a later plain 401 does not erase a recorded reason: a plain 401
 * writes nothing at all. This is not the first-wins gate — the enum has one
 * member and a plain 401 records nothing, so R3b (the store) holds that rule.
 */
export async function runALaterPlain401DoesNotEraseTheReason(): Promise<void> {
  signIn();
  clearSessionOnAuthFailure(json401(DEACTIVATED_BODY), withAuth());
  await vi.waitFor(() => {
    assert(reason() === "account_deactivated", "control: the first 401 recorded its reason");
  });
  clearSessionOnAuthFailure(json401(PLAIN_BODY), withAuth());
  await settle();
  assert(
    reason() === "account_deactivated",
    `a later plain 401 must keep the first reason, got ${String(reason())}`,
  );
}

/** `F4.203` R3b — the store's own rule: a second reason never replaces the first. */
export function runTheStoreKeepsTheFirstReason(): void {
  signIn();
  useAuthStore.getState().rememberAuthFailure("account_deactivated");
  useAuthStore.getState().rememberAuthFailure("a_later_code" as AuthFailureCode);
  assert(reason() === "account_deactivated", `the first reason must win, got ${String(reason())}`);
}

/** `F4.203` R4 — a 401 whose body is not JSON records nothing and still clears the session. */
export async function runANonJsonBodyIsIgnored(): Promise<void> {
  signIn();
  clearSessionOnAuthFailure(new Response("<html>gateway</html>", { status: 401 }), withAuth());
  assert(useAuthStore.getState().accessToken === null, "control: a non-JSON 401 must clear the session");
  await settle();
  assert(reason() === null, "a non-JSON 401 must record no reason");
}

/** `F4.203` R5 — the reason is read from a clone: the caller can still read the body after. */
export async function runTheCallerCanStillReadTheBody(): Promise<void> {
  signIn();
  const res = json401(DEACTIVATED_BODY);
  clearSessionOnAuthFailure(res, withAuth());
  const body = (await res.json()) as { code?: unknown };
  assert(body.code === "account_deactivated", "the caller must still read the whole body");
  await vi.waitFor(() => {
    assert(reason() === "account_deactivated", "and the reason is recorded as well");
  });
}

/** `F4.203` R6 — a caller that read the body first still gets its session cleared (fail closed). */
export async function runAReadBodyStillClearsTheSession(): Promise<void> {
  signIn();
  const res = json401(DEACTIVATED_BODY);
  await res.text();
  clearSessionOnAuthFailure(res, withAuth());
  assert(useAuthStore.getState().accessToken === null, "a 401 with a used body must still clear the session");
}

/**
 * `F4.203` R8 — a 401 whose clone throws still clears the session, records no
 * reason, and the call returns normally.
 */
export async function runAnUnclonableResponseStillClearsTheSession(): Promise<void> {
  signIn();
  const res = json401(DEACTIVATED_BODY);
  Object.defineProperty(res, "clone", {
    value: () => {
      throw new TypeError("unclonable");
    },
  });
  let thrown: unknown = null;
  try {
    clearSessionOnAuthFailure(res, withAuth());
  } catch (err) {
    thrown = err;
  }
  assert(thrown === null, `the call must not throw, got ${String(thrown)}`);
  assert(useAuthStore.getState().accessToken === null, "an unclonable 401 must still clear the session");
  await settle();
  assert(reason() === null, "an unclonable 401 must record no reason");
}

/** `F4.203` R7 — a new session consumes the reason. */
export async function runSetSessionConsumesTheReason(): Promise<void> {
  signIn();
  clearSessionOnAuthFailure(json401(DEACTIVATED_BODY), withAuth());
  await vi.waitFor(() => {
    assert(reason() === "account_deactivated", "control: the reason was recorded");
  });
  signIn();
  assert(reason() === null, "setSession must consume the reason");
}

/*
 * `F4.206` — a 401 clears the session only when the request carried the bearer
 * the store holds now. A slow request sent with an old token must not sign out
 * (or record a reason for) a user who signed in after it was sent.
 */

const NEW_EMAIL = "new-user@bms.local";

/** Sends a request as `token-old`, then signs in as `token-new` before its 401 lands. */
function aLate401ForAnOldToken(): void {
  signInAs("token-old", "old-user@bms.local");
  const sent = withAuth();
  signInAs("token-new", NEW_EMAIL);
  clearSessionOnAuthFailure(json401(DEACTIVATED_BODY), sent);
}

/** L1 — a late 401 for an old token leaves the new session in place. */
export function runALate401LeavesTheNewSession(): void {
  aLate401ForAnOldToken();
  assert(
    useAuthStore.getState().accessToken === "token-new",
    `a late 401 for an old token must keep the new token, got ${String(useAuthStore.getState().accessToken)}`,
  );
  assert(
    useAuthStore.getState().user?.email === NEW_EMAIL,
    "a late 401 for an old token must keep the new user",
  );
}

/** L2 — a late 401 for an old token records no reason for the new user. */
export async function runALate401RecordsNoReason(): Promise<void> {
  aLate401ForAnOldToken();
  await settle();
  assert(reason() === null, `a late 401 must record no reason, got ${String(reason())}`);
}

/** L3 — control: a 401 that carried the current token still clears and records. */
export async function runACurrent401StillClearsAndRecords(): Promise<void> {
  signIn();
  const sent = withAuth();
  clearSessionOnAuthFailure(json401(DEACTIVATED_BODY), sent);
  assert(useAuthStore.getState().accessToken === null, "a 401 for the current token must clear the session");
  await vi.waitFor(() => {
    assert(reason() === "account_deactivated", `expected account_deactivated, got ${String(reason())}`);
  });
}

/** L4 — a 401 whose request carried no bearer leaves a session that began after it. */
export function runAnAnonymous401LeavesALaterSession(): void {
  useAuthStore.getState().clearSession();
  const sent = withAuth();
  signInAs("token-new", NEW_EMAIL);
  clearSessionOnAuthFailure(json401(DEACTIVATED_BODY), sent);
  assert(
    useAuthStore.getState().accessToken === "token-new",
    `an anonymous 401 must keep a later session, got ${String(useAuthStore.getState().accessToken)}`,
  );
}

/** L5 — a stale 401 on a wall URL stores no return path (H1 is the positive control). */
export function runAStale401StoresNoReturnPath(): void {
  onPage(`${WALL_PATH}${WALL_SEARCH}`);
  const sent = withAuth();
  signInAs("token-new", NEW_EMAIL);
  clearSessionOnAuthFailure(json401(DEACTIVATED_BODY), sent);
  assert(
    window.sessionStorage.getItem(RETURN_PATH_KEY) === null,
    "a stale 401 must store no return path",
  );
}

/*
 * `F4.219` — the bearer check runs before the clear, but the reason is written
 * after an async read of the 401 body. A `setSession` that lands in that gap
 * must not receive the old token's reason.
 */

/** A 401 whose JSON body arrives only when the spec calls `push`. */
function streamed401(): { res: Response; push: (chunk: string) => void } {
  let push: (chunk: string) => void = () => undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (chunk) => {
        controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      };
    },
  });
  const res = new Response(body, {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
  return { res, push };
}

/** S1 — a session set while the 401 body streams gets no reason, and keeps its token. */
export async function runASessionSetDuringThe401BodyReadRecordsNothing(): Promise<void> {
  signIn();
  const sent = withAuth();
  const { res, push } = streamed401();
  clearSessionOnAuthFailure(res, sent);
  assert(
    useAuthStore.getState().accessToken === null,
    "the clear must stay synchronous",
  );
  signInAs("token-new", "second@bms.local");
  push(JSON.stringify(DEACTIVATED_BODY));
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
 * S2 — control for S1: the same streamed body with no sign-in during the read
 * records the reason. Without it, a stream that stopped parsing would keep S1
 * green under every mutation.
 */
export async function runAStreamed401BodyWithNoNewSessionRecordsTheReason(): Promise<void> {
  signIn();
  const sent = withAuth();
  const { res, push } = streamed401();
  clearSessionOnAuthFailure(res, sent);
  push(JSON.stringify(DEACTIVATED_BODY));
  await vi.waitFor(() => {
    assert(
      reason() === "account_deactivated",
      `a streamed 401 body with no new session must record the reason, got ${String(reason())}`,
    );
  });
}
