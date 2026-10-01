import { DASHBOARD_GRID } from "@bms/shared";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

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
 * its measured width (`viewRowHeightPx`), and since the `F3.73` critique fixes a view canvas
 * also reflows at two container breakpoints and sizes a fixed-aspect tile (the mimic) from its
 * aspect ratio (`canvasLayout`).
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
 * `F3.73` polish, retuned by the critique fixes — a view canvas (no `onArrange`) sizes its rows
 * from its measured width. The builder keeps `ROW_HEIGHT_PX`: `measuredCellSize()` hands that
 * fixed height to the drag and resize maths.
 *
 * The constants are chosen for the widths that occur. The site view is capped at 1168 px, and a
 * full-width viewer on a 1650 px wall screen is the other end. The old `clamp(64, colW * 0.55, 72)`
 * gave 64 px at every width up to ~1590 px, so it did not follow the width. With `0.75`, 1168 px
 * gives 68 px rows and 1650 px gives the 84 px cap. The 64 px floor keeps a two-row value tile at
 * 2 * 64 + 8 = 136 px, above the 132 px its content needs. The cap keeps a wall screen from
 * drawing tall, mostly empty tiles.
 *
 * `VIEW_ROW_FALLBACK_PX` is the height with no measurement (jsdom, or a browser before the first
 * `ResizeObserver` callback). It is a separate rule from the cap and the floor.
 */
const VIEW_ROW_MIN_PX = 64;
const VIEW_ROW_MAX_PX = 84;
const VIEW_ROW_FALLBACK_PX = 72;
const VIEW_ROW_TO_COLUMN_RATIO = 0.75;

/**
 * `F3.73` critique fixes — the two view-mode breakpoints, on the canvas's measured width (not a
 * media query), so the viewer and the site view, which give the canvas different widths in one
 * window, behave the same. At or below `HALF_BREAKPOINT_PX` a tile spans half the grid or all of
 * it; at or below `SINGLE_BREAKPOINT_PX` every tile spans the whole grid.
 */
export const HALF_BREAKPOINT_PX = 1024;
export const SINGLE_BREAKPOINT_PX = 640;

/** One column's width after the gaps, for a container width. */
function columnWidthPx(containerWidth: number): number {
  const columns = DASHBOARD_GRID.columns;
  return (containerWidth - GAP_PX * (columns - 1)) / columns;
}

/**
 * A view canvas's row height for a measured container width:
 * `clamp(64, round(columnWidth * 0.75), 84)`, where `columnWidth` is one column after the gaps.
 * A width that is not a positive finite number is no measurement, and gives the fallback — a
 * zero width would otherwise clamp to the minimum.
 */
export function viewRowHeightPx(containerWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return VIEW_ROW_FALLBACK_PX;
  }
  const raw = Math.round(columnWidthPx(containerWidth) * VIEW_ROW_TO_COLUMN_RATIO);
  return Math.min(VIEW_ROW_MAX_PX, Math.max(VIEW_ROW_MIN_PX, raw));
}

/**
 * A tile whose content draws at a fixed aspect ratio (the mimic): `ratio` is the drawing's
 * height over its width, and `chromePx` the frame's height round the drawing (padding and title).
 */
export type TileAspect = { readonly ratio: number; readonly chromePx: number };

/** Where one tile sits: the CSS `grid-column` and `grid-row` values. */
export type TilePlacement<T extends CanvasTile> = {
  readonly tile: T;
  readonly gridColumn: string;
  readonly gridRow: string;
};

export type CanvasLayout<T extends CanvasTile> = {
  readonly rowHeightPx: number;
  readonly placements: readonly TilePlacement<T>[];
};

type ViewMode = "desktop" | "half" | "single";

function viewModeFor(containerWidth: number | null): ViewMode {
  if (containerWidth === null || !Number.isFinite(containerWidth) || containerWidth <= 0) {
    return "desktop";
  }
  if (containerWidth <= SINGLE_BREAKPOINT_PX) {
    return "single";
  }
  return containerWidth <= HALF_BREAKPOINT_PX ? "half" : "desktop";
}

/** A tile's column span in a view mode: as stored, half the grid or all of it, or all of it. */
function spanFor(storedSpan: number, mode: ViewMode): number {
  const columns = DASHBOARD_GRID.columns;
  const half = columns / 2;
  if (mode === "single") {
    return columns;
  }
  if (mode === "half") {
    return storedSpan <= half ? half : columns;
  }
  return storedSpan;
}

