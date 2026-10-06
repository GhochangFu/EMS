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
 * `F4.214` — the reason is recorded only when the store, read when the 401
 * answers, holds no token or holds the token this `/me` was sent with. A store
 * that holds a different token belongs to a newer sign-in, so a slow `/me` for
 * an old token records nothing for it. `null` still records: the OIDC callback
 * and the local-login path run `/me` before `setSession`, so their store is
 * empty. Limit, accepted by the owner (2026-10-06): a late `/me` 401 for an old
 * token that answers while the store is empty — after a sign-out, or before a
 * newer callback's own `setSession` — still records a reason. It cannot clear
 * a session; only the callers' `catch` blocks do that.
 */
export async function fetchCurrentUser(
  accessToken: string,
): Promise<CurrentUserResponse> {
  const res = await fetch(`${base}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) {
    const current = useAuthStore.getState().accessToken;
    if (current === null || current === accessToken) {
      await recordAuthFailureReason(res);
    }
  }
  if (!res.ok) {
    throw new Error(`Current user failed (${res.status})`);
  }
  return checkResponse(currentUserResponseSchema, await res.json(), "auth/me");
}
