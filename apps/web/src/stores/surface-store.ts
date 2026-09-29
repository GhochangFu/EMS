import { create } from "zustand";

import { SURFACE_STORAGE_KEY, readDocumentSurface, type Surface } from "../lib/surface";

/**
 * `F3.71` — the user's Neumorphic / Flat choice (ADR 0085 decision 1), the twin of
 * `theme-store.ts` without its roles cache: a surface change repaints through CSS alone
 * (`index.css` keys every surface rule on `data-surface`), so nothing reads it from script.
 *
 * No `persist` middleware: the key is written by hand as the bare string `"neumorphic"` /
 * `"flat"`, the one format the boot script in `index.html` reads.
 */

type SurfaceState = {
  surface: Surface;
  setSurface: (surface: Surface) => void;
};

export const useSurfaceStore = create<SurfaceState>()((set) => ({
  surface: typeof document === "undefined" ? "neumorphic" : readDocumentSurface(),
  setSurface: (surface) => {
    // The attribute first: a storage that throws (private mode, quota) must still flip the page.
    document.documentElement.setAttribute("data-surface", surface);
    try {
      localStorage.setItem(SURFACE_STORAGE_KEY, surface);
    } catch {
      // The choice lasts for this page only; the boot script reads the default on the next load.
    }
    set({ surface });
  },
}));

/** The current surface style; a component re-renders when it changes. */
export function useSurface(): Surface {
  return useSurfaceStore((s) => s.surface);
}
