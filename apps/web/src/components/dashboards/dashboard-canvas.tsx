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
 * (Unit 7) render widgets through. `DASHBOARD_GRID.columns` wide. The builder
 * has a fixed row height, since the canvas grows downward without a fixed row
 * count (the same reason `dashboard-grid-geometry.ts`'s own docblock gives for
 * not deriving one) and the drag maths needs one. Since the `F3.77` follow-up a
 * view canvas has no row height at all: its rows are auto tracks over the
 * compacted stored rows, so each band is as tall as its tallest content. Since
 * the `F3.73` critique fixes a view canvas also reflows at two container
 * breakpoints and gives a fixed-aspect tile (the mimic) a minimum height from
 * its aspect ratio (`canvasLayout`).
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

/**
 * The builder's row height. `measuredCellSize()` hands this fixed height to the drag and resize
 * maths, so the builder never takes the view canvas's auto rows.
 */
const ROW_HEIGHT_PX = 72;
const GAP_PX = 8;

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

/** A measured container width: a positive finite number. Anything else is no measurement. */
function isMeasuredWidth(containerWidth: number | null): containerWidth is number {
  return containerWidth !== null && Number.isFinite(containerWidth) && containerWidth > 0;
}

/**
 * A tile whose content draws at a fixed aspect ratio (the mimic): `ratio` is the drawing's
 * height over its width, and `chromePx` the frame's height round the drawing (padding and title).
 */
export type TileAspect = { readonly ratio: number; readonly chromePx: number };

/**
 * Where one tile sits: the CSS `grid-column` and `grid-row` values, and the minimum height in px
 * a fixed-aspect view tile needs (`null` for every other tile, for the builder, and before the
 * canvas is measured).
 */
export type TilePlacement<T extends CanvasTile> = {
  readonly tile: T;
  readonly gridColumn: string;
  readonly gridRow: string;
  readonly minHeightPx: number | null;
};

/** `gridAutoRows` is the CSS `grid-auto-rows` value: `"auto"` in view mode, 72 px in the builder. */
export type CanvasLayout<T extends CanvasTile> = {
  readonly gridAutoRows: string;
  readonly placements: readonly TilePlacement<T>[];
};

type ViewMode = "desktop" | "half" | "single";

function viewModeFor(containerWidth: number | null): ViewMode {
  if (!isMeasuredWidth(containerWidth)) {
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
 * The height in px a fixed-aspect tile needs: its drawing's height at the tile's pixel width,
 * plus the frame round it, rounded to a whole pixel.
 */
function aspectHeightPx(span: number, containerWidth: number, aspect: TileAspect): number {
  const tileWidth = span * columnWidthPx(containerWidth) + (span - 1) * GAP_PX;
  return Math.round(tileWidth * aspect.ratio + aspect.chromePx);
}

/**
 * `F3.77` follow-up — the stored rows, compacted to auto tracks. The sorted, distinct row
 * boundaries (each rect's top and bottom) cut the stored rows into intervals; an interval that
 * some rect covers is one track, and an interval no rect covers is dropped, because an empty auto
 * track still adds a gap. Returns each rect's CSS `grid-row`: its first track and the number of
 * tracks it spans.
 */
function compactRowTracks(rects: readonly GridRect[]): (rect: GridRect) => string {
  const boundaries = [...new Set(rects.flatMap((rect) => [rect.gridY, rect.gridY + rect.gridH]))].sort(
    (a, b) => a - b,
  );
  // The top boundary of every covered interval, in order: one per track.
  const trackTops: number[] = [];
  let top: number | null = null;
  for (const bottom of boundaries) {
    const from = top;
    if (from !== null && rects.some((rect) => rect.gridY <= from && rect.gridY + rect.gridH >= bottom)) {
      trackTops.push(from);
    }
    top = bottom;
  }
  const tracksAbove = (row: number): number => trackTops.filter((trackTop) => trackTop < row).length;
  return (rect) => {
    const first = tracksAbove(rect.gridY);
    const span = Math.max(1, tracksAbove(rect.gridY + rect.gridH) - first);
    return `${first + 1} / span ${span}`;
  };
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
 * Where every tile sits. Pure, so the breakpoints, the row tracks and the aspect heights are
 * tested without layout.
 *
 * - **The builder** (`arranging`): every tile at its stored, clamped rectangle, 72 px rows and
 *   no minimum height — the drag maths needs exactly what is stored.
 * - **A view canvas at desktop width** (or not yet measured): stored columns; the stored rows
 *   compacted to auto tracks (`compactRowTracks`), so a band is as tall as its tallest content
 *   and a shorter tile beside it stretches to the band. A tile with a reported aspect gets the
 *   height its drawing needs as a minimum height once the width is measured.
 * - **At or below a breakpoint**: the tiles are ordered by reading order (`gridY`, then `gridX`)
 *   and placed by CSS auto-flow with spans only (`grid-row: auto`), so a widened tile cannot
 *   overlap the next. A tile with an aspect gets the minimum height at its reflowed span.
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
    return {
      gridAutoRows: `${ROW_HEIGHT_PX}px`,
      placements: tiles.map((tile) => {
        const rect = clampWidget(tile);
        return {
          tile,
          gridColumn: `${rect.gridX + 1} / span ${rect.gridW}`,
          gridRow: `${rect.gridY + 1} / span ${rect.gridH}`,
          minHeightPx: null,
        };
      }),
    };
  }
  const mode = viewModeFor(containerWidth);
  const measured = isMeasuredWidth(containerWidth) ? containerWidth : null;
  const minHeightFor = (key: string, span: number): number | null => {
    const aspect = aspects.get(key);
    return measured !== null && isUsableAspect(aspect) ? aspectHeightPx(span, measured, aspect) : null;
  };

  if (mode !== "desktop") {
    const ordered = [...tiles].sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX);
    return {
      gridAutoRows: "auto",
      placements: ordered.map((tile) => {
        const span = spanFor(clampWidget(tile).gridW, mode);
        return { tile, gridColumn: `span ${span}`, gridRow: "auto", minHeightPx: minHeightFor(tile.key, span) };
      }),
    };
  }

  const clamped = tiles.map((tile) => ({ tile, rect: clampWidget(tile) }));
  const rowFor = compactRowTracks(clamped.map(({ rect }) => rect));
  return {
    gridAutoRows: "auto",
    placements: clamped.map(({ tile, rect }) => ({
      tile,
      gridColumn: `${rect.gridX + 1} / span ${rect.gridW}`,
      gridRow: rowFor(rect),
      minHeightPx: minHeightFor(tile.key, rect.gridW),
    })),
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
 * view canvas gives it the minimum height its drawing needs (`F3.77` follow-up; it was rows).
 * `null` reports nothing. Unmounting withdraws the report.
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
  // the desktop layout and gives no tile an aspect minimum height.
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
        gridAutoRows: layout.gridAutoRows,
        gap: `${GAP_PX}px`,
      }}
    >
      {layout.placements.map(({ tile, gridColumn, gridRow, minHeightPx }) => (
        // `[&>:first-child]:h-full` — the tile's own root fills the cell. `WidgetFrame` is already
        // `h-full`; `KpiTile` (a value tile) is not, and drew a dead band under its content.
        <div
          key={tile.key}
          data-canvas-tile={tile.key}
          className="relative min-w-0 [&>:first-child]:h-full"
          style={{ gridColumn, gridRow, minHeight: minHeightPx === null ? undefined : `${minHeightPx}px` }}
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
