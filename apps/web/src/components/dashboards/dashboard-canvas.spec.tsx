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
 * `F3.73` polish and critique fixes — the view canvas's row height follows its measured width;
 * the builder's does not. A view canvas reflows at two width breakpoints and sizes a
 * fixed-aspect tile from its aspect. jsdom implements no layout, so a fake `ResizeObserver` hands
 * the canvas a width, and each case reads the grid's styles back; the placement rules are also
 * driven through the pure `canvasLayout`.
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

/** 1168 px (the site view's cap): (1168 - 8 * 11) / 12 = 90 px a column; * 0.75 = 67.5, so 68. */
export function measured1168PxFollowsTheWidth(): void {
  const grid = renderCanvas();
  expect(observers.length).toBeGreaterThan(0);
  fireWidth(1168);
  expect(grid.style.gridAutoRows).toBe("68px");
}

/** 1650 px (a wall screen): 130.17 px a column; * 0.75 = 97.6, so the 84 px cap — not 1168's 68. */
export function measured1650PxGivesTheCap(): void {
  const grid = renderCanvas();
  fireWidth(1650);
  expect(grid.style.gridAutoRows).toBe("84px");
}

/** 600 px: 42.67 px a column; * 0.75 = 32, so the minimum 64 px. */
export function narrowWidthClampsTo64(): void {
  const grid = renderCanvas();
  fireWidth(600);
  expect(grid.style.gridAutoRows).toBe("64px");
}

/** The builder keeps 72 px whatever the width, because the drag maths uses 72. */
export function arrangingCanvasStays72(): void {
  const grid = renderCanvas(vi.fn());
  fireWidth(1650);
  expect(grid.style.gridAutoRows).toBe("72px");
}

/** No `ResizeObserver`: no measurement, so the fallback 72 px. */
export function noResizeObserverGives72(): void {
  const grid = renderCanvas();
  expect(grid.style.gridAutoRows).toBe("72px");
}

/**
 * A second canvas mounted after the first one is gone (a tab switch, a load state) is measured:
 * its own root is observed, and the old, detached root receives nothing.
 */
export function aRemountedRootIsMeasured(): void {
  const first = render(<DashboardCanvas tiles={[TILE]} renderTile={() => <div />} />);
  fireWidth(1168);
  expect((first.container.firstElementChild as HTMLElement).style.gridAutoRows).toBe("68px");
  first.unmount();
  const second = render(<DashboardCanvas tiles={[TILE]} renderTile={() => <div />} />);
  const grid = second.container.firstElementChild as HTMLElement;
  fireWidth(1650);
  expect(grid.style.gridAutoRows).toBe("84px");
}

const A: CanvasTile = { key: "a", gridX: 0, gridY: 0, gridW: 3, gridH: 2 };
const B: CanvasTile = { key: "b", gridX: 3, gridY: 0, gridW: 6, gridH: 2 };
const C: CanvasTile = { key: "c", gridX: 0, gridY: 2, gridW: 8, gridH: 3 };
const D: CanvasTile = { key: "d", gridX: 9, gridY: 0, gridW: 3, gridH: 2 };

function placed(tiles: readonly CanvasTile[], containerWidth: number | null, arranging = false) {
  return canvasLayout(tiles, { arranging, containerWidth }).placements.map((p) => [p.tile.key, p.gridColumn, p.gridRow]);
}

/** Above 1024 px the stored rectangles stand, in the given order. */
export function above1024KeepsStoredPlacement(): void {
  expect(placed([A, B, C], 1025)).toEqual([
    ["a", "1 / span 3", "1 / span 2"],
    ["b", "4 / span 6", "1 / span 2"],
    ["c", "1 / span 8", "3 / span 3"],
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
  expect(placed([A], null)).toEqual([["a", "1 / span 3", "1 / span 2"]]);
}

/** The water-train preset's drawing: 1260 x 680, in a 49 px frame. */
const WATER_TRAIN: TileAspect = { ratio: 680 / 1260, chromePx: 49 };
const MIMIC: CanvasTile = { key: "m", gridX: 0, gridY: 0, gridW: 6, gridH: 4 };
const BESIDE: CanvasTile = { key: "beside", gridX: 6, gridY: 0, gridW: 6, gridH: 6 };
const BELOW: CanvasTile = { key: "below", gridX: 0, gridY: 4, gridW: 6, gridH: 2 };

function withAspect(tiles: readonly CanvasTile[], containerWidth: number, arranging = false) {
  return canvasLayout(tiles, { arranging, containerWidth, aspects: new Map([["m", WATER_TRAIN]]) }).placements.map(
    (p) => [p.tile.key, p.gridColumn, p.gridRow],
  );
}

/**
 * Desktop 1168 px: the mimic is 6 * 90 + 5 * 8 = 580 px wide, so its drawing is 313 px and its
 * tile 362 px; with 68 px rows that is ceil(370 / 76) = 5 rows, not the stored 4. The tile below
 * it moves down one row; the tile beside it stays.
 */
export function aDesktopMimicGrowsAndPushesTheTileBelow(): void {
  expect(withAspect([MIMIC, BESIDE, BELOW], 1168)).toEqual([
    ["m", "1 / span 6", "1 / span 5"],
    ["beside", "7 / span 6", "1 / span 6"],
    ["below", "1 / span 6", "6 / span 2"],
  ]);
}

/** A stored height taller than the drawing needs is kept: a desktop mimic never shrinks. */
export function aDesktopMimicNeverShrinks(): void {
  expect(withAspect([{ ...MIMIC, gridH: 9 }], 1168)).toEqual([["m", "1 / span 6", "1 / span 9"]]);
}

/**
 * 800 px (half mode): the full-width mimic is 800 px wide, so its drawing is 431.7 px and its
 * tile 480.7 px; with 64 px rows that is ceil(488.7 / 72) = 7 rows.
 */
export function aNarrowMimicTakesItsAspectRows(): void {
  expect(withAspect([{ ...MIMIC, gridW: 12, gridH: 4 }], 800)).toEqual([["m", "span 12", "span 7"]]);
}

/** The builder keeps the mimic's stored rows. */
export function theBuilderKeepsTheMimicRows(): void {
  expect(withAspect([MIMIC], 1168, true)).toEqual([["m", "1 / span 6", "1 / span 4"]]);
}

function AspectProbe() {
  useCanvasTileAspect(WATER_TRAIN);
  return <div />;
}

/** A tile that reports its aspect through `useCanvasTileAspect` gets the aspect rows in the DOM. */
export function aReportedAspectReachesTheTile(): void {
  const { container } = render(
    <DashboardCanvas tiles={[MIMIC, BELOW]} renderTile={(tile) => (tile.key === "m" ? <AspectProbe /> : <div />)} />,
  );
  fireWidth(1168);
  const mimic = container.querySelector('[data-canvas-tile="m"]') as HTMLElement;
  const below = container.querySelector('[data-canvas-tile="below"]') as HTMLElement;
  expect(mimic.style.gridRow).toBe("1 / span 5");
  expect(below.style.gridRow).toBe("6 / span 2");
}

/** A tile's own root fills its cell: the wrapper makes its first child full height. */
export function aTileRootFillsItsCell(): void {
  const { container } = render(<DashboardCanvas tiles={[TILE]} renderTile={() => <div />} />);
  const wrapper = container.querySelector('[data-canvas-tile="w1"]') as HTMLElement;
  expect(wrapper.className.split(" ")).toContain("[&>:first-child]:h-full");
}
