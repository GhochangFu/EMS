import { unauthorizedEnvelopeSchema } from "@bms/shared/contracts";

import { rememberWallReturnPath } from "../lib/return-path";
import { useAuthStore } from "../stores/auth-store";

/** Merges Authorization header when a session exists (JWT-protected API routes). */
export function withAuth(init: RequestInit = {}): RequestInit {
  const token = useAuthStore.getState().accessToken;
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return { ...init, headers };
}

/**
 * Clears stale local auth when the API says it does not know who the caller is.
 *
 * **401 only, deliberately** (`F4.52`). This used to clear on 403 as well,
 * which logged a user out of a valid session every time they were refused —
 * and took whatever they had typed with them. The two statuses do not mean the
 * same thing: 401 is *we do not know who you are*, so the local token is the
 * thing that is wrong and dropping it is the repair; 403 is *we know exactly
 * who you are and you may not do this*, where the session is fine and the
 * caller's own error handling is what should run.
 *
 * The narrowing is safe because **no 403 in this API is repairable by
 * re-authentication** — that, not "every 403 concerns a known user", is the
 * load-bearing property. `JwtAuthGuard` throws `UnauthorizedException` for a
 * missing, malformed, expired or unverifiable token in both the local and the
 * OIDC path, and it is the only `CanActivate` in the app: there is no global
 * guard or exception filter that could remap a status. So no token problem
 * reaches the client as a 403, and **no 403 becomes a success by signing in
 * again** — which is the precise claim, and narrower than "re-authentication
 * changes nothing". One thing it does change: the API authorizes on the *database*
 * role while this app gates its UI on the role claim stored at login, so a
 * mid-session downgrade now leaves the UI offering buttons every call refuses
 * until the token expires. Previously the first 403 forced a re-login and
 * resynced it by accident. That is a known cost of this change, not an
 * oversight — and it is a stale *menu*, where the old behaviour destroyed a
 * valid session on every ordinary refusal.
 *
 * `tests/f4.52-auth-failure-status.test.ts` asserts the guard half of this,
 * because a property a docblock merely asserts is the failure this repository
 * keeps hitting.
 *
 * The sharper wording is owed to one real counterexample, kept here because it
 * is the strongest case *for* the change rather than against it:
 * `audit.service.ts` refuses a valid, verified token whose subject matches no
 * `users` row ("this token matches no user"). That is a 403 with no principal —
 * and clearing the session there would send the user to a login screen that
 * cannot help, because signing in again does not provision an account. A
 * login loop is worse than a sentence on screen.
 *
 * Keep the property true. A 403 that *were* repairable by re-authentication
 * would leave the user on a screen that never recovers.
 *
 * This is what makes ADR 0038 decision 10 reachable. It says the
 * organization-scope case "falls through to the API's 403, rendered inline";
 * the render was always there, and clearing the session was what stopped it
 * running.
 *
 * **`F3.77` (plan D10)** — before it clears, a 401 keeps the tab's path and
 * query as the return path when the tab is a wall URL (`?wall=1`), and does
 * nothing otherwise — a later 401 that lands after the tab has moved to
 * `/login` must not drop the path; `lib/return-path.ts` holds the guard. The route
 * guard's `<Navigate to="/login">` is unchanged, and the login page then shows
 * "Session ended" and returns there after sign-in. `rememberWallReturnPath`
 * never throws, and with no `window` (a node-environment spec) it does
 * nothing, so the session is cleared whatever the storage does.
 */
export function clearSessionOnAuthFailure(res: Response): void {
  if (res.status === 401) {
    // `F4.203` — keep the reason the 401 gives. Read from a clone, so every
    // caller can still read the body after this call (none reads it before —
    // re-verified across the 53 call sites). A used body cannot be cloned; it
    // skips the reason, never the clear.
    if (!res.bodyUsed) {
      void recordAuthFailureReason(res.clone());
    }
    if (typeof window !== "undefined") {
      rememberWallReturnPath(window.location);
    }
    useAuthStore.getState().clearSession();
  }
}

/**
 * `F4.203` — reads a 401 body and, when it is the guard's envelope with a
 * `code`, records the code as the reason the session ended (first wins, in the
 * store). A plain 401, a non-JSON body or a failed read records nothing and
 * never rejects. Consumes `res`'s body: pass a clone, or a response nobody
 * reads after.
 */
export function recordAuthFailureReason(res: Response): Promise<void> {
  return res
    .json()
    .then((body: unknown) => {
      const parsed = unauthorizedEnvelopeSchema.safeParse(body);
      if (parsed.success && parsed.data.code) {
        useAuthStore.getState().rememberAuthFailure(parsed.data.code);
      }
    })
    .catch(() => undefined);
}