/**
 * The rows a fixed-aspect tile needs: its drawing's height at the tile's pixel width, plus the
 * frame round it, rounded up to whole rows (each row after the first adds one gap).
 */
function aspectRowSpan(span: number, containerWidth: number, rowHeightPx: number, aspect: TileAspect): number {
  const tileWidth = span * columnWidthPx(containerWidth) + (span - 1) * GAP_PX;
  const contentHeight = tileWidth * aspect.ratio + aspect.chromePx;
  return Math.max(1, Math.ceil((contentHeight + GAP_PX) / (rowHeightPx + GAP_PX)));
}

function isUsableAspect(aspect: TileAspect | undefined): aspect is TileAspect {
  return (
    aspect !== undefined &&
    Number.isFinite(aspect.ratio) &&
    aspect.ratio > 0 &&
    Number.isFinite(aspect.chromePx) &&
    aspect.chromePx >= 0
  );
}

/**
 * Where every tile sits. Pure, so the breakpoints and the aspect rows are tested without layout.
 *
 * - **The builder** (`arranging`): every tile at its stored, clamped rectangle, 72 px rows — the
 *   drag maths needs exactly what is stored.
 * - **A view canvas at desktop width** (or not yet measured): stored columns and rows. A tile
 *   with a reported aspect takes the rows its drawing needs when that is MORE than stored, and
 *   every tile that starts at or below its old bottom moves down by the difference, so nothing
 *   overlaps. It never shrinks below its stored rows: moving tiles up could overlap a tile beside
 *   it, so a too-tall stored height keeps its centred drawing and its spare space.
 * - **At or below a breakpoint**: the tiles are ordered by reading order (`gridY`, then `gridX`)
 *   and placed by CSS auto-flow with spans only, so a widened tile cannot overlap the next. A
 *   tile with an aspect takes exactly the rows its drawing needs.
 */
export function canvasLayout<T extends CanvasTile>(
  tiles: readonly T[],
  options: {
    readonly arranging: boolean;
    readonly containerWidth: number | null;
    readonly aspects?: ReadonlyMap<string, TileAspect>;
  },
): CanvasLayout<T> {
  const { arranging, containerWidth } = options;
  const aspects = options.aspects ?? new Map<string, TileAspect>();
  if (arranging) {
    return { rowHeightPx: ROW_HEIGHT_PX, placements: tiles.map((tile) => explicitPlacement(tile, 0, null)) };
  }
  const rowHeightPx = viewRowHeightPx(containerWidth ?? 0);
  const mode = viewModeFor(containerWidth);
  const measured = mode === "desktop" ? null : containerWidth;

  if (mode !== "desktop" && measured !== null) {
    const ordered = [...tiles].sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX);
    return {
      rowHeightPx,
      placements: ordered.map((tile) => {
        const rect = clampWidget(tile);
        const span = spanFor(rect.gridW, mode);
        const aspect = aspects.get(tile.key);
        const rows = isUsableAspect(aspect) ? aspectRowSpan(span, measured, rowHeightPx, aspect) : rect.gridH;
        return { tile, gridColumn: `span ${span}`, gridRow: `span ${rows}` };
      }),
    };
  }

  // Desktop: the rows each fixed-aspect tile grows by, keyed on its stored bottom row.
  const growths: { bottom: number; by: number }[] = [];
  const rowsByKey = new Map<string, number>();
  if (containerWidth !== null && Number.isFinite(containerWidth) && containerWidth > 0) {
    for (const tile of tiles) {
      const aspect = aspects.get(tile.key);
      if (!isUsableAspect(aspect)) {
        continue;
      }
      const rect = clampWidget(tile);
      const rows = aspectRowSpan(rect.gridW, containerWidth, rowHeightPx, aspect);
      if (rows > rect.gridH) {
        rowsByKey.set(tile.key, rows);
        growths.push({ bottom: rect.gridY + rect.gridH, by: rows - rect.gridH });
      }
    }
  }
  return {
    rowHeightPx,
    placements: tiles.map((tile) => {
      const rect = clampWidget(tile);
      // The sum of every growth above this tile: a tile below two grown tiles moves past both.
      const shift = growths.reduce((sum, growth) => (rect.gridY >= growth.bottom ? sum + growth.by : sum), 0);
      return explicitPlacement(tile, shift, rowsByKey.get(tile.key) ?? null);
    }),
  };
}

