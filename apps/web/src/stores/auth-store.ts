import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { AccessibleScope, UserRole } from "@bms/shared";

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
  clearSession: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      oidcIdToken: null,
      user: null,
      scope: null,
      setSession: (accessToken, user, scope, oidcIdToken) =>
        set({ accessToken, oidcIdToken, user, scope }),
      setScope: (scope) => set({ scope }),
      clearSession: () =>
        set({ accessToken: null, oidcIdToken: null, user: null, scope: null }),
    }),
    { name: "bms-auth" },
  ),
);
