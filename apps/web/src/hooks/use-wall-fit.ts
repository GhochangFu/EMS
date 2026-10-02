import { useLayoutEffect, useRef, useState, type RefObject } from "react";

import { settleWallZoom, WALL_ZOOM_FLOOR, wallBaseZoom, wallFitZoom } from "../lib/wall-mode";

export type WallFit = {
  /** The zoom to set inline on the wall's root (`style.zoom`). */
  readonly zoom: number;
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
 * `settleWallZoom` ignores a growth under 0.05, so that two-cycle damps, and React drops a state
 * set to the same value, so a stable fit renders nothing more.
 *
 * Measured in a layout effect, so the first paint already has the fitted zoom. Re-measured on a
 * content or bar resize and on a window `resize`. Without `ResizeObserver` (jsdom) only the first
 * measure and the window listener run.
 */
export function useWallFit(): WallFit {
  const barRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(() => wallBaseZoom(window.innerWidth));

  useLayoutEffect(() => {
    const measure = () => {
      const bar = barRef.current;
      const content = contentRef.current;
      const naturalPx = bar === null || content === null ? Number.NaN : bar.offsetHeight + content.offsetHeight;
      const target = wallFitZoom({
        base: wallBaseZoom(window.innerWidth),
        viewportHeight: window.innerHeight,
        naturalPx,
        floor: WALL_ZOOM_FLOOR,
      });
      setZoom((current) => settleWallZoom(current, target));
    };

    measure();
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    for (const element of [barRef.current, contentRef.current]) {
      if (element !== null) {
        observer?.observe(element);
      }
    }
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return { zoom, barRef, contentRef };
}
