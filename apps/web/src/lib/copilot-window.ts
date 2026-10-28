/**
 * `F4.292` (ADR 0099 Amendment 9 E6) — the copilot dock's window sizes, as
 * pure functions: the clamp every stored or dragged size goes through, the
 * pointer drag on the left and top edges, and the arrow-key step.
 *
 * **Fail closed.** A `NaN` or infinite axis — a corrupt stored value, a
 * viewport read before layout — becomes the minimum, never `NaN` px: every
 * comparison with `NaN` is false, so a plain `Math.min`/`Math.max` chain would
 * pass it through.
 *
 * **Docked** (owner ruling P6: the docked width is the stored width, and it is
 * resizable). The docked panel pushes the page, so it may take the viewport
 * less {@link COPILOT_DOCKED_PAGE_MIN} px — a width stored on a wider screen
 * never pushes the page off this one.
 */

export type CopilotSize = { width: number; height: number };
export type CopilotViewport = { width: number; height: number };

export const COPILOT_MIN_WIDTH = 360;
export const COPILOT_MIN_HEIGHT = 420;
export const COPILOT_DEFAULT_SIZE: Readonly<CopilotSize> = { width: 380, height: 520 };
/**
 * Under 768 px the dock is a full-screen sheet (E6). Read from the viewport
 * width, not a media query: F3.65 R16 bans `matchMedia(` in web source.
 */
export const COPILOT_SHEET_MAX_WIDTH = 767;
/** One arrow-key press on a resize handle (owner ruling P6). */
export const COPILOT_RESIZE_STEP = 16;
/** The page width a docked panel always leaves. */
export const COPILOT_DOCKED_PAGE_MIN = 320;

/** The viewport a floating panel leaves: the `calc(100vw - 3rem)` × `calc(100vh - 8rem)` caps. */
export const COPILOT_FLOATING_INSET: Readonly<CopilotSize> = { width: 48, height: 128 };

export type CopilotEdge = "left" | "top";

function clampAxis(value: number, min: number, max: number): number {
  const upper = Number.isFinite(max) ? Math.max(min, max) : min;
  if (!Number.isFinite(value)) return min;
  return Math.min(upper, Math.max(min, value));
}

/** Each axis in `[minimum, bounds]`; a non-finite axis or bound gives the minimum. */
export function clampCopilotSize(size: CopilotSize, bounds: CopilotViewport): CopilotSize {
  return {
    width: clampAxis(size.width, COPILOT_MIN_WIDTH, bounds.width),
    height: clampAxis(size.height, COPILOT_MIN_HEIGHT, bounds.height),
  };
}

/**
 * The room a floating panel may take: the viewport less its `right-6` gap
 * on both sides (48 px) and its `bottom-28` offset plus a 16 px top gap
 * (128 px). A size past this would be drawn smaller than it is stored, and the
 * handle would not follow the pointer until the drag came back inside.
 */
export function floatingBounds(viewport: CopilotViewport): CopilotViewport {
  return { width: viewport.width - COPILOT_FLOATING_INSET.width, height: viewport.height - COPILOT_FLOATING_INSET.height };
}

/** The room a docked panel may take: the viewport less the page's own minimum width. */
export function dockedBounds(viewport: CopilotViewport): CopilotViewport {
  return { width: viewport.width - COPILOT_DOCKED_PAGE_MIN, height: viewport.height };
}

/** The docked panel's width (and the page's right padding) for a stored width. */
export function dockedWidth(width: number, viewport: CopilotViewport): number {
  return clampAxis(width, COPILOT_MIN_WIDTH, dockedBounds(viewport).width);
}

/**
 * The size during a drag. The handles sit on the left and top edges of a panel
 * anchored at the right and bottom, so a pointer moved left (or up) grows it.
 */
export function resizedSize(
  start: CopilotSize & { x: number; y: number },
  pointer: { x: number; y: number },
  edges: { left: boolean; top: boolean },
  bounds: CopilotViewport,
): CopilotSize {
  return clampCopilotSize(
    {
      width: edges.left ? start.width + (start.x - pointer.x) : start.width,
      height: edges.top ? start.height + (start.y - pointer.y) : start.height,
    },
    bounds,
  );
}

/**
 * The size after one arrow key on a focused handle: on the left edge
 * ArrowLeft grows and ArrowRight shrinks the width; on the top edge ArrowUp
 * grows and ArrowDown shrinks the height. Any other key answers `null`.
 */
export function steppedSize(size: CopilotSize, edge: CopilotEdge, key: string, bounds: CopilotViewport): CopilotSize | null {
  const grow = edge === "left" ? "ArrowLeft" : "ArrowUp";
  const shrink = edge === "left" ? "ArrowRight" : "ArrowDown";
  if (key !== grow && key !== shrink) return null;
  const delta = key === grow ? COPILOT_RESIZE_STEP : -COPILOT_RESIZE_STEP;
  return clampCopilotSize(
    edge === "left" ? { ...size, width: size.width + delta } : { ...size, height: size.height + delta },
    bounds,
  );
}
