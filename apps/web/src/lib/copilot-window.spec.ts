import { expect } from "vitest";

import {
  clampCopilotSize,
  COPILOT_DOCKED_PAGE_MIN,
  COPILOT_MIN_HEIGHT,
  COPILOT_MIN_WIDTH,
  dockedWidth,
  resizedSize,
  steppedSize,
} from "./copilot-window";

/**
 * `F4.292` (ADR 0099 Amendment 9 E6) — the dock's window sizes. Assertions
 * live here; `copilot-window.test.ts` is the Vitest entry point (ADR 0014).
 */

const VIEWPORT = { width: 1280, height: 800 };
const START = { width: 400, height: 520, x: 600, y: 300 };

/** Mutation: `Math.min(min, value)` for `Math.max(min, value)` in the clamp. */
export function clampsASmallSizeUpToTheMinimum(): void {
  expect(clampCopilotSize({ width: 100, height: 100 }, VIEWPORT)).toEqual({ width: COPILOT_MIN_WIDTH, height: COPILOT_MIN_HEIGHT });
}

/** Mutation: drop the upper bound. */
export function clampsALargeSizeDownToTheViewport(): void {
  expect(clampCopilotSize({ width: 5000, height: 5000 }, VIEWPORT)).toEqual(VIEWPORT);
}

/** Mutation: drop the `Number.isFinite(value)` guard. */
export function clampsANaNAxisToTheMinimum(): void {
  expect(clampCopilotSize({ width: Number.NaN, height: 600 }, VIEWPORT)).toEqual({ width: COPILOT_MIN_WIDTH, height: 600 });
}

/** Mutation: drop the `Number.isFinite(max)` guard. */
export function clampsToTheMinimumWhenTheBoundIsNaN(): void {
  expect(clampCopilotSize({ width: 500, height: 600 }, { width: Number.NaN, height: 800 }).width).toBe(COPILOT_MIN_WIDTH);
}

/** Mutation: flip the sign of the left-edge arithmetic. */
export function aLeftDragOfMinusFortyGrowsTheWidthByForty(): void {
  expect(resizedSize(START, { x: 560, y: 300 }, { left: true, top: true }, VIEWPORT).width).toBe(440);
}

/** Mutation: flip the sign of the top-edge arithmetic. */
export function aTopDragOfPlusFortyShrinksTheHeightByForty(): void {
  expect(resizedSize(START, { x: 600, y: 340 }, { left: true, top: true }, VIEWPORT).height).toBe(480);
}

/** Mutation: ignore `edges.top`. */
export function aDragOnTheLeftEdgeOnlyLeavesTheHeight(): void {
  expect(resizedSize(START, { x: 560, y: 200 }, { left: true, top: false }, VIEWPORT).height).toBe(520);
}

/** Mutation: `start.width` without the clamp. */
export function aDragPastTheViewportStopsAtIt(): void {
  expect(resizedSize(START, { x: -5000, y: 300 }, { left: true, top: false }, VIEWPORT).width).toBe(VIEWPORT.width);
}

/** Mutation: ArrowLeft shrinks. */
export function arrowLeftOnTheLeftEdgeGrowsTheWidthBySixteen(): void {
  expect(steppedSize({ width: 400, height: 520 }, "left", "ArrowLeft", VIEWPORT)).toEqual({ width: 416, height: 520 });
}

/** Mutation: ArrowDown grows. */
export function arrowDownOnTheTopEdgeShrinksTheHeightBySixteen(): void {
  expect(steppedSize({ width: 400, height: 520 }, "top", "ArrowDown", VIEWPORT)).toEqual({ width: 400, height: 504 });
}

/** Mutation: the left edge also takes ArrowUp. */
export function anArrowAcrossTheEdgeIsNotAStep(): void {
  expect(steppedSize({ width: 400, height: 520 }, "left", "ArrowUp", VIEWPORT)).toBeNull();
}

/** Mutation: `dockedWidth` clamps against the full viewport. */
export function aDockedWidthLeavesThePageItsMinimum(): void {
  expect(dockedWidth(1400, VIEWPORT)).toBe(VIEWPORT.width - COPILOT_DOCKED_PAGE_MIN);
}

/** The adjacent positive: a docked width that fits is kept. */
export function aDockedWidthThatFitsIsKept(): void {
  expect(dockedWidth(420, VIEWPORT)).toBe(420);
}