function explicitPlacement<T extends CanvasTile>(tile: T, shift: number, rows: number | null): TilePlacement<T> {
  const rect = clampWidget(tile);
  return {
    tile,
    gridColumn: `${rect.gridX + 1} / span ${rect.gridW}`,
    gridRow: `${rect.gridY + shift + 1} / span ${rows ?? rect.gridH}`,
  };
}

/**
 * How a tile's content reports its aspect to the canvas it sits in. The canvas gives each tile
 * its own reporter; outside a canvas the default reports to nobody.
 */
const CanvasTileAspectContext = createContext<(aspect: TileAspect | null) => void>(() => {});

/** The provider a host (or a spec) wraps a tile in to receive its aspect. */
export const CanvasTileAspectProvider = CanvasTileAspectContext.Provider;

/**
 * `F3.73` critique fixes — a tile whose content draws at a fixed aspect ratio calls this, so a
 * view canvas gives it the rows its drawing needs. `null` reports nothing. Unmounting withdraws
 * the report.
 */
export function useCanvasTileAspect(aspect: TileAspect | null): void {
  const report = useContext(CanvasTileAspectContext);
  const ratio = aspect?.ratio ?? null;
  const chromePx = aspect?.chromePx ?? null;
  useLayoutEffect(() => {
    report(ratio === null || chromePx === null ? null : { ratio, chromePx });
    return () => report(null);
  }, [report, ratio, chromePx]);
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
  const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null);
  const [aspects, setAspects] = useState<ReadonlyMap<string, TileAspect>>(() => new Map());
  const reporters = useRef(new Map<string, (aspect: TileAspect | null) => void>());

  // `F3.73` critique fixes — a callback ref, so every root element this canvas mounts is
  // observed, not only the one present on the first effect run.
  const attachRoot = useCallback((element: HTMLDivElement | null) => {
    containerRef.current = element;
    setRootElement(element);
  }, []);

  // The canvas measures itself whether or not it arranges; the arranging exemption lives in one
  // place, `canvasLayout`. No `ResizeObserver` (jsdom) measures nothing, so the canvas keeps
  // the fallback height and the desktop layout.
  useEffect(() => {
    if (!rootElement || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width;
      if (width !== undefined) {
        setMeasuredWidth(width);
      }
    });
    observer.observe(rootElement);
    return () => observer.disconnect();
  }, [rootElement]);

  /** One stable reporter per tile key, so a tile's layout effect does not re-run each render. */
  function reporterFor(key: string): (aspect: TileAspect | null) => void {
    const existing = reporters.current.get(key);
    if (existing) {
      return existing;
    }
    const reporter = (aspect: TileAspect | null) => {
      setAspects((previous) => {
        const current = previous.get(key);
        const same =
          aspect === null
            ? current === undefined
            : current !== undefined && current.ratio === aspect.ratio && current.chromePx === aspect.chromePx;
        if (same) {
          return previous;
        }
        const next = new Map(previous);
        if (aspect === null) {
          next.delete(key);
        } else {
          next.set(key, aspect);
        }
        return next;
      });
    };
    reporters.current.set(key, reporter);
    return reporter;
  }

  const layout = canvasLayout(tiles, { arranging, containerWidth: measuredWidth, aspects });

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
      ref={attachRoot}
      className="relative grid"
      style={{
        gridTemplateColumns: `repeat(${DASHBOARD_GRID.columns}, minmax(0, 1fr))`,
        gridAutoRows: `${layout.rowHeightPx}px`,
        gap: `${GAP_PX}px`,
      }}
    >
      {layout.placements.map(({ tile, gridColumn, gridRow }) => (
        // `[&>:first-child]:h-full` — the tile's own root fills the cell. `WidgetFrame` is already
        // `h-full`; `KpiTile` (a value tile) is not, and drew a dead band under its content.
        <div
          key={tile.key}
          data-canvas-tile={tile.key}
          className="relative min-w-0 [&>:first-child]:h-full"
          style={{ gridColumn, gridRow }}
        >
          <CanvasTileAspectProvider value={reporterFor(tile.key)}>{renderTile(tile)}</CanvasTileAspectProvider>
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
      ))}
    </div>
  );
}
