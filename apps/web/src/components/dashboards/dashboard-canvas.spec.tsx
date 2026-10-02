import { act, cleanup, render } from "@testing-library/react";
import { expect, vi } from "vitest";

import {
  canvasLayout,
  DashboardCanvas,
  useCanvasTileAspect,
  type CanvasTile,
  type TileAspect,
} from "./dashboard-canvas";

/**
 * `F3.73` polish and critique fixes, and the `F3.77` follow-up — a view canvas's rows are auto
 * tracks over the compacted stored rows, so each band is as tall as its content; the builder
 * keeps its fixed 72 px rows and the stored rectangles. A view canvas reflows at two width
 * breakpoints and gives a fixed-aspect tile a minimum height from its aspect. jsdom implements no
 * layout, so a fake `ResizeObserver` hands the canvas a width, and each case reads the grid's
 * styles back; the placement rules are also driven through the pure `canvasLayout`.
 */

const TILE: CanvasTile = { key: "w1", gridX: 0, gridY: 0, gridW: 4, gridH: 2 };

type ObserverCallback = (entries: { contentRect: { width: number }; target: Element }[]) => void;

type FakeObserver = { callback: ObserverCallback; targets: Set<Element> };

let observers: FakeObserver[] = [];

/**
 * Installs a `ResizeObserver` that records what each instance observes, so a width reaches only
 * an observer watching an element still in the document — as a real one would.
 */
export function installFakeResizeObserver(): void {
  observers = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private readonly record: FakeObserver;
      constructor(callback: ObserverCallback) {
        this.record = { callback, targets: new Set() };
        observers.push(this.record);
      }
      observe(target: Element): void {
        this.record.targets.add(target);
      }
      unobserve(target: Element): void {
        this.record.targets.delete(target);
      }
      disconnect(): void {
        this.record.targets.clear();
      }
    },
  );
}

/** Removes `ResizeObserver` from the global scope (jsdom has none; this pins it). */
export function removeResizeObserver(): void {
  observers = [];
  vi.stubGlobal("ResizeObserver", undefined);
}

export function cleanupCanvas(): void {
  cleanup();
  vi.unstubAllGlobals();
}

function fireWidth(width: number): void {
  act(() => {
    for (const observer of observers) {
      for (const target of observer.targets) {
        if (target.isConnected) {
          observer.callback([{ contentRect: { width }, target }]);
        }
      }
    }
  });
}

function renderCanvas(onArrange?: () => void): HTMLElement {
  const { container } = render(
    <DashboardCanvas tiles={[TILE]} renderTile={() => <div />} onArrange={onArrange} />,
  );
  return container.firstElementChild as HTMLElement;
}

/** `F3.77` follow-up — a measured 1168 px view canvas (the site view's cap) sizes its rows to content. */
export function measured1168PxViewRowsAreAuto(): void {
  const grid = renderCanvas();
  expect(observers.length).toBeGreaterThan(0);
  fireWidth(1168);
  expect(grid.style.gridAutoRows).toBe("auto");
}

/** A measured 1650 px view canvas (a wall screen) also sizes its rows to content. */
export function measured1650PxViewRowsAreAuto(): void {
  const grid = renderCanvas();
  fireWidth(1650);
  expect(grid.style.gridAutoRows).toBe("auto");
}

/** The builder keeps 72 px whatever the width, because the drag maths uses 72. */
export function arrangingCanvasStays72(): void {
  const grid = renderCanvas(vi.fn());
  fireWidth(1650);
  expect(grid.style.gridAutoRows).toBe("72px");
}

/** No `ResizeObserver`: a view canvas still sizes its rows to content. */
export function noResizeObserverViewRowsAreAuto(): void {
  const grid = renderCanvas();
  expect(grid.style.gridAutoRows).toBe("auto");
}

/** No `ResizeObserver`: the builder keeps 72 px. */
export function noResizeObserverBuilderStays72(): void {
  const grid = renderCanvas(vi.fn());
  expect(grid.style.gridAutoRows).toBe("72px");
}

/**
 * A second canvas mounted after the first one is gone (a tab switch, a load state) is measured:
 * its own root is observed, and the old, detached root receives nothing. 800 px is half mode, so
 * a 4-column tile spans 6 only when the width reached that root.
 */
