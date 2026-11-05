import { act, renderHook } from "@testing-library/react";
import { expect, vi } from "vitest";

/**
 * `F4.310` PR C (ADR 0110 decision 4) — the colour profile on `<html>`. `setProfile` sets
 * `data-profile` (the default, `nexus`, removes it) and writes `bms.profile`; `clearProfile` (sign-out)
 * removes both. `currentRoles()` re-resolves when the profile changes, so a chart repaints.
 *
 * `index.css` has no profile block until PR D, so a case that needs one adds a test-only `<style>`
 * with an `ocean` light block that changes `--surface` only.
 */
const OCEAN_SURFACE = "rgb(1, 2, 3)";
const LIGHT_SURFACE = "rgb(255, 255, 255)";

async function freshStore() {
  document.documentElement.setAttribute("data-theme", "light");
  document.documentElement.removeAttribute("data-profile");
  vi.resetModules();
  return import("./theme-store");
}

export function addOceanStyle(): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = ':root[data-profile="ocean"]:not([data-theme="dark"]) { --surface: 1 2 3; }';
  document.head.appendChild(style);
  return style;
}

export async function cp1SetProfileSetsTheAttributeAndTheKey(): Promise<void> {
  const { useThemeStore } = await freshStore();
  useThemeStore.getState().setProfile("ocean");
  expect(document.documentElement.getAttribute("data-profile")).toBe("ocean");
  expect(localStorage.getItem("bms.profile")).toBe("ocean");
  expect(useThemeStore.getState().profile).toBe("ocean");
}

export async function cp2TheDefaultRemovesTheAttributeAndTheKey(): Promise<void> {
  const { useThemeStore } = await freshStore();
  useThemeStore.getState().setProfile("ocean");
  useThemeStore.getState().setProfile("nexus");
  expect(document.documentElement.hasAttribute("data-profile")).toBe(false);
  expect(localStorage.getItem("bms.profile")).toBeNull();
  expect(useThemeStore.getState().profile).toBe("nexus");
}

export async function cp3AThrowingStorageStillSetsTheAttribute(): Promise<void> {
  const { useThemeStore } = await freshStore();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("QuotaExceededError");
  });
  useThemeStore.getState().setProfile("lagoon");
  expect(document.documentElement.getAttribute("data-profile")).toBe("lagoon");
}

export async function cp4RolesReResolveWhenTheProfileChanges(): Promise<void> {
  const style = addOceanStyle();
  try {
    const { useThemeStore, currentRoles } = await freshStore();
    expect(currentRoles().surface).toBe(LIGHT_SURFACE);
    useThemeStore.getState().setProfile("ocean");
    expect(currentRoles().surface).toBe(OCEAN_SURFACE);
    useThemeStore.getState().setProfile("nexus");
    expect(currentRoles().surface).toBe(LIGHT_SURFACE);
  } finally {
    style.remove();
  }
}

export async function cp5ClearProfileRemovesBoth(): Promise<void> {
  const { useThemeStore, clearProfile } = await freshStore();
  useThemeStore.getState().setProfile("indigo");
  clearProfile();
  expect(document.documentElement.hasAttribute("data-profile")).toBe(false);
  expect(localStorage.getItem("bms.profile")).toBeNull();
  expect(useThemeStore.getState().profile).toBe("nexus");
}

export async function cp6UseThemeRolesReRendersOnAProfileChange(): Promise<void> {
  const style = addOceanStyle();
  try {
    const { useThemeStore, useThemeRoles } = await freshStore();
    const { result } = renderHook(() => useThemeRoles());
    expect(result.current.surface).toBe(LIGHT_SURFACE);
    act(() => useThemeStore.getState().setProfile("ocean"));
    expect(result.current.surface).toBe(OCEAN_SURFACE);
  } finally {
    style.remove();
  }
}

export async function cp7TheInitialProfileFollowsTheAttribute(): Promise<void> {
  document.documentElement.setAttribute("data-profile", "graphite");
  vi.resetModules();
  const { useThemeStore } = await import("./theme-store");
  expect(useThemeStore.getState().profile).toBe("graphite");
  document.documentElement.setAttribute("data-profile", "not-a-profile");
  vi.resetModules();
  const again = await import("./theme-store");
  expect(again.useThemeStore.getState().profile).toBe("nexus");
}
