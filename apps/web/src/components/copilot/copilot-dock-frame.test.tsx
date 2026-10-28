// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aChangeOfTheQueryMovesTheSheet,
  aDockedPanelHasALeftHandle,
  aDockedPanelHasNoTopHandle,
  aDockedPanelTakesTheStoredWidth,
  aDockedWidthWiderThanTheScreenIsClamped,
  aFloatingPanelHasATopHandle,
  aFloatingHeightTallerThanTheRoomIsCapped,
  aFloatingPanelHasTheModeGroup,
  aFloatingPanelTakesTheStoredHeight,
  aFloatingPanelTakesTheStoredWidth,
  aFloatingWidthWiderThanTheRoomIsCapped,
  aLeftDragOfFortyPixelsAsksForWidthFourTwenty,
  aMatchingQueryIsASheetFromTheFirstRender,
  aMaximizedPanelHasNoHandle,
  aMoveAfterThePointerUpResizesNothing,
  aResizeOfTheWindowMovesTheViewport,
  arrowLeftOnTheLeftHandleGrowsTheWidthBySixteen,
  closeCallsOnClose,
  maximizeAsksForTheMaximizedMode,
  noMatchMediaIsNotASheet,
  theCurrentModesButtonIsPressed,
  theDataModeIsTheMode,
  theSheetHasNoHandle,
  theSheetHasNoModeGroup,
  theSheetSaysSheet,
} from "./copilot-dock-frame.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), one claim per `it()`. */
const INNER_WIDTH = window.innerWidth;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: INNER_WIDTH });
});

describe("F4.292 copilot dock frame — the modes", () => {
  it("data-mode is the mode", theDataModeIsTheMode);
  it("Maximize asks for the maximized mode", maximizeAsksForTheMaximizedMode);
  it("the current mode's button is pressed", theCurrentModesButtonIsPressed);
  it("a floating panel has the mode group", aFloatingPanelHasTheModeGroup);
  it("Close calls onClose", closeCallsOnClose);
});

describe("F4.292 copilot dock frame — the floating size", () => {
  it("a floating panel takes the stored width", aFloatingPanelTakesTheStoredWidth);
  it("a floating panel takes the stored height", aFloatingPanelTakesTheStoredHeight);
  it("a floating panel has a top handle", aFloatingPanelHasATopHandle);
  it("a floating height taller than the room is capped", aFloatingHeightTallerThanTheRoomIsCapped);
  it("a floating width wider than the room is capped", aFloatingWidthWiderThanTheRoomIsCapped);
});

describe("F4.292 copilot dock frame — the handles", () => {
  it("a left drag of 40 px asks for width 420", aLeftDragOfFortyPixelsAsksForWidthFourTwenty);
  it("a move after the pointer up resizes nothing", aMoveAfterThePointerUpResizesNothing);
  it("ArrowLeft on the left handle grows the width by 16", arrowLeftOnTheLeftHandleGrowsTheWidthBySixteen);
});

describe("F4.292 copilot dock frame — docked and maximized (ruling P6)", () => {
  it("a docked panel has no top handle", aDockedPanelHasNoTopHandle);
  it("a docked panel has a left handle", aDockedPanelHasALeftHandle);
  it("a docked panel takes the stored width", aDockedPanelTakesTheStoredWidth);
  it("a docked width wider than the screen is clamped", aDockedWidthWiderThanTheScreenIsClamped);
  it("a maximized panel has no handle", aMaximizedPanelHasNoHandle);
});

describe("F4.292 copilot dock frame — the sheet", () => {
  it("the sheet says sheet", theSheetSaysSheet);
  it("the sheet has no mode group", theSheetHasNoModeGroup);
  it("the sheet has no handle", theSheetHasNoHandle);
});

describe("F4.292 copilot dock frame — the viewport hooks", () => {
  it("no matchMedia is not a sheet", noMatchMediaIsNotASheet);
  it("a matching query is a sheet from the first render", aMatchingQueryIsASheetFromTheFirstRender);
  it("a change of the query moves the sheet", aChangeOfTheQueryMovesTheSheet);
  it("a resize of the window moves the viewport", aResizeOfTheWindowMovesTheViewport);
});
