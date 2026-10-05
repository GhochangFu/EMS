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

/** A session shaped like the one `POST /auth/login` writes. */
function signIn(): void {
  useAuthStore.getState().setSession(
    "token-abc",
    { id: "u1", email: "wc-admin@bms.local", displayName: "WC Admin", role: "location_admin" },
    { kind: "location", locations: [], assetGroups: [], assetIds: [] },
    null,
  );
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
  clearSessionOnAuthFailure(response(401));
  assert(
    useAuthStore.getState().accessToken === null,
    "a 401 must still clear the session — the token is what is wrong",
  );

  // The defect, stated directly.
  signIn();
  clearSessionOnAuthFailure(response(403));
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
    clearSessionOnAuthFailure(response(status));
    assert(
      useAuthStore.getState().accessToken === "token-abc",
      `a ${status} must not clear the session`,
    );
  }

  // A successful response is the common case and must be inert.
  signIn();
  clearSessionOnAuthFailure(response(200));
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
  clearSessionOnAuthFailure(response(401));
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
  clearSessionOnAuthFailure(response(401));
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
  clearSessionOnAuthFailure(response(401));
  window.history.replaceState({}, "", "/login");
  clearSessionOnAuthFailure(response(401));
  assert(
    window.sessionStorage.getItem(RETURN_PATH_KEY) === `${WALL_PATH}${WALL_SEARCH}`,
    "a later 401 on /login must keep the wall URL the first 401 stored",
  );
}

/** `F3.77` H3 — a 403 on a wall URL does neither: no return path, the session kept. */
export function runNoReturnPathOn403Test(): void {
  onPage(`${WALL_PATH}${WALL_SEARCH}`);
  clearSessionOnAuthFailure(response(403));
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
  clearSessionOnAuthFailure(json401(DEACTIVATED_BODY));
  assert(useAuthStore.getState().accessToken === null, "a deactivated 401 must clear the session");
  await vi.waitFor(() => {
    assert(reason() === "account_deactivated", `expected account_deactivated, got ${String(reason())}`);
  });
}

/** `F4.203` R2 — a plain 401 records nothing; the cleared session is the positive control. */
export async function runPlain401RecordsNoReason(): Promise<void> {
  signIn();
  clearSessionOnAuthFailure(json401(PLAIN_BODY));
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
  clearSessionOnAuthFailure(json401(DEACTIVATED_BODY));
  await vi.waitFor(() => {
    assert(reason() === "account_deactivated", "control: the first 401 recorded its reason");
  });
  clearSessionOnAuthFailure(json401(PLAIN_BODY));
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
  clearSessionOnAuthFailure(new Response("<html>gateway</html>", { status: 401 }));
  assert(useAuthStore.getState().accessToken === null, "control: a non-JSON 401 must clear the session");
  await settle();
  assert(reason() === null, "a non-JSON 401 must record no reason");
}

/** `F4.203` R5 — the reason is read from a clone: the caller can still read the body after. */
export async function runTheCallerCanStillReadTheBody(): Promise<void> {
  signIn();
  const res = json401(DEACTIVATED_BODY);
  clearSessionOnAuthFailure(res);
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
  clearSessionOnAuthFailure(res);
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
    clearSessionOnAuthFailure(res);
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
  clearSessionOnAuthFailure(json401(DEACTIVATED_BODY));
  await vi.waitFor(() => {
    assert(reason() === "account_deactivated", "control: the reason was recorded");
  });
  signIn();
  assert(reason() === null, "setSession must consume the reason");
}
