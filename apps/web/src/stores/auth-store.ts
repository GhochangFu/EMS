import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { AccessibleScope, AuthFailureCode, UserRole } from "@bms/shared";

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
};

type AuthState = {
  accessToken: string | null;
  oidcIdToken: string | null;
  user: AuthUser | null;
  scope: AccessibleScope | null;
  /**
   * `F4.203` — why the last session ended, when the API said so (a 401 with a
   * `code`). The sign-in page reads it. Not persisted: a reload forgets it.
   */
  authFailureReason: AuthFailureCode | null;
  setSession: (
    token: string,
    user: AuthUser,
    scope: AccessibleScope | null,
    /**
     * Required, not defaulted: a caller that re-sets the session must say what
     * happens to the OIDC id token. A default of `null` let the `/me` re-set in
     * `app.tsx` erase it silently, so logout lost its `id_token_hint` (F4.156).
     */
    oidcIdToken: string | null,
  ) => void;
  setScope: (scope: AccessibleScope) => void;
  /** Leaves `authFailureReason` in place, so the sign-in page can still show it. */
  clearSession: () => void;
  /**
   * `F4.203` — keeps `code` only when no reason is held: with several 401s in
   * flight the first reason wins. `setSession` consumes it.
   */
  rememberAuthFailure: (code: AuthFailureCode) => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      oidcIdToken: null,
      user: null,
      scope: null,
      authFailureReason: null,
      setSession: (accessToken, user, scope, oidcIdToken) =>
        set({ accessToken, oidcIdToken, user, scope, authFailureReason: null }),
      setScope: (scope) => set({ scope }),
      clearSession: () =>
        set({ accessToken: null, oidcIdToken: null, user: null, scope: null }),
      rememberAuthFailure: (code) =>
        set((state) => (state.authFailureReason === null ? { authFailureReason: code } : {})),
    }),
    {
      name: "bms-auth",
      // The four keys this store persisted before `F4.203`; the failure reason stays in memory.
      partialize: (state) => ({
        accessToken: state.accessToken,
        oidcIdToken: state.oidcIdToken,
        user: state.user,
        scope: state.scope,
      }),
    },
  ),
);
