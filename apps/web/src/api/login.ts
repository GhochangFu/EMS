import {
  currentUserResponseSchema,
  loginResponseSchema,
} from "@bms/shared/contracts";
import type { CurrentUserResponse, LoginResponse } from "@bms/shared";

import { recordAuthFailureReason } from "./http";
import { checkResponse } from "./validate";

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
 */
export async function fetchCurrentUser(
  accessToken: string,
): Promise<CurrentUserResponse> {
  const res = await fetch(`${base}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) {
    await recordAuthFailureReason(res);
  }
  if (!res.ok) {
    throw new Error(`Current user failed (${res.status})`);
  }
  return checkResponse(currentUserResponseSchema, await res.json(), "auth/me");
}
