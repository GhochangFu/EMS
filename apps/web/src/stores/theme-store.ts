import { create } from "zustand";

import type { ColourProfile } from "@bms/shared";

import {
  PROFILE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  readDocumentProfile,
  readDocumentTheme,
  readRoleFromDocument,
  resolveRoles,
  type Roles,
  type Theme,
} from "../lib/theme";

/**
 * `F3.65c` — the user's Light / Dark choice (ADR 0078 decision 4, plan D1).
 *
 * The state is the theme only. The roles are read through `currentRoles()`, lazily and cached
 * per theme, rather than held in the store from its creation: in `vite dev` `main.tsx` imports
 * `./app` (and so this store) before `./index.css` injects its `<style>`, so a resolve at store
 * creation would read every custom property as `""` and throw (plan D1, amended at build).
 *
 * No `persist` middleware: the key is written by hand as the bare string `"light"` / `"dark"`,
 * the one format the boot script in `index.html` reads.
 */

type ThemeState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** `F4.310` — the home organization's colour profile (ADR 0110 decision 4); `nexus` by default. */
  profile: ColourProfile;
  setProfile: (profile: ColourProfile) => void;
};

let cache: { theme: Theme; profile: ColourProfile; roles: Roles } | null = null;

/**
 * The roles of the theme `<html>` carries now, resolved once per theme. Throws when there is no
 * `document`, and (through `resolveRoles`) when a role reads empty — a chart must never paint
 * a library default in place of a role.
 */
export function currentRoles(): Roles {
  if (typeof document === "undefined") throw new Error("theme roles need a document; there is none");
  const theme = readDocumentTheme();
  const profile = readDocumentProfile();
  if (cache === null || cache.theme !== theme || cache.profile !== profile) {
    cache = { theme, profile, roles: resolveRoles(readRoleFromDocument) };
  }
  return cache.roles;
}

export const useThemeStore = create<ThemeState>()((set) => ({
  theme: typeof document === "undefined" ? "light" : readDocumentTheme(),
  setTheme: (theme) => {
    // The attribute first: a storage that throws (private mode, quota) must still flip the page.
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // The choice lasts for this page only; the boot script reads "light" on the next load.
    }
    set({ theme });
  },
  profile: typeof document === "undefined" ? "nexus" : readDocumentProfile(),
  setProfile: (profile) => {
    // The attribute first, as `setTheme`: a storage that throws must still recolour the page. The
    // default carries no attribute (its values are the base blocks) and no key. No document (a
    // node-environment caller of `clearSession`): the state alone moves.
    if (typeof document === "undefined") {
      set({ profile });
      return;
    }
    if (profile === "nexus") document.documentElement.removeAttribute("data-profile");
    else document.documentElement.setAttribute("data-profile", profile);
    try {
      if (profile === "nexus") localStorage.removeItem(PROFILE_STORAGE_KEY);
      else localStorage.setItem(PROFILE_STORAGE_KEY, profile);
    } catch {
      // The profile holds for this page; the next `/auth/me` read sets it again.
    }
    set({ profile });
  },
}));

/**
 * `F4.310` (ADR 0110 decision 8) — the chooser's live preview: paints the page in `profile` without
 * storing it; `null` puts the viewer's own profile back. Only the attribute moves, so the store (and
 * `bms.profile`) keep the viewer's own value; a chart that re-renders during a preview reads the
 * previewed roles, because `currentRoles()` keys its cache on the attribute.
 */
export function previewProfile(profile: ColourProfile | null): void {
  if (typeof document === "undefined") return;
  const shown = profile ?? useThemeStore.getState().profile;
  if (shown === "nexus") document.documentElement.removeAttribute("data-profile");
  else document.documentElement.setAttribute("data-profile", shown);
}

/**
 * `F4.310` (ADR 0110 decision 4) — sign-out: back to the default, so the sign-in page (and the next
 * user of a shared control-room PC) never shows the last user's organization colours.
 */
export function clearProfile(): void {
  useThemeStore.getState().setProfile("nexus");
}

/** The current theme; a component re-renders when it changes. */
export function useTheme(): Theme {
  return useThemeStore((s) => s.theme);
}

/** The current roles; a component re-renders with the new theme's or profile's roles when either changes. */
export function useThemeRoles(): Roles {
  useThemeStore((s) => s.theme);
  useThemeStore((s) => s.profile);
  return currentRoles();
}
