import type { CurrentUserResponse, LoginResponse } from "@bms/shared";

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
  return res.json() as Promise<LoginResponse>;
}

/** GET /api/v1/auth/me — hydrates DB-backed role and location scope. */
export async function fetchCurrentUser(
  accessToken: string,
): Promise<CurrentUserResponse> {
  const res = await fetch(`${base}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Current user failed (${res.status})`);
  }
  return res.json() as Promise<CurrentUserResponse>;
}
