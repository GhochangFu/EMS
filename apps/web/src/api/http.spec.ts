import { clearSessionOnAuthFailure, withAuth } from "./http";
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
