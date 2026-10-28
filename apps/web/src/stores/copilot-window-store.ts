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
 * **Persisted per user, cleared with the session.** The four fields live in
 * `localStorage` under {@link COPILOT_WINDOW_KEY}, beside the session key
 * `bms-copilot-session`. {@link clearCopilotWindow} removes it, and
 * `clearCopilotSession` calls it, so every session exit that clears the
 * conversation (logout, a 401, JWT expiry, a failed `/me`, another user)
 * closes the panel and forgets its mode and size. The open flag moved here
 * from the bare `bms-copilot-open` key, which no exit cleared, because
 * `AppShell` reads "open and docked" to push the page.
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
 * is actually mounted (`mounted`, in memory): with the copilot turned off the
 * dock renders nothing, and a stored docked window must not leave an empty
 * gutter with no Close to clear it.
 */

export const COPILOT_WINDOW_KEY = "bms-copilot-window";

export const COPILOT_WINDOW_MODES = ["floating", "maximized", "docked"] as const;
export type CopilotWindowMode = (typeof COPILOT_WINDOW_MODES)[number];

type CopilotWindowFields = { open: boolean; mode: CopilotWindowMode; width: number; height: number };

type CopilotWindowState = CopilotWindowFields & {
  /** How many docks are mounted now; in memory only. */
  mounted: number;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setMode: (mode: CopilotWindowMode) => void;
  /** Stores a size, clamped to `bounds`. */
  resize: (size: CopilotSize, bounds: CopilotViewport) => void;
  /** Counts a mounted dock; returns the unmount (an effect's cleanup). */
  mount: () => () => void;
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
      mounted: 0,
      setOpen: (open) => set({ open }),
      toggle: () => set({ open: !get().open }),
      setMode: (mode) => set({ mode }),
      resize: (size, bounds) => set(clampCopilotSize(size, bounds)),
      mount: () => {
        set({ mounted: get().mounted + 1 });
        return () => set({ mounted: Math.max(0, get().mounted - 1) });
      },
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

/** Closes the panel, forgets its mode and size, and removes the stored key. `mounted` is kept. */
export function clearCopilotWindow(): void {
  useCopilotWindowStore.setState({ ...DEFAULTS });
  useCopilotWindowStore.persist.clearStorage();
}

/** The page's right padding: the docked panel's width while it shows, else 0. */
export function copilotPagePush(
  state: Pick<CopilotWindowState, "open" | "mode" | "width" | "mounted">,
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
  const mounted = useCopilotWindowStore((s) => s.mounted);
  return copilotPagePush({ open, mode, width, mounted }, sheet, viewport);
}
