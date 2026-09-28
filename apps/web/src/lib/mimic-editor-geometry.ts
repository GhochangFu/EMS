import type { Box } from "./mimic-editor";

/**
 * `F3.32c` U6 — the editor canvas's pixel → grid arithmetic, kept pure so it is tested without a
 * layout engine (jsdom's `getBoundingClientRect()` answers zeros). The canvas measures its own
 * rendered rect and hands it in as numbers; nothing here reads the DOM — the
 * `dashboard-grid-geometry.ts` rule.
 *
 * The SVG keeps its aspect ratio (`xMidYMid meet`), so one cell renders at the SMALLER of the two
 * axis scales.
 */

export type RenderedRect = { readonly width: number; readonly height: number };

/** Rendered pixels per grid cell; `0` when the rect or the canvas is empty (no NaN, no Infinity). */
export function renderedCellPx(rect: RenderedRect, canvasW: number, canvasH: number): number {
  if (!(rect.width > 0) || !(rect.height > 0) || !(canvasW > 0) || !(canvasH > 0)) {
    return 0;
  }
  return Math.min(rect.width / canvasW, rect.height / canvasH);
}

/**
 * A pointer's movement in client pixels → whole grid cells, rounded. A zero scale (an unmeasured
 * canvas) moves nothing rather than dividing by zero.
 */
export function pointerToGrid(
  delta: { readonly dx: number; readonly dy: number },
  rect: RenderedRect,
  canvasW: number,
  canvasH: number,
): { dx: number; dy: number } {
  const px = renderedCellPx(rect, canvasW, canvasH);
  if (px === 0 || !Number.isFinite(delta.dx) || !Number.isFinite(delta.dy)) {
    return { dx: 0, dy: 0 };
  }
  // `+ 0` turns a rounded `-0` into `0`.
  return { dx: Math.round(delta.dx / px) + 0, dy: Math.round(delta.dy / px) + 0 };
}

/** The box a drag proposes: `move` shifts the origin, `resize` grows it from its top-left corner. */
export function dragBox(origin: Box, cells: { readonly dx: number; readonly dy: number }, mode: "move" | "resize"): Box {
  return mode === "move"
    ? { x: origin.x + cells.dx, y: origin.y + cells.dy, w: origin.w, h: origin.h }
    : { x: origin.x, y: origin.y, w: origin.w + cells.dx, h: origin.h + cells.dy };
}
