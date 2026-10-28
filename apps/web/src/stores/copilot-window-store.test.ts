// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";

import { resetCopilotStore } from "./copilot-store";
import {
  aClosedPanelPushesNothing,
  aMountAndUnmountAfterAClearWriteNoKey,
  aFloatingPanelPushesNothing,
  aRefusedRemoveStillClosesThePanel,
  aRefusedWriteStillOpensThePanel,
  aReloadReadsTheStoredMode,
  aResizeIsClamped,
  aShownDockedPanelPushesThePageByItsWidth,
  aStoredNonNumberWidthReadsBackTheDefault,
  aStoredUnknownModeReadsBackFloating,
  aStoredValidSizeIsKept,
  aStoredWidthWiderThanTheScreenIsClamped,
  anUnmountCountsTheDockOut,
  clearingTheSessionClosesThePanel,
  clearingTheSessionRemovesTheWindowKey,
  noMountedDockPushesNothing,
  theSheetPushesNothing,
  theStoredValueIsTheWindowOnly,
} from "./copilot-window-store.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), one claim per `it()`. */
afterEach(() => {
  vi.restoreAllMocks();
  resetCopilotStore();
  window.localStorage.clear();
});

describe("F4.292 copilot window store — what is stored", () => {
  it("stores open, mode, width and height, and nothing else", theStoredValueIsTheWindowOnly);
  it("reads the stored mode back after a reload", aReloadReadsTheStoredMode);
  it("reads a stored unknown mode back as floating", aStoredUnknownModeReadsBackFloating);
  it("reads a stored non-number width back as the default", aStoredNonNumberWidthReadsBackTheDefault);
  it("keeps a valid stored size", aStoredValidSizeIsKept);
  it("clamps a resize", aResizeIsClamped);
});

describe("F4.292 copilot window store — cleared with the session (owner ruling P6)", () => {
  it("clearCopilotSession removes bms-copilot-window", clearingTheSessionRemovesTheWindowKey);
  it("clearCopilotSession closes the panel", clearingTheSessionClosesThePanel);
});

describe("F4.292 copilot window store — storage is optional", () => {
  it("a refused write still opens the panel", aRefusedWriteStillOpensThePanel);
  it("a refused remove still closes the panel", aRefusedRemoveStillClosesThePanel);
});

describe("F4.292 copilot window store — the page push", () => {
  it("an unmount counts the dock out", anUnmountCountsTheDockOut);
  it("a shown docked panel pushes the page by its width", aShownDockedPanelPushesThePageByItsWidth);
  it("no mounted dock pushes nothing", noMountedDockPushesNothing);
  it("a mount and unmount after a clear write no key", aMountAndUnmountAfterAClearWriteNoKey);
  it("the sheet pushes nothing", theSheetPushesNothing);
  it("a floating panel pushes nothing", aFloatingPanelPushesNothing);
  it("a closed panel pushes nothing", aClosedPanelPushesNothing);
  it("a stored width wider than the screen is clamped", aStoredWidthWiderThanTheScreenIsClamped);
});
