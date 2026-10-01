import { DASHBOARD_GRID } from "@bms/shared";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

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
 * one). Since the `F3.73` polish only the builder's rows are fixed; a view canvas's rows follow
 * its measured width (`viewRowHeightPx`).
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

/**
 * `F3.73` polish — a view canvas (no `onArrange`) sizes its rows from its measured width, so a
 * narrow site view does not draw tall, mostly empty tiles. The builder keeps `ROW_HEIGHT_PX`:
 * `measuredCellSize()` hands that fixed height to the drag and resize maths.
 *
 * `VIEW_ROW_MAX_PX` and `VIEW_ROW_FALLBACK_PX` are both 72 today, but they are two rules: the
 * cap bounds a measured row, and the fallback is the height with no measurement (jsdom, or a
 * browser before the first `ResizeObserver` callback).
 */
const VIEW_ROW_MIN_PX = 64;
const VIEW_ROW_MAX_PX = 72;
const VIEW_ROW_FALLBACK_PX = 72;
const VIEW_ROW_TO_COLUMN_RATIO = 0.55;

/**
 * A view canvas's row height for a measured container width:
 * `clamp(64, round(columnWidth * 0.55), 72)`, where `columnWidth` is one column after the gaps.
 * A width that is not a positive finite number is no measurement, and gives the fallback — a
 * zero width would otherwise clamp to the minimum.
 */
export function viewRowHeightPx(containerWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return VIEW_ROW_FALLBACK_PX;
  }
  const columns = DASHBOARD_GRID.columns;
  const columnWidth = (containerWidth - GAP_PX * (columns - 1)) / columns;
  const raw = Math.round(columnWidth * VIEW_ROW_TO_COLUMN_RATIO);
  return Math.min(VIEW_ROW_MAX_PX, Math.max(VIEW_ROW_MIN_PX, raw));
}

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
  const arranging = onArrange !== undefined;
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);

  // The canvas measures itself whether or not it arranges; the arranging exemption lives in one
  // place, `rowHeightPx` below. No `ResizeObserver` (jsdom) measures nothing, so the canvas keeps
  // the fallback height.
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width;
      if (width !== undefined) {
        setMeasuredWidth(width);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A null width is no measurement yet: `viewRowHeightPx` gives the fallback for it.
  const rowHeightPx = arranging ? ROW_HEIGHT_PX : viewRowHeightPx(measuredWidth ?? 0);

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
        gridAutoRows: `${rowHeightPx}px`,
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
                className="absolute left-1 top-1 z-10 cursor-move touch-none rounded border border-line-strong bg-surface/90 px-1 text-[10px] font-semibold leading-4 text-ink-muted"
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
                className="absolute bottom-1 right-1 z-10 h-3 w-3 cursor-se-resize touch-none rounded-sm border border-ink-hint bg-surface"
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
