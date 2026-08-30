import { DASHBOARD_GRID } from "@bms/shared";
import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import {
  cellWidth,
  clampWidget,
  dragToGrid,
  resizeToGrid,
  type GridRect,
} from "../../lib/dashboard-grid-geometry";

/**
 * `F3.1d` — the CSS-grid canvas both the viewer (Unit 6) and the builder
 * (Unit 7) render widgets through. `DASHBOARD_GRID.columns` wide; a fixed row
 * height, since the canvas grows downward without a fixed row count (the same
 * reason `dashboard-grid-geometry.ts`'s own docblock gives for not deriving
 * one).
 *
 * `ROW_HEIGHT_PX` is a presentation constant, not a grid-axis bound — it never
 * appears beside a `gridX`/`gridY`/`gridW`/`gridH` token, so
 * `tests/f3.1d-grid-bounds-single-source.test.ts`'s scan does not apply to it.
 *
 * **Overlapping tiles are permitted, deliberately** (plan §4, the §9.4 stop
 * condition this row does not trip): `0050` allows two widgets on the same
 * cells, and this canvas draws them stacked rather than pushing either one
 * out of the way.
 */
export type CanvasTile = {
  readonly key: string;
  readonly gridX: number;
  readonly gridY: number;
  readonly gridW: number;
  readonly gridH: number;
};

const ROW_HEIGHT_PX = 72;
const GAP_PX = 8;

type DashboardCanvasProps<T extends CanvasTile> = {
  tiles: readonly T[];
  renderTile: (tile: T) => ReactNode;
  /**
   * Present only on the builder. When supplied, every tile gets a move handle
   * and a resize handle wired to `dragToGrid`/`resizeToGrid` (plan §4's
   * pointer layer). Absent, the canvas draws read-only — the viewer's whole
   * contract (ADR 0047 Amendment 4).
   *
   * **Verified only in the browser pass.** jsdom implements no layout —
   * `getBoundingClientRect()` returns zeros — so the pixel math this callback
   * depends on cannot be exercised by the suite (plan §4, §10.4).
   */
  onArrange?: (key: string, next: GridRect) => void;
};

type DragState = {
  key: string;
  origin: GridRect;
  startX: number;
  startY: number;
  mode: "move" | "resize";
};

/**
 * A CSS-grid canvas rendering one tile per row. Cell size is measured here,
 * from this element's own `getBoundingClientRect`, and handed to the pure
 * geometry as a plain pixel size — never the other way around
 * (`dashboard-grid-geometry.ts`'s own docblock: cell size is always an
 * argument, never a DOM read, inside the pure module).
 */
export function DashboardCanvas<T extends CanvasTile>({
  tiles,
  renderTile,
  onArrange,
}: DashboardCanvasProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<DragState | null>(null);

  function measuredCellSize(): { width: number; height: number } {
    const containerWidth = containerRef.current?.getBoundingClientRect().width ?? 0;
    return {
      width: cellWidth({ containerWidth, columns: DASHBOARD_GRID.columns }),
      height: ROW_HEIGHT_PX,
    };
  }

  function beginDrag(tile: CanvasTile, mode: "move" | "resize", event: ReactPointerEvent<HTMLButtonElement>): void {
    if (!onArrange) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      key: tile.key,
      origin: { gridX: tile.gridX, gridY: tile.gridY, gridW: tile.gridW, gridH: tile.gridH },
      startX: event.clientX,
      startY: event.clientY,
      mode,
    };
  }

  function onHandleMove(event: ReactPointerEvent<HTMLButtonElement>): void {
    const state = dragState.current;
    if (!state || !onArrange) {
      return;
    }
    const delta = { dx: event.clientX - state.startX, dy: event.clientY - state.startY };
    const cell = measuredCellSize();
    const next =
      state.mode === "move" ? dragToGrid(state.origin, delta, cell) : resizeToGrid(state.origin, delta, cell);
    onArrange(state.key, next);
  }

  function endDrag(): void {
    dragState.current = null;
  }

  return (
    <div
      ref={containerRef}
      className="relative grid"
      style={{
        gridTemplateColumns: `repeat(${DASHBOARD_GRID.columns}, minmax(0, 1fr))`,
        gridAutoRows: `${ROW_HEIGHT_PX}px`,
        gap: `${GAP_PX}px`,
      }}
    >
      {tiles.map((tile) => {
        const rect = clampWidget(tile);
        return (
          <div
            key={tile.key}
            className="relative min-w-0"
            style={{
              gridColumn: `${rect.gridX + 1} / span ${rect.gridW}`,
              gridRow: `${rect.gridY + 1} / span ${rect.gridH}`,
            }}
          >
            {renderTile(tile)}
            {onArrange ? (
              <button
                type="button"
                aria-label="Move widget"
                title="Drag to move"
                className="absolute left-1 top-1 z-10 cursor-move touch-none rounded border border-gray-300 bg-white/90 px-1 text-[10px] font-semibold leading-4 text-bms-muted"
                onPointerDown={(event) => beginDrag(tile, "move", event)}
                onPointerMove={onHandleMove}
                onPointerUp={endDrag}
              >
                {"⠇"}
              </button>
            ) : null}
            {onArrange ? (
              <button
                type="button"
                aria-label="Resize widget"
                title="Drag to resize"
                className="absolute bottom-1 right-1 z-10 h-3 w-3 cursor-se-resize touch-none rounded-sm border border-gray-400 bg-white"
                onPointerDown={(event) => beginDrag(tile, "resize", event)}
                onPointerMove={onHandleMove}
                onPointerUp={endDrag}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
