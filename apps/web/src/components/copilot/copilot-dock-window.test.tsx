// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { useAuthStore } from "../../stores/auth-store";
import { resetCopilotStore } from "../../stores/copilot-store";
import {
  aDockedPanelHidesTheButton,
  aDockedPanelPushesThePageByItsWidth,
  aFloatingPanelKeepsTheButton,
  aFloatingPanelPushesNothing,
  aLogoutClosesThePanel,
  aLogoutRemovesTheWindowKey,
  aNarrowScreenShowsTheSheet,
  anUnavailableCopilotPushesNothing,
  aRefusedStorageStillOpensThePanel,
  aSignOutLeavesNoKeyAfterTheDockUnmounts,
  closingTheDockFocusesTheButton,
  openingIntoTheDockFocusesThePanel,
  arrowLeftOnTheHandleStoresTheWiderPanel,
  dockToTheSideStoresTheDockedMode,
} from "./copilot-dock-window.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), one claim per `it()`. */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useAuthStore.getState().clearSession();
  useAuthStore.setState({ scope: null });
  resetCopilotStore();
  window.localStorage.clear();
});

describe("F4.292 copilot dock window — the page push", () => {
  it("a docked panel pushes the page by its width", aDockedPanelPushesThePageByItsWidth);
  it("a floating panel pushes nothing", aFloatingPanelPushesNothing);
  it("an unavailable copilot pushes nothing", anUnavailableCopilotPushesNothing);
});

describe("F4.292 copilot dock window — the controls", () => {
  it("Dock to the side stores the docked mode", dockToTheSideStoresTheDockedMode);
  it("ArrowLeft on the handle stores the wider panel", arrowLeftOnTheHandleStoresTheWiderPanel);
  it("a docked panel hides the button", aDockedPanelHidesTheButton);
  it("a floating panel keeps the button", aFloatingPanelKeepsTheButton);
  it("a narrow screen shows the sheet", aNarrowScreenShowsTheSheet);
  it("opening into the dock focuses the panel", openingIntoTheDockFocusesThePanel);
  it("closing the dock focuses the button", closingTheDockFocusesTheButton);
});

describe("F4.292 copilot dock window — the session and the storage (ruling P6)", () => {
  it("a logout closes the panel", aLogoutClosesThePanel);
  it("a logout removes the window key", aLogoutRemovesTheWindowKey);
  it("a sign-out leaves no key after the dock unmounts", aSignOutLeavesNoKeyAfterTheDockUnmounts);
  it("a refused storage still opens the panel", aRefusedStorageStillOpensThePanel);
});
