import { dragBox, pointerToGrid, renderedCellPx } from "./mimic-editor-geometry";

/** `F3.32c` U6a — the editor canvas's pixel → grid arithmetic. One claim per function. */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export function runCellPxIsTheSmallerAxisScale(): void {
  assert(renderedCellPx({ width: 1260, height: 340 }, 126, 68) === 5, "a letterboxed canvas scales by the tighter axis");
}

export function runCellPxOfAnUnmeasuredRectIsZero(): void {
  assert(renderedCellPx({ width: 0, height: 0 }, 126, 68) === 0, "jsdom's zero rect gives 0, not NaN or Infinity");
}

export function runCellPxOfAnEmptyCanvasIsZero(): void {
  assert(renderedCellPx({ width: 800, height: 600 }, 0, 68) === 0, "a zero-cell canvas gives 0 rather than Infinity");
}

export function runPointerToGridRoundsToCells(): void {
  const d = pointerToGrid({ dx: 26, dy: -14 }, { width: 1260, height: 680 }, 126, 68);
  assert(d.dx === 3 && d.dy === -1, `26px, -14px at 10px/cell is 3, -1 cells, got ${JSON.stringify(d)}`);
}

export function runPointerToGridOnAZeroRectMovesNothing(): void {
  const d = pointerToGrid({ dx: 300, dy: 300 }, { width: 0, height: 0 }, 126, 68);
  assert(d.dx === 0 && d.dy === 0, `an unmeasured canvas moves nothing, got ${JSON.stringify(d)}`);
}

export function runPointerToGridIgnoresNaN(): void {
  const d = pointerToGrid({ dx: Number.NaN, dy: 10 }, { width: 1260, height: 680 }, 126, 68);
  assert(d.dx === 0 && d.dy === 0, "a NaN delta moves nothing");
}

export function runDragBoxMoveShiftsTheOrigin(): void {
  const b = dragBox({ x: 4, y: 4, w: 20, h: 25 }, { dx: 2, dy: -1 }, "move");
  assert(b.x === 6 && b.y === 3 && b.w === 20 && b.h === 25, `move keeps the size, got ${JSON.stringify(b)}`);
}

export function runDragBoxResizeGrowsTheSize(): void {
  const b = dragBox({ x: 4, y: 4, w: 20, h: 25 }, { dx: 2, dy: -1 }, "resize");
  assert(b.x === 4 && b.y === 4 && b.w === 22 && b.h === 24, `resize keeps the corner, got ${JSON.stringify(b)}`);
}
