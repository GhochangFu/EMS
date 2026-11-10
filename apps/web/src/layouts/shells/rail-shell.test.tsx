// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { useThemeStore } from "../../stores/theme-store";
import {
  aPhoneWidthGetsTheSlotAndAnOverlayThatClosesOnNavigation,
  theButtonCollapsesToCodesAndTheChoicePersists,
  theRailOpensExpanded,
  theStorageKeyIsItsOwn,
} from "./rail-shell.spec";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useThemeStore.getState().setDesign("nexus-soft");
  localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1024 });
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.346 the rail collapses (ADR 0118 Amendment 3 decision 2)", () => {
  it("S4 the choice is stored under bms-rail-collapsed", () => theStorageKeyIsItsOwn());
  it("S4 the rail opens expanded with text labels", () => theRailOpensExpanded());
  it("S4 the button collapses it to codes named by their full labels, and the choice persists", () =>
    theButtonCollapsesToCodesAndTheChoicePersists());
  it("S4 at a phone width the rail is a 64 px slot with an overlay that closes on navigation", () =>
    aPhoneWidthGetsTheSlotAndAnOverlayThatClosesOnNavigation());
});