export function aRemountedRootIsMeasured(): void {
  const first = render(<DashboardCanvas tiles={[TILE]} renderTile={() => <div />} />);
  const firstTile = first.container.querySelector('[data-canvas-tile="w1"]') as HTMLElement;
  expect(firstTile.style.gridColumn).toBe("1 / span 4");
  first.unmount();
  const second = render(<DashboardCanvas tiles={[TILE]} renderTile={() => <div />} />);
  const tile = second.container.querySelector('[data-canvas-tile="w1"]') as HTMLElement;
  expect(tile.style.gridColumn).toBe("1 / span 4");
  fireWidth(800);
  expect(tile.style.gridColumn).toBe("span 6");
}

const A: CanvasTile = { key: "a", gridX: 0, gridY: 0, gridW: 3, gridH: 2 };
const B: CanvasTile = { key: "b", gridX: 3, gridY: 0, gridW: 6, gridH: 2 };
const C: CanvasTile = { key: "c", gridX: 0, gridY: 2, gridW: 8, gridH: 3 };
const D: CanvasTile = { key: "d", gridX: 9, gridY: 0, gridW: 3, gridH: 2 };

function placed(tiles: readonly CanvasTile[], containerWidth: number | null, arranging = false) {
  return canvasLayout(tiles, { arranging, containerWidth }).placements.map((p) => [p.tile.key, p.gridColumn, p.gridRow]);
}

/**
 * Above 1024 px the stored columns stand, in the given order, and the stored rows are compacted
 * to tracks: the boundaries {0, 2, 5} give two tracks.
 */
export function above1024KeepsStoredPlacement(): void {
  expect(placed([A, B, C], 1025)).toEqual([
    ["a", "1 / span 3", "1 / span 1"],
    ["b", "4 / span 6", "1 / span 1"],
    ["c", "1 / span 8", "2 / span 1"],
  ]);
}

/**
 * `F3.77` follow-up — stored rows that no tile covers add no track: `A` (rows 0–2) and a tile at
 * rows 5–8 sit on consecutive tracks, because an empty auto track would still add a gap.
 */
export function emptyStoredRowsAddNoTrack(): void {
  const later: CanvasTile = { key: "c2", gridX: 0, gridY: 5, gridW: 8, gridH: 3 };
  expect(placed([A, later], 1025).map(([key, , row]) => [key, row])).toEqual([
    ["a", "1 / span 1"],
    ["c2", "2 / span 1"],
  ]);
}

/** A tall tile beside two stacked tiles spans both of their tracks. */
export function aTallTileSpansTheTracksBesideIt(): void {
  expect(placed([MIMIC, BESIDE, BELOW], 1168).map(([key, , row]) => [key, row])).toEqual([
    ["m", "1 / span 1"],
    ["beside", "1 / span 2"],
    ["below", "2 / span 1"],
  ]);
}

/**
 * The Overview v3 shape — four value tiles, a rail beside a list, a strip, a legend — compacts
 * to exactly four tracks, one per band.
 */
export function theOverviewShapeGivesFourTracks(): void {
  const overview: CanvasTile[] = [
    { key: "t1", gridX: 0, gridY: 0, gridW: 3, gridH: 2 },
    { key: "t2", gridX: 3, gridY: 0, gridW: 3, gridH: 2 },
    { key: "t3", gridX: 6, gridY: 0, gridW: 3, gridH: 2 },
    { key: "t4", gridX: 9, gridY: 0, gridW: 3, gridH: 2 },
    { key: "rail", gridX: 0, gridY: 2, gridW: 4, gridH: 7 },
    { key: "list", gridX: 4, gridY: 2, gridW: 8, gridH: 7 },
    { key: "strip", gridX: 0, gridY: 9, gridW: 12, gridH: 2 },
    { key: "legend", gridX: 0, gridY: 11, gridW: 12, gridH: 1 },
  ];
  const rows = placed(overview, 1168).map(([, , row]) => row);
  expect(rows).toEqual([
    "1 / span 1",
    "1 / span 1",
    "1 / span 1",
    "1 / span 1",
    "2 / span 1",
    "2 / span 1",
    "3 / span 1",
    "4 / span 1",
  ]);
}

/** At 1024 px a tile of half the grid or less spans half; a wider one spans the whole grid. */
export function at1024TilesSpanHalfOrAll(): void {
  expect(placed([A, B, C], 1024).map(([key, column]) => [key, column])).toEqual([
    ["a", "span 6"],
    ["b", "span 6"],
    ["c", "span 12"],
  ]);
}

