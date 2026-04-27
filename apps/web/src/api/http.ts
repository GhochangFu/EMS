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
