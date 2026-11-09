import { create } from "zustand";

import type { ColourProfile, DesignSystem } from "@bms/shared";

import { DESIGN_STORAGE_KEY, readDocumentDesign } from "../lib/design";
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
  /** `F4.341` — the effective design system (ADR 0118 decision 8); `nexus-soft` by default. */
  design: DesignSystem;
  setDesign: (design: DesignSystem) => void;
};

let cache: { theme: Theme; profile: ColourProfile; design: DesignSystem; roles: Roles } | null = null;

/**
 * The roles of the theme `<html>` carries now, resolved once per theme. Throws when there is no
 * `document`, and (through `resolveRoles`) when a role reads empty — a chart must never paint
 * a library default in place of a role.
 */
export function currentRoles(): Roles {
  if (typeof document === "undefined") throw new Error("theme roles need a document; there is none");
  const theme = readDocumentTheme();
  const profile = readDocumentProfile();
  // `F4.341` (ADR 0118 decision 4): keyed on the design system too. A design system sets no colour
  // role, but a chart that re-reads its roles on a design change also re-reads its type tokens.
  const design = readDocumentDesign();
  if (cache === null || cache.theme !== theme || cache.profile !== profile || cache.design !== design) {
    cache = { theme, profile, design, roles: resolveRoles(readRoleFromDocument) };
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
  design: typeof document === "undefined" ? "nexus-soft" : readDocumentDesign(),
  setDesign: (design) => {
    // As `setProfile`: the attribute first, the default carries none, and no document moves the state only.
    if (typeof document === "undefined") {
      set({ design });
      return;
    }
    applyDesignAttribute(design);
    try {
      if (design === "nexus-soft") localStorage.removeItem(DESIGN_STORAGE_KEY);
      else localStorage.setItem(DESIGN_STORAGE_KEY, design);
    } catch {
      // The design holds for this page; the next `/auth/me` read sets it again.
    }
    set({ design });
  },
}));

function applyDesignAttribute(design: DesignSystem): void {
  if (design === "nexus-soft") document.documentElement.removeAttribute("data-design");
  else document.documentElement.setAttribute("data-design", design);
}

/**
 * `F4.341` (ADR 0118 decision 11) — the Appearance panel's live preview: paints the page in
 * `design` without storing it; `null` puts the viewer's own design system back.
 */
export function previewDesign(design: DesignSystem | null): void {
  if (typeof document === "undefined") return;
  applyDesignAttribute(design ?? useThemeStore.getState().design);
}

/**
 * `F4.341` (ADR 0118 decision 12) — sign-out: back to the default design system and no cached
 * `bms.design`, so a shared control-room PC never keeps the last user's look.
 */
export function clearDesign(): void {
  useThemeStore.getState().setDesign("nexus-soft");
}

/** `F4.341` — the effective design system; a component re-renders when it changes. */
export function useDesignSystem(): DesignSystem {
  return useThemeStore((s) => s.design);
}

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
  useThemeStore((s) => s.design);
  return currentRoles();
}
