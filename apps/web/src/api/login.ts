import {
  currentUserResponseSchema,
  loginResponseSchema,
} from "@bms/shared/contracts";
import type { CurrentUserResponse, LoginResponse } from "@bms/shared";

import { recordAuthFailureReason } from "./http";
import { checkResponse } from "./validate";
import { useAuthStore } from "../stores/auth-store";

const base = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * POST /api/v1/auth/login — returns JWT and user profile.
 */
export async function loginRequest(
  email: string,
  password: string,
): Promise<LoginResponse> {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Login failed (${res.status})`);
  }
  return checkResponse(loginResponseSchema, await res.json(), "auth/login");
}

/**
 * GET /api/v1/auth/me — hydrates DB-backed role and location scope.
 *
 * `F4.203` (OQ2) — a 401 records its reason before the throw, so the caller's
 * catch (the `App` reload effect, the OIDC callback) clears a session whose
 * reason is already held. Nothing reads this body after, so no clone.
 *
 * `F4.214` — the store's token is read before the send (`atSend`). The reason
 * is recorded only when the store, read after the 401 body is parsed, still
 * holds `atSend` (it did not change during the request) or holds the token
 * this `/me` carried. A store that holds some other token is NOT by itself a
 * newer session: on `/auth/callback` (a full page load) the store can
 * rehydrate an older live token while `/me` goes out for the new sign-in, and
 * that `/me`'s deactivated 401 must still record. Only a store that changed
 * mid-request to a token other than this one marks a newer sign-in, and then
 * nothing records. The predicate runs inside `recordAuthFailureReason`, after
 * the body read, so a `setSession` that lands while the body streams is seen.
 * Limit, accepted by the owner (2026-10-06): a sign-out and a sign-in that
 * leave the same token around the request look unchanged, so a late `/me` 401
 * then still records a reason. It cannot clear a session; only the callers'
 * `catch` blocks do that.
 */
export async function fetchCurrentUser(
  accessToken: string,
): Promise<CurrentUserResponse> {
  const atSend = useAuthStore.getState().accessToken;
  const res = await fetch(`${base}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) {
    await recordAuthFailureReason(res, () => {
      const current = useAuthStore.getState().accessToken;
      return current === atSend || current === accessToken;
    });
  }
  if (!res.ok) {
    throw new Error(`Current user failed (${res.status})`);
  }
  return checkResponse(currentUserResponseSchema, await res.json(), "auth/me");
}
