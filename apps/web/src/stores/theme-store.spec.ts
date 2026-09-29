import { act, renderHook } from "@testing-library/react";
import { expect, vi } from "vitest";

/**
 * `F3.65c` U1 — the theme store (plan D1, amended at build: roles are read through
 * `currentRoles()`, not held in the store). jsdom carries the real `index.css` blocks
 * (`test-setup.ts`), so a role read follows `data-theme` exactly as in the browser.
 *
 * Every case imports a fresh module after setting the attribute, so the store's initial state is
 * read from that attribute — a store that hard-coded `"light"` fails S1.
 */

const DARK_SURFACE = "rgb(26, 34, 45)";
const LIGHT_SURFACE = "rgb(255, 255, 255)";

async function freshStore(attribute: "light" | "dark" | null) {
  if (attribute === null) document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", attribute);
  vi.resetModules();
  return import("./theme-store");
}

function throwingStorage(): void {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("QuotaExceededError");
  });
}

export async function s1InitialThemeFollowsADarkAttribute(): Promise<void> {
  const { useThemeStore } = await freshStore("dark");
  expect(useThemeStore.getState().theme).toBe("dark");
}

export async function s1InitialRolesFollowADarkAttribute(): Promise<void> {
  const { currentRoles } = await freshStore("dark");
  expect(currentRoles().surface).toBe(DARK_SURFACE);
}

export async function s1InitialThemeFollowsALightAttribute(): Promise<void> {
  const { useThemeStore } = await freshStore("light");
  expect(useThemeStore.getState().theme).toBe("light");
}

export async function s1InitialRolesFollowALightAttribute(): Promise<void> {
  const { currentRoles } = await freshStore("light");
  expect(currentRoles().surface).toBe(LIGHT_SURFACE);
}

export async function s2SetDarkSetsTheAttribute(): Promise<void> {
  const { useThemeStore } = await freshStore("light");
  useThemeStore.getState().setTheme("dark");
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
}

export async function s2SetDarkWritesDark(): Promise<void> {
  const { useThemeStore } = await freshStore("light");
  useThemeStore.getState().setTheme("dark");
  expect(localStorage.getItem("bms.theme")).toBe("dark");
}

export async function s2SetDarkMovesTheState(): Promise<void> {
  const { useThemeStore } = await freshStore("light");
  useThemeStore.getState().setTheme("dark");
  expect(useThemeStore.getState().theme).toBe("dark");
}

export async function s2SetDarkResolvesTheDarkBlock(): Promise<void> {
  const { useThemeStore, currentRoles } = await freshStore("light");
  currentRoles();
  useThemeStore.getState().setTheme("dark");
  expect(currentRoles().surface).toBe(DARK_SURFACE);
}

export async function s3SetLightWritesLight(): Promise<void> {
  const { useThemeStore } = await freshStore("dark");
  useThemeStore.getState().setTheme("light");
  expect(localStorage.getItem("bms.theme")).toBe("light");
}

export async function s4AThrowingStorageStillFlipsTheAttribute(): Promise<void> {
  const { useThemeStore } = await freshStore("light");
  throwingStorage();
  // Called bare: a throw that escapes setTheme fails the case.
  useThemeStore.getState().setTheme("dark");
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
}

export async function s4AThrowingStorageStillFlipsTheRoles(): Promise<void> {
  const { useThemeStore, currentRoles } = await freshStore("light");
  throwingStorage();
  // Called bare: a throw that escapes setTheme fails the case.
  useThemeStore.getState().setTheme("dark");
  expect(currentRoles().surface).toBe(DARK_SURFACE);
}

export async function h1UseThemeRolesRerendersWithTheDarkBlock(): Promise<void> {
  const { useThemeStore, useThemeRoles } = await freshStore("light");
  const { result } = renderHook(() => useThemeRoles());
  act(() => useThemeStore.getState().setTheme("dark"));
  expect(result.current.accent).toBe("rgb(61, 205, 88)");
}

export async function h2UseThemeFollowsSetTheme(): Promise<void> {
  const { useThemeStore, useTheme } = await freshStore("light");
  const { result } = renderHook(() => useTheme());
  act(() => useThemeStore.getState().setTheme("dark"));
  expect(result.current).toBe("dark");
}

export async function s4AThrowingStorageStillMovesTheStoreTheme(): Promise<void> {
  const { useThemeStore } = await freshStore("light");
  throwingStorage();
  useThemeStore.getState().setTheme("dark");
  expect(useThemeStore.getState().theme).toBe("dark");
}
