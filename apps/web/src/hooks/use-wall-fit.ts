import { useLayoutEffect, useRef, useState, type RefObject } from "react";

import { settleWallZoom, WALL_ZOOM_FLOOR, wallBaseZoom, wallFitZoom } from "../lib/wall-mode";

export type WallFit = {
  /** The zoom to set inline on the wall's root (`style.zoom`). */
  readonly zoom: number;
  /**
   * `window.innerHeight` at the last measure, in viewport px. State, so a resize that leaves the
   * zoom alone still re-renders what depends on it (the fixed-aspect cap, owner ruling Q4).
   */
  readonly viewportHeight: number;
  /** The wall's top bar. */
  readonly barRef: RefObject<HTMLDivElement>;
  /** A block wrapper around the content, inside `<main>`, carrying the padding: its natural height. */
  readonly contentRef: RefObject<HTMLDivElement>;
};

/**
 * `F3.77` follow-up (plan D5, owner ruling Q2) — the wall's computed zoom: the base for the
 * screen's width (`wallBaseZoom`), reduced so the bar plus the content fit `window.innerHeight`
 * (`wallFitZoom`, floored at {@link WALL_ZOOM_FLOOR}; below it the page scrolls).
 *
 * The natural height is the two elements' `offsetHeight`, in unscaled CSS px, so it does not move
 * with the zoom itself. A zoom change still changes the content's width in CSS px, which can
 * re-wrap it and change its height: the `ResizeObserver` fires again, and the hook re-measures.
 * `settleWallZoom` ignores a growth under 0.05 (small jitter), and refuses any growth to the
 * **overflow ceiling** — the lowest zoom the content has been seen to overflow at, recorded here on
 * every shrink — so a re-wrap two-cycle of any size settles at the lower zoom (review finding).
 * React drops a state set to the same value, so a stable fit renders nothing more.
 *
 * The ceiling is cleared on a window `resize` (a new width wraps differently) and on a new
 * `resetKey` (the wall's tab: the frame does not remount on a rotation, and one tab's ceiling must
 * not hold the next tab's content below the base). Known limit: on a tab that never changes, a
 * content that shrinks later (fewer alarms) does not grow the zoom back past the ceiling until the
 * next tab or resize — the page then stays a little small; it never overflows.
 *
 * Measured in a layout effect, so the first paint already has the fitted zoom. Re-measured on a
 * content or bar resize, on a window `resize` and on a new `resetKey`. Without `ResizeObserver`
 * (jsdom) only the measures on mount, on a key and on the window listener run.
 */
export function useWallFit(resetKey: string | undefined): WallFit {
  const barRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(() => wallBaseZoom(window.innerWidth));
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight);
  // Mirrors of the applied zoom and the overflow ceiling, read and written outside a state
  // updater (React may call an updater twice; the ceiling must be written once per measure).
  const zoomRef = useRef(zoom);
  const ceilingRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    ceilingRef.current = null;
    const measure = () => {
      setViewportHeight(window.innerHeight);
      const bar = barRef.current;
      const content = contentRef.current;
      const naturalPx = bar === null || content === null ? Number.NaN : bar.offsetHeight + content.offsetHeight;
      const target = wallFitZoom({
        base: wallBaseZoom(window.innerWidth),
        viewportHeight: window.innerHeight,
        naturalPx,
        floor: WALL_ZOOM_FLOOR,
      });
      const current = zoomRef.current;
      const next = settleWallZoom(current, target, ceilingRef.current);
      if (next < current) {
        // The zoom being left is the one that overflowed.
        ceilingRef.current = Math.min(ceilingRef.current ?? Number.POSITIVE_INFINITY, current);
      }
      zoomRef.current = next;
      setZoom(next);
    };
    const onWindowResize = () => {
      ceilingRef.current = null;
      measure();
    };

    measure();
    window.addEventListener("resize", onWindowResize);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    for (const element of [barRef.current, contentRef.current]) {
      if (element !== null) {
        observer?.observe(element);
      }
    }
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", onWindowResize);
    };
  }, [resetKey]);

  return { zoom, viewportHeight, barRef, contentRef };
}
