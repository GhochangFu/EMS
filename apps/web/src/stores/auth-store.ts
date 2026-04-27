import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { UserRole } from "@bms/shared";

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
};

type AuthState = {
  accessToken: string | null;
  user: AuthUser | null;
  setSession: (token: string, user: AuthUser) => void;
  clearSession: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      user: null,
      setSession: (accessToken, user) => set({ accessToken, user }),
      clearSession: () => set({ accessToken: null, user: null }),
    }),
    { name: "bms-auth" },
  ),
);
