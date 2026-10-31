import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

import {
  clampCopilotSize,
  COPILOT_DEFAULT_SIZE,
  dockedWidth,
  type CopilotSize,
  type CopilotViewport,
} from "../lib/copilot-window";

/**
 * `F4.292` (ADR 0099 Amendment 9 E6; owner ruling P6) — the copilot dock's
 * window: whether it is open, its mode, and its size.
 *
 * **Persisted per browser, cleared with the session.** The four fields live in
 * `localStorage` under {@link COPILOT_WINDOW_KEY}, beside the session key
 * `bms-copilot-session`. {@link clearCopilotWindow} removes it, and
 * `clearCopilotSession` calls it, so every session exit that clears the
 * conversation (logout, a 401, JWT expiry, a failed `/me`, another user)
 * closes the panel and forgets its mode and size. The open flag moved here
 * from the bare `bms-copilot-open` key, which no exit cleared, because
 * `AppShell` reads "open and docked" to push the page. The key names no
 * owner (accepted at review): a second tab still signed in as the user who
 * left can write it back, and the next user then gets that window — an open
 * flag, a mode and a size, nothing from the conversation.
 *
 * **Storage is optional.** Every read and write is guarded: a browser that
 * refuses `localStorage` (a private mode, a full quota, a policy) only loses
 * the remembered window; the dock works in memory.
 *
 * **Fail closed.** A stored `mode` outside the three, a non-boolean `open` or
 * a non-number size reads back as the default.
 *
 * **Docked width = the stored width** (owner ruling P6), resizable from the
 * left edge. The page is pushed by {@link copilotPagePush} only while a dock
 * is actually mounted ({@link mountCopilotDock}): with the copilot turned off
 * the dock renders nothing, and a stored docked window must not leave an empty
 * gutter with no Close to clear it. The count is a store of its own, never
 * persisted: `persist` writes the key on every `set`, so a count kept here
 * would write it back when a sign-out unmounts the dock after the clear.
 */

export const COPILOT_WINDOW_KEY = "bms-copilot-window";

export const COPILOT_WINDOW_MODES = ["floating", "maximized", "docked"] as const;
export type CopilotWindowMode = (typeof COPILOT_WINDOW_MODES)[number];

type CopilotWindowFields = { open: boolean; mode: CopilotWindowMode; width: number; height: number };

type CopilotWindowState = CopilotWindowFields & {
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setMode: (mode: CopilotWindowMode) => void;
  /** Stores a size, clamped to `bounds`. */
  resize: (size: CopilotSize, bounds: CopilotViewport) => void;
};

const DEFAULTS: CopilotWindowFields = {
  open: false,
  mode: "floating",
  width: COPILOT_DEFAULT_SIZE.width,
  height: COPILOT_DEFAULT_SIZE.height,
};

const isMode = (value: unknown): value is CopilotWindowMode =>
  typeof value === "string" && (COPILOT_WINDOW_MODES as readonly string[]).includes(value);
const isSize = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** The stored fields that pass their check; any other goes back to the default. */
export function storedWindow(persisted: unknown): CopilotWindowFields {
  const p = (typeof persisted === "object" && persisted !== null ? persisted : {}) as Record<string, unknown>;
  return {
    open: typeof p.open === "boolean" ? p.open : DEFAULTS.open,
    mode: isMode(p.mode) ? p.mode : DEFAULTS.mode,
    width: isSize(p.width) ? p.width : DEFAULTS.width,
    height: isSize(p.height) ? p.height : DEFAULTS.height,
  };
}

/** `localStorage`, every call guarded: a refused storage costs only the remembered window. */
const guardedLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // Not remembered; the window still works in memory.
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name);
    } catch {
      // Nothing stored that could be removed.
    }
  },
};

export const useCopilotWindowStore = create<CopilotWindowState>()(
  persist(
    (set, get) => ({
      ...DEFAULTS,
      setOpen: (open) => set({ open }),
      toggle: () => set({ open: !get().open }),
      setMode: (mode) => set({ mode }),
      resize: (size, bounds) => set(clampCopilotSize(size, bounds)),
    }),
    {
      name: COPILOT_WINDOW_KEY,
      storage: createJSONStorage(() => guardedLocalStorage),
      partialize: (state): CopilotWindowFields => ({
        open: state.open,
        mode: state.mode,
        width: state.width,
        height: state.height,
      }),
      merge: (persisted, current) => ({ ...current, ...storedWindow(persisted) }),
    },
  ),
);

/** How many docks are mounted now. In memory only: a separate store, so a mount writes no key. */
export const useCopilotDockMountStore = create<{ mounted: number }>()(() => ({ mounted: 0 }));

/** Counts a mounted dock; returns the unmount (an effect's cleanup). */
export function mountCopilotDock(): () => void {
  useCopilotDockMountStore.setState((s) => ({ mounted: s.mounted + 1 }));
  return () => useCopilotDockMountStore.setState((s) => ({ mounted: Math.max(0, s.mounted - 1) }));
}

/** Closes the panel, forgets its mode and size, and removes the stored key. The mount count is kept. */
export function clearCopilotWindow(): void {
  useCopilotWindowStore.setState({ ...DEFAULTS });
  useCopilotWindowStore.persist.clearStorage();
}

/** The page's right padding: the docked panel's width while it shows, else 0. */
export function copilotPagePush(
  state: Pick<CopilotWindowState, "open" | "mode" | "width"> & { mounted: number },
  sheet: boolean,
  viewport: CopilotViewport,
): number {
  return state.open && state.mode === "docked" && !sheet && state.mounted > 0 ? dockedWidth(state.width, viewport) : 0;
}

/** {@link copilotPagePush} for the current store. */
export function useCopilotPagePush(sheet: boolean, viewport: CopilotViewport): number {
  const open = useCopilotWindowStore((s) => s.open);
  const mode = useCopilotWindowStore((s) => s.mode);
  const width = useCopilotWindowStore((s) => s.width);
  const mounted = useCopilotDockMountStore((s) => s.mounted);
  return copilotPagePush({ open, mode, width, mounted }, sheet, viewport);
}
