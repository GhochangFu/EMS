import { act, cleanup, render } from "@testing-library/react";
import { expect, vi } from "vitest";

import { DashboardCanvas, type CanvasTile } from "./dashboard-canvas";

/**
 * `F3.73` polish — the view canvas's row height follows its measured width; the builder's does
 * not. jsdom implements no layout, so a fake `ResizeObserver` hands the canvas a width, and each
 * case reads the grid's `gridAutoRows` back.
 */

const TILE: CanvasTile = { key: "w1", gridX: 0, gridY: 0, gridW: 4, gridH: 2 };

type ObserverCallback = (entries: { contentRect: { width: number } }[]) => void;

let observerCallbacks: ObserverCallback[] = [];

/** Installs a `ResizeObserver` that records its callbacks, so a case can fire a width. */
export function installFakeResizeObserver(): void {
  observerCallbacks = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ObserverCallback) {
        observerCallbacks.push(callback);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
}

/** Removes `ResizeObserver` from the global scope (jsdom has none; this pins it). */
export function removeResizeObserver(): void {
  observerCallbacks = [];
  vi.stubGlobal("ResizeObserver", undefined);
}

export function cleanupCanvas(): void {
  cleanup();
  vi.unstubAllGlobals();
}

function fireWidth(width: number): void {
  act(() => {
    for (const callback of observerCallbacks) {
      callback([{ contentRect: { width } }]);
    }
  });
}

function renderCanvas(onArrange?: () => void): HTMLElement {
  const { container } = render(
    <DashboardCanvas tiles={[TILE]} renderTile={() => <div />} onArrange={onArrange} />,
  );
  return container.firstElementChild as HTMLElement;
}

/** 1528 px: (1528 - 8 * 11) / 12 = 120 px a column; * 0.55 = 66 px, inside the 64-72 clamp. */
export function measured1528PxGivesTheClampValue(): void {
  const grid = renderCanvas();
  expect(observerCallbacks.length).toBeGreaterThan(0);
  fireWidth(1528);
  expect(grid.style.gridAutoRows).toBe("66px");
}

/** 600 px: 42.67 px a column; * 0.55 = 23.5, so the minimum 64 px. */
export function narrowWidthClampsTo64(): void {
  const grid = renderCanvas();
  fireWidth(600);
  expect(grid.style.gridAutoRows).toBe("64px");
}

/** 2400 px: 192.67 px a column; * 0.55 = 106, so the maximum 72 px. */
export function wideWidthClampsTo72(): void {
  const grid = renderCanvas();
  fireWidth(2400);
  expect(grid.style.gridAutoRows).toBe("72px");
}

/** The builder keeps 72 px whatever the width, because the drag maths uses 72. */
export function arrangingCanvasStays72(): void {
  const grid = renderCanvas(vi.fn());
  fireWidth(1200);
  expect(grid.style.gridAutoRows).toBe("72px");
}

/** No `ResizeObserver`: no measurement, so the fallback 72 px. */
export function noResizeObserverGives72(): void {
  const grid = renderCanvas();
  expect(grid.style.gridAutoRows).toBe("72px");
}