/** Below a breakpoint the tiles flow in reading order: `gridY`, then `gridX`. */
export function belowABreakpointTilesFlowInReadingOrder(): void {
  expect(placed([C, D, B, A], 800).map(([key]) => key)).toEqual(["a", "b", "d", "c"]);
}

/** At 641 px a tile still spans half; at 640 px every tile spans the whole grid. */
export function at640EveryTileSpansTheGrid(): void {
  expect(placed([A], 641)[0]?.[1]).toBe("span 6");
  expect(placed([A, B, C], 640).map(([, column]) => column)).toEqual(["span 12", "span 12", "span 12"]);
}

/** The builder never takes a breakpoint, and no measurement is the desktop layout. */
export function theBuilderAndNoMeasurementKeepStoredPlacement(): void {
  expect(placed([A], 600, true)).toEqual([["a", "1 / span 3", "1 / span 2"]]);
  expect(placed([A], null)).toEqual([["a", "1 / span 3", "1 / span 1"]]);
}

/** The water-train preset's drawing: 1260 x 680, in a 49 px frame. */
const WATER_TRAIN: TileAspect = { ratio: 680 / 1260, chromePx: 49 };
const MIMIC: CanvasTile = { key: "m", gridX: 0, gridY: 0, gridW: 6, gridH: 4 };
const BESIDE: CanvasTile = { key: "beside", gridX: 6, gridY: 0, gridW: 6, gridH: 6 };
const BELOW: CanvasTile = { key: "below", gridX: 0, gridY: 4, gridW: 6, gridH: 2 };

function withAspect(tiles: readonly CanvasTile[], containerWidth: number, arranging = false) {
  return canvasLayout(tiles, { arranging, containerWidth, aspects: new Map([["m", WATER_TRAIN]]) }).placements.map(
    (p) => [p.tile.key, p.gridColumn, p.gridRow, p.minHeightPx] as const,
  );
}

/**
 * Desktop 1168 px: the mimic is 6 * 90 + 5 * 8 = 580 px wide, so its drawing is 313.02 px and its
 * tile round(362.02) = 362 px — a minimum height, not rows. The tile below keeps its compacted
 * track and gets no minimum.
 */
export function aDesktopMimicGetsItsAspectMinHeight(): void {
  expect(withAspect([MIMIC, BESIDE, BELOW], 1168)).toEqual([
    ["m", "1 / span 6", "1 / span 1", 362],
    ["beside", "7 / span 6", "1 / span 2", null],
    ["below", "1 / span 6", "2 / span 1", null],
  ]);
}

/**
 * 800 px (half mode): the full-width mimic is 800 px wide, so its drawing is 431.7 px and its
 * tile round(480.7) = 481 px; an auto-placed tile takes one auto track.
 */
export function aNarrowMimicGetsItsAspectMinHeight(): void {
  expect(withAspect([{ ...MIMIC, gridW: 12, gridH: 4 }], 800)).toEqual([["m", "span 12", "auto", 481]]);
}

/** The builder keeps the mimic's stored rows and gives it no minimum height. */
export function theBuilderKeepsTheMimicRows(): void {
  expect(withAspect([MIMIC], 1168, true)).toEqual([["m", "1 / span 6", "1 / span 4", null]]);
}

function AspectProbe() {
  useCanvasTileAspect(WATER_TRAIN);
  return <div />;
}

/**
 * A tile that reports its aspect through `useCanvasTileAspect` gets the aspect minimum height in
 * the DOM once the canvas is measured — and none before.
 */
export function aReportedAspectReachesTheTile(): void {
  const { container } = render(
    <DashboardCanvas tiles={[MIMIC, BELOW]} renderTile={(tile) => (tile.key === "m" ? <AspectProbe /> : <div />)} />,
  );
  const mimic = container.querySelector('[data-canvas-tile="m"]') as HTMLElement;
  const below = container.querySelector('[data-canvas-tile="below"]') as HTMLElement;
  expect(mimic.style.minHeight).toBe("");
  fireWidth(1168);
  expect(mimic.style.minHeight).toBe("362px");
  expect(below.style.gridRow).toBe("2 / span 1");
  expect(below.style.minHeight).toBe("");
}

/** A tile's own root fills its cell: the wrapper makes its first child full height. */
export function aTileRootFillsItsCell(): void {
  const { container } = render(<DashboardCanvas tiles={[TILE]} renderTile={() => <div />} />);
  const wrapper = container.querySelector('[data-canvas-tile="w1"]') as HTMLElement;
  expect(wrapper.className.split(" ")).toContain("[&>:first-child]:h-full");
}
