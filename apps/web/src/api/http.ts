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
 * The narrowing is only safe because no authentication failure in this API
 * arrives as a 403. `JwtAuthGuard` throws `UnauthorizedException` for a
 * missing, malformed, expired or unverifiable token in both the local and the
 * OIDC path, so every 403 is an authorization decision about a known user —
 * `ForbiddenException` is thrown nowhere else. Keep that true: a 403 raised for
 * a token problem would leave the user on a screen that never recovers.
 *
 * This is what makes ADR 0038 decision 10 reachable. It says the
 * organization-scope case "falls through to the API's 403, rendered inline";
 * the render was always there, and clearing the session was what stopped it
 * running.
 */
export function clearSessionOnAuthFailure(res: Response): void {
  if (res.status === 401) {
    useAuthStore.getState().clearSession();
  }
}
