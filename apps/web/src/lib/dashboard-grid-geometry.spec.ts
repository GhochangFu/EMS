import { DASHBOARD_GRID } from "@bms/shared";

import {
  cellWidth,
  clampWidget,
  dragToGrid,
  resizeToGrid,
  type GridRect,
} from "./dashboard-grid-geometry";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** `cellWidth` — pixels per column, given a measured container width. */
export function runCellWidthTests(): void {
  assert(
    cellWidth({ containerWidth: 1200, columns: DASHBOARD_GRID.columns }) === 100,
    "1200px over a 12-column canvas is 100px per column",
  );
  assert(
    cellWidth({ containerWidth: 600, columns: DASHBOARD_GRID.columns }) === 50,
    "600px over a 12-column canvas is 50px per column",
  );
  assert(
    cellWidth({ containerWidth: 900, columns: 0 }) === 0,
    "a zero-column canvas has no cell width rather than dividing by zero",
  );
}

/** `clampWidget` — the single choke point every bound is enforced through. */
export function runClampWidgetTests(): void {
  const inBounds: GridRect = { gridX: 2, gridY: 3, gridW: 4, gridH: 5 };
  assert(
    JSON.stringify(clampWidget(inBounds)) === JSON.stringify(inBounds),
    "a widget already inside every bound is returned unchanged",
  );

  assert(
    clampWidget({ gridX: 0, gridY: 0, gridW: 0, gridH: 3 }).gridW === DASHBOARD_GRID.minWidgetW,
    "gridW below the minimum clamps up to DASHBOARD_GRID.minWidgetW",
  );
  assert(
    clampWidget({ gridX: 0, gridY: 0, gridW: 999, gridH: 3 }).gridW === DASHBOARD_GRID.columns,
    "gridW above the canvas width clamps down to DASHBOARD_GRID.columns",
  );
  assert(
    clampWidget({ gridX: 0, gridY: 0, gridW: 3, gridH: 0 }).gridH === DASHBOARD_GRID.minWidgetH,
    "gridH below the minimum clamps up to DASHBOARD_GRID.minWidgetH",
  );
  assert(
    clampWidget({ gridX: 0, gridY: 0, gridW: 3, gridH: 999 }).gridH === DASHBOARD_GRID.maxWidgetH,
    "gridH above the maximum clamps down to DASHBOARD_GRID.maxWidgetH",
  );
  assert(
    clampWidget({ gridX: -5, gridY: 0, gridW: 3, gridH: 3 }).gridX === 0,
    "a negative gridX clamps up to the left edge",
  );
  assert(
    clampWidget({ gridX: 999, gridY: 0, gridW: 3, gridH: 3 }).gridX === DASHBOARD_GRID.columns - 3,
    "a gridX that would overhang the right edge clamps flush with it",
  );
  assert(
    clampWidget({ gridX: 0, gridY: -7, gridW: 3, gridH: 3 }).gridY === 0,
    "a negative gridY clamps up to the top edge",
  );
  assert(
    clampWidget({ gridX: 0, gridY: 500, gridW: 3, gridH: 3 }).gridY === 500,
    "gridY has no ceiling — a long dashboard is legitimate",
  );
  assert(
    clampWidget({ gridX: 0, gridY: 0, gridW: 999, gridH: 3 }).gridX === 0,
    "gridW is clamped BEFORE gridX, so an over-wide widget clamped to the full canvas stays at gridX 0",
  );
}

/** `dragToGrid` — a pointer drag, converted to grid units and clamped. */
export function runDragToGridTests(): void {
  const cell = { width: 100, height: 40 };
  const origin: GridRect = { gridX: 2, gridY: 1, gridW: 3, gridH: 2 };

  const moved = dragToGrid(origin, { dx: 250, dy: 80 }, cell);
  assert(
    moved.gridX === 5 && moved.gridY === 3 && moved.gridW === 3 && moved.gridH === 2,
    `an ordinary drag rounds pixels to whole cells and leaves size alone — got ${JSON.stringify(moved)}`,
  );

  // The load-bearing assertion (`tests/f3.1d-grid-bounds-single-source.test.ts`'s companion:
  // plan §9 names the mutation that must turn this red — deleting the `clampWidget` call
  // inside `dragToGrid`).
  const pastRightEdge = dragToGrid({ gridX: 9, gridY: 0, gridW: 3, gridH: 2 }, { dx: 500, dy: 0 }, cell);
  assert(
    pastRightEdge.gridX + pastRightEdge.gridW <= DASHBOARD_GRID.columns,
    `dragging a tile past the right edge must clamp it flush with the canvas — got gridX=${pastRightEdge.gridX} gridW=${pastRightEdge.gridW}, columns=${DASHBOARD_GRID.columns}`,
  );
  assert(
    pastRightEdge.gridX === DASHBOARD_GRID.columns - 3,
    `the clamped position is flush with the right edge, not merely inside it — got gridX=${pastRightEdge.gridX}`,
  );

  const zeroCell = dragToGrid(origin, { dx: 250, dy: 80 }, { width: 0, height: 0 });
  assert(
    zeroCell.gridX === origin.gridX && zeroCell.gridY === origin.gridY,
    "a zero cell size (unmeasured canvas) leaves the position unchanged rather than dividing by zero",
  );
}

/** `resizeToGrid` — a pointer resize from the bottom-right handle. */
export function runResizeToGridTests(): void {
  const cell = { width: 100, height: 40 };

  const grown = resizeToGrid({ gridX: 1, gridY: 1, gridW: 2, gridH: 2 }, { dx: 200, dy: 40 }, cell);
  assert(
    grown.gridX === 1 && grown.gridY === 1 && grown.gridW === 4 && grown.gridH === 3,
    `an ordinary resize rounds pixels to whole cells and leaves position alone — got ${JSON.stringify(grown)}`,
  );

  // The load-bearing assertion: plan §9 names the mutation that must turn this red —
  // deleting the lower clamp on gridH.
  const shrunkBelowMin = resizeToGrid({ gridX: 0, gridY: 0, gridW: 3, gridH: 3 }, { dx: 0, dy: -200 }, cell);
  assert(
    shrunkBelowMin.gridH >= DASHBOARD_GRID.minWidgetH,
    `resizing below the minimum height must clamp to it — got gridH=${shrunkBelowMin.gridH}`,
  );
  assert(
    shrunkBelowMin.gridH === DASHBOARD_GRID.minWidgetH,
    `the clamped height is exactly the minimum, not merely at or above it — got gridH=${shrunkBelowMin.gridH}`,
  );

  // Widening a widget can also push gridX out of bounds — clampWidget's ordering note,
  // exercised through resize rather than drag.
  const widenedPastEdge = resizeToGrid({ gridX: 10, gridY: 0, gridW: 2, gridH: 2 }, { dx: 500, dy: 0 }, cell);
  assert(
    widenedPastEdge.gridX + widenedPastEdge.gridW <= DASHBOARD_GRID.columns,
    `widening a tile past the right edge must re-clamp its position too — got gridX=${widenedPastEdge.gridX} gridW=${widenedPastEdge.gridW}`,
  );
}
