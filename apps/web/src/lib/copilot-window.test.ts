import { describe, it } from "vitest";

import {
  aDockedWidthLeavesThePageItsMinimum,
  aDockedWidthThatFitsIsKept,
  aDragOnTheLeftEdgeOnlyLeavesTheHeight,
  aDragPastTheViewportStopsAtIt,
  aLeftDragOfMinusFortyGrowsTheWidthByForty,
  anArrowAcrossTheEdgeIsNotAStep,
  arrowDownOnTheTopEdgeShrinksTheHeightBySixteen,
  arrowLeftOnTheLeftEdgeGrowsTheWidthBySixteen,
  aTopDragOfPlusFortyShrinksTheHeightByForty,
  clampsALargeSizeDownToTheViewport,
  clampsANaNAxisToTheMinimum,
  clampsASmallSizeUpToTheMinimum,
  clampsToTheMinimumWhenTheBoundIsNaN,
} from "./copilot-window.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), one claim per `it()`. */
describe("F4.292 copilot window sizes — the clamp", () => {
  it("clamps 100 × 100 up to 360 × 420", clampsASmallSizeUpToTheMinimum);
  it("clamps 5000 × 5000 down to the viewport", clampsALargeSizeDownToTheViewport);
  it("clamps a NaN axis to the minimum", clampsANaNAxisToTheMinimum);
  it("clamps to the minimum when the bound is NaN", clampsToTheMinimumWhenTheBoundIsNaN);
});

describe("F4.292 copilot window sizes — the drag", () => {
  it("grows the width by 40 on a left drag of -40 px", aLeftDragOfMinusFortyGrowsTheWidthByForty);
  it("shrinks the height by 40 on a top drag of +40 px", aTopDragOfPlusFortyShrinksTheHeightByForty);
  it("leaves the height on a left-edge-only drag", aDragOnTheLeftEdgeOnlyLeavesTheHeight);
  it("stops at the viewport", aDragPastTheViewportStopsAtIt);
});

describe("F4.292 copilot window sizes — the arrow keys", () => {
  it("ArrowLeft on the left edge grows the width by 16", arrowLeftOnTheLeftEdgeGrowsTheWidthBySixteen);
  it("ArrowDown on the top edge shrinks the height by 16", arrowDownOnTheTopEdgeShrinksTheHeightBySixteen);
  it("an arrow across the edge is not a step", anArrowAcrossTheEdgeIsNotAStep);
});

describe("F4.292 copilot window sizes — docked", () => {
  it("a docked width leaves the page its minimum", aDockedWidthLeavesThePageItsMinimum);
  it("a docked width that fits is kept", aDockedWidthThatFitsIsKept);
});
