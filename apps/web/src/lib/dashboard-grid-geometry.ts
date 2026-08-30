import { DASHBOARD_GRID } from "@bms/shared";

/**
 * The pure geometry behind the builder's two arrange affordances (`F3.1d`
 * §4): the four grid-number inputs and the pointer drag/resize layer both
 * end up calling `clampWidget`, so a widget cannot leave the canvas through
 * either route.
 *
 * **Cell size is always an argument, never a DOM read.** jsdom implements no
 * layout — `getBoundingClientRect()` returns zeros — so a module that reads
 * the canvas itself would be untestable by this suite. The pointer handlers
 * that measure a real cell size and call these functions live in the
 * component tree (`F3.1d` Unit 7) and are verified only in the browser pass
 * (plan §10.4); this file is verified here, in full, without one.
 *
 * Every bound comes from `DASHBOARD_GRID` (`@bms/shared/contracts/dashboard-builder.ts`)
 * rather than a restated literal — `tests/f3.1d-grid-bounds-single-source.test.ts`
 * fails a fifth site that names one.
 */

/** One widget's position and size, in grid units. */
export type GridRect = {
  readonly gridX: number;
  readonly gridY: number;
  readonly gridW: number;
  readonly gridH: number;
};

/** The pixel size of one grid cell — width from the measured canvas, height
 * from whatever fixed row height the canvas component uses. Neither is
 * computed here; both are supplied by the caller. */
export type GridCellSize = {
  readonly width: number;
  readonly height: number;
};

/** A pointer move, in pixels, since the drag or resize started. */
export type PixelDelta = {
  readonly dx: number;
  readonly dy: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The pixel width of one column, given the canvas' own measured width. The
 * row height is not derived here — the canvas is 12 columns wide but grows
 * downward without a fixed row count, so there is no analogous "columns" to
 * divide a container height by.
 */
export function cellWidth({
  containerWidth,
  columns,
}: {
  containerWidth: number;
  columns: number;
}): number {
  return columns > 0 ? containerWidth / columns : 0;
}

/**
 * Pulls a widget back onto the legal canvas — the single choke point both
 * `dragToGrid` and `resizeToGrid` route through, and the one place
 * `DASHBOARD_GRID`'s four numbers are read.
 *
 * Order matters: `gridW`/`gridH` are clamped first, because `gridX`'s own
 * upper bound (`columns - gridW`) depends on the clamped width, not the
 * requested one — a widget that asked to be too wide must still end up
 * flush with the right edge rather than pushed off it.
 *
 * `gridY` has a floor and no ceiling: `dashboardWidgetIdentitySchema`'s own
 * comment records why — a long dashboard is legitimate, so only "above the
 * top edge" is illegal.
 */
export function clampWidget(widget: GridRect): GridRect {
  const gridW = clamp(widget.gridW, DASHBOARD_GRID.minWidgetW, DASHBOARD_GRID.columns);
  const gridH = clamp(widget.gridH, DASHBOARD_GRID.minWidgetH, DASHBOARD_GRID.maxWidgetH);
  const gridX = clamp(widget.gridX, 0, DASHBOARD_GRID.columns - gridW);
  const gridY = Math.max(0, widget.gridY);
  return { gridX, gridY, gridW, gridH };
}

/**
 * A drag: the pixel delta moves `gridX`/`gridY` and leaves the size alone,
 * then the result is clamped. Rounding happens before clamping, so a drag
 * that lands a fraction of a cell past the edge still clamps to the edge
 * rather than to one cell short of it.
 */
export function dragToGrid(origin: GridRect, deltaPx: PixelDelta, cell: GridCellSize): GridRect {
  const dGridX = cell.width > 0 ? Math.round(deltaPx.dx / cell.width) : 0;
  const dGridY = cell.height > 0 ? Math.round(deltaPx.dy / cell.height) : 0;
  return clampWidget({
    gridX: origin.gridX + dGridX,
    gridY: origin.gridY + dGridY,
    gridW: origin.gridW,
    gridH: origin.gridH,
  });
}

/**
 * A resize from the bottom-right handle: the pixel delta moves `gridW`/
 * `gridH` and leaves the position alone, then the result is clamped —
 * which also re-clamps `gridX` if a widened widget would now overhang the
 * right edge (`clampWidget`'s own ordering note).
 */
export function resizeToGrid(origin: GridRect, deltaPx: PixelDelta, cell: GridCellSize): GridRect {
  const dGridW = cell.width > 0 ? Math.round(deltaPx.dx / cell.width) : 0;
  const dGridH = cell.height > 0 ? Math.round(deltaPx.dy / cell.height) : 0;
  return clampWidget({
    gridX: origin.gridX,
    gridY: origin.gridY,
    gridW: origin.gridW + dGridW,
    gridH: origin.gridH + dGridH,
  });
}
