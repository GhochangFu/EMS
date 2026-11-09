import { act, renderHook } from "@testing-library/react";
import { expect, vi } from "vitest";

/**
 * `F4.341` PR 4 (ADR 0118 decisions 4, 11, 12) — the design system on `<html>`. `setDesign` sets
 * `data-design` (the default, `nexus-soft`, removes it) and writes `bms.design`; `previewDesign`
 * moves the attribute only; `clearDesign` and sign-out remove both. `chartType()` follows the
 * attribute, so a chart re-reads its type tokens.
 *
 * `index.css` has no design-system block until PR 8, so a case that needs one adds a test-only
 * `<style>` with a `bento-ops` block that changes `--text-xs` only.
 */
async function freshStore() {
  document.documentElement.setAttribute("data-theme", "light");
  document.documentElement.removeAttribute("data-design");
  vi.resetModules();
  return import("./theme-store");
}

function addBentoStyle(): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = 'html[data-design="bento-ops"] { --text-xs: 0.8125rem; }';
  document.head.appendChild(style);
  return style;
}

export async function ds1SetDesignSetsTheAttributeAndTheKey(): Promise<void> {
  const { useThemeStore } = await freshStore();
  useThemeStore.getState().setDesign("swiss-grid");
  expect(document.documentElement.getAttribute("data-design")).toBe("swiss-grid");
  expect(localStorage.getItem("bms.design")).toBe("swiss-grid");
  expect(useThemeStore.getState().design).toBe("swiss-grid");
  useThemeStore.getState().setDesign("nexus-soft");
  expect(document.documentElement.hasAttribute("data-design")).toBe(false);
  expect(localStorage.getItem("bms.design")).toBeNull();
}

export async function ds2AThrowingStorageStillSetsTheAttribute(): Promise<void> {
  const { useThemeStore } = await freshStore();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("QuotaExceededError");
  });
  useThemeStore.getState().setDesign("bento-ops");
  expect(document.documentElement.getAttribute("data-design")).toBe("bento-ops");
}

export async function ds3PreviewMovesTheAttributeOnly(): Promise<void> {
  const { useThemeStore, previewDesign } = await freshStore();
  useThemeStore.getState().setDesign("enterprise-flat");
  previewDesign("control-room-dark");
  expect(document.documentElement.getAttribute("data-design")).toBe("control-room-dark");
  expect(localStorage.getItem("bms.design")).toBe("enterprise-flat");
  expect(useThemeStore.getState().design).toBe("enterprise-flat");
  previewDesign(null);
  expect(document.documentElement.getAttribute("data-design")).toBe("enterprise-flat");
}

export async function ds4ClearDesignAndSignOutRemoveBoth(): Promise<void> {
  const { useThemeStore, clearDesign } = await freshStore();
  useThemeStore.getState().setDesign("bento-ops");
  clearDesign();
  expect(document.documentElement.hasAttribute("data-design")).toBe(false);
  expect(localStorage.getItem("bms.design")).toBeNull();
  useThemeStore.getState().setDesign("swiss-grid");
  const { useAuthStore } = await import("./auth-store");
  useAuthStore.getState().clearSession();
  expect(document.documentElement.hasAttribute("data-design")).toBe(false);
  expect(localStorage.getItem("bms.design")).toBeNull();
}

export async function ds5ChartTypeFollowsTheDesignAndRolesReResolve(): Promise<void> {
  const style = addBentoStyle();
  try {
    const { useThemeStore, useThemeRoles } = await freshStore();
    const { chartType } = await import("../lib/design");
    expect(chartType().xs).toBe(12);
    const { result } = renderHook(() => useThemeRoles());
    const before = result.current;
    act(() => useThemeStore.getState().setDesign("bento-ops"));
    expect(chartType().xs).toBe(13);
    expect(result.current).not.toBe(before);
  } finally {
    style.remove();
  }
}

export async function ds6TheInitialDesignFollowsTheAttribute(): Promise<void> {
  document.documentElement.setAttribute("data-design", "control-room-dark");
  vi.resetModules();
  const { useThemeStore } = await import("./theme-store");
  expect(useThemeStore.getState().design).toBe("control-room-dark");
  document.documentElement.setAttribute("data-design", "glass-showcase");
  vi.resetModules();
  const again = await import("./theme-store");
  expect(again.useThemeStore.getState().design).toBe("nexus-soft");
}
