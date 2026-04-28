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

/** Clears stale local auth when the API rejects a protected request. */
export function clearSessionOnAuthFailure(res: Response): void {
  if (res.status === 401 || res.status === 403) {
    useAuthStore.getState().clearSession();
  }
}
