// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { useThemeStore } from "../../stores/theme-store";
import {
  aDesktopKeepsTheSidebarRow,
  aPhoneFoldsTheSidebarHeaderIntoAMenu,
  theFoldWidthsAreThoseMeasured,
  thePanelClosesOnEscapeOutsideAppearanceAndNavigation,
  thePanelClosesOnNavigation,
  theRailAtXlKeepsItsRow,
  theRailFoldsBelowXlAndKeepsItsStrip,
  theRailOnAPhoneMovesTheStripIntoThePanel,
} from "./header-menu.spec";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useThemeStore.getState().setDesign("nexus-soft");
  useThemeStore.getState().setTheme("light");
  localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1024 });
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.347 the chrome header folds into a menu on a narrow screen", () => {
  it("the fold widths are 767 px (sidebar) and 1279 px (rail)", () => theFoldWidthsAreThoseMeasured());
  it("H1 a phone folds the sidebar header into one Menu that holds every control", () =>
    aPhoneFoldsTheSidebarHeaderIntoAMenu());
  it("H2 the panel closes on Escape, a press outside and Appearance", () =>
    thePanelClosesOnEscapeOutsideAppearanceAndNavigation());
  it("H2b the panel closes on navigation", () => thePanelClosesOnNavigation());
  it("H3 above 767 px the sidebar header keeps its row", () => aDesktopKeepsTheSidebarRow());
  it("H4 the rail below xl folds the controls and keeps its status strip", () =>
    theRailFoldsBelowXlAndKeepsItsStrip());
  it("H5 the rail on a phone moves the status strip into the panel", () =>
    theRailOnAPhoneMovesTheStripIntoThePanel());
  it("H6 the rail at xl keeps its row", () => theRailAtXlKeepsItsRow());
});
