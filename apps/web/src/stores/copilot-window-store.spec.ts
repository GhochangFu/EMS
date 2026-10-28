import { expect, vi } from "vitest";

import { clearCopilotSession } from "./copilot-store";
import {
  clearCopilotWindow,
  COPILOT_WINDOW_KEY,
  copilotPagePush,
  useCopilotWindowStore,
} from "./copilot-window-store";

/**
 * `F4.292` (ADR 0099 Amendment 9 E6; owner ruling P6) — the dock's window
 * store. Assertions live here; `copilot-window-store.test.ts` is the Vitest
 * entry point and carries the jsdom docblock (`persist` writes to
 * `localStorage`).
 */

const VIEWPORT = { width: 1280, height: 800 };
const SHOWN = { open: true, mode: "docked", width: 420, mounted: 1 } as const;

function stored(): { state: Record<string, unknown> } | null {
  const raw = window.localStorage.getItem(COPILOT_WINDOW_KEY);
  return raw === null ? null : (JSON.parse(raw) as { state: Record<string, unknown> });
}

/** A value as another tab, or an older bundle, wrote it; then the store reads it as on a reload. */
async function reloadWith(state: Record<string, unknown>): Promise<void> {
  window.localStorage.setItem(COPILOT_WINDOW_KEY, JSON.stringify({ state, version: 0 }));
  await useCopilotWindowStore.persist.rehydrate();
}

/** Mutation: remove `partialize` (the in-memory `mounted` count is written too). */
export function theStoredValueIsTheWindowOnly(): void {
  useCopilotWindowStore.getState().setOpen(true);
  expect(Object.keys(stored()?.state ?? {}).sort()).toEqual(["height", "mode", "open", "width"]);
}

/** Mutation: `partialize` leaves `mode` out. */
export async function aReloadReadsTheStoredMode(): Promise<void> {
  useCopilotWindowStore.getState().setMode("docked");
  const written = window.localStorage.getItem(COPILOT_WINDOW_KEY) ?? "";
  useCopilotWindowStore.setState({ mode: "floating" });
  window.localStorage.setItem(COPILOT_WINDOW_KEY, written);
  await useCopilotWindowStore.persist.rehydrate();
  expect(useCopilotWindowStore.getState().mode).toBe("docked");
}

/** Mutation: drop the `merge` guard (a plain shallow merge). */
export async function aStoredUnknownModeReadsBackFloating(): Promise<void> {
  await reloadWith({ open: true, mode: "huge", width: 400, height: 500 });
  expect(useCopilotWindowStore.getState().mode).toBe("floating");
}

/** Mutation: `isSize` accepts any value. */
export async function aStoredNonNumberWidthReadsBackTheDefault(): Promise<void> {
  await reloadWith({ open: true, mode: "docked", width: "wide", height: 500 });
  expect(useCopilotWindowStore.getState().width).toBe(380);
}

/** The adjacent positive: a valid stored size is kept. */
export async function aStoredValidSizeIsKept(): Promise<void> {
  await reloadWith({ open: true, mode: "docked", width: 640, height: 500 });
  expect(useCopilotWindowStore.getState().width).toBe(640);
}

/** Mutation: `resize` stores the size unclamped. */
export function aResizeIsClamped(): void {
  useCopilotWindowStore.getState().resize({ width: 100, height: 5000 }, VIEWPORT);
  expect(useCopilotWindowStore.getState()).toMatchObject({ width: 360, height: 800 });
}

/** Mutation: remove the `clearCopilotWindow()` call from `clearCopilotSession`. */
export function clearingTheSessionRemovesTheWindowKey(): void {
  useCopilotWindowStore.getState().setOpen(true);
  expect(stored()).not.toBeNull();
  clearCopilotSession();
  expect(window.localStorage.getItem(COPILOT_WINDOW_KEY)).toBeNull();
}

/** Mutation: `clearCopilotWindow` drops the `setState` reset (only the key goes). */
export function clearingTheSessionClosesThePanel(): void {
  useCopilotWindowStore.getState().setOpen(true);
  clearCopilotSession();
  expect(useCopilotWindowStore.getState().open).toBe(false);
}

/** Mutation: drop the `try`/`catch` around `localStorage.setItem`. */
export function aRefusedWriteStillOpensThePanel(): void {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("quota", "QuotaExceededError");
  });
  useCopilotWindowStore.getState().setOpen(true);
  expect(useCopilotWindowStore.getState().open).toBe(true);
}

/** Mutation: drop the `try`/`catch` around `localStorage.removeItem`. */
export function aRefusedRemoveStillClosesThePanel(): void {
  useCopilotWindowStore.getState().setOpen(true);
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new DOMException("denied", "SecurityError");
  });
  clearCopilotWindow();
  expect(useCopilotWindowStore.getState().open).toBe(false);
}

/** Mutation: the unmount returned by `mount` does not count down. */
export function anUnmountCountsTheDockOut(): void {
  const unmount = useCopilotWindowStore.getState().mount();
  expect(useCopilotWindowStore.getState().mounted).toBe(1);
  unmount();
  expect(useCopilotWindowStore.getState().mounted).toBe(0);
}

/** Mutation: `copilotPagePush` always answers 0. */
export function aShownDockedPanelPushesThePageByItsWidth(): void {
  expect(copilotPagePush(SHOWN, false, VIEWPORT)).toBe(420);
}

/** Critic (medium): a stored docked window with no dock mounted pushes nothing. Mutation: drop `mounted > 0`. */
export function noMountedDockPushesNothing(): void {
  expect(copilotPagePush({ ...SHOWN, mounted: 0 }, false, VIEWPORT)).toBe(0);
}

/** Mutation: drop `!sheet`. */
export function theSheetPushesNothing(): void {
  expect(copilotPagePush(SHOWN, true, VIEWPORT)).toBe(0);
}

/** Mutation: drop the `mode === "docked"` check. */
export function aFloatingPanelPushesNothing(): void {
  expect(copilotPagePush({ ...SHOWN, mode: "floating" }, false, VIEWPORT)).toBe(0);
}

/** Mutation: drop the `open` check. */
export function aClosedPanelPushesNothing(): void {
  expect(copilotPagePush({ ...SHOWN, open: false }, false, VIEWPORT)).toBe(0);
}

/** Critic (low): a width stored on a wider screen is clamped at read time. Mutation: push `state.width` raw. */
export function aStoredWidthWiderThanTheScreenIsClamped(): void {
  expect(copilotPagePush({ ...SHOWN, width: 1400 }, false, VIEWPORT)).toBe(960);
}
