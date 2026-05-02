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
    scope?: AccessibleScope,
    oidcIdToken?: string | null,
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
      setSession: (accessToken, user, scope, oidcIdToken = null) =>
        set({ accessToken, oidcIdToken, user, scope }),
      setScope: (scope) => set({ scope }),
      clearSession: () =>
        set({ accessToken: null, oidcIdToken: null, user: null, scope: null }),
    }),
    { name: "bms-auth" },
  ),
);
