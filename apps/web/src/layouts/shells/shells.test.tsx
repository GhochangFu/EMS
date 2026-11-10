// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { useThemeStore } from "../../stores/theme-store";
import {
  everyItemIsInOneVerticalModulesNav,
  everyRailItemHasAVisibleTextLabel,
  theOtherShellsListTheSidebarsItemsInOrder,
  theSelectedItemIsAriaCurrent,
  theWordmarkAndLogoutAreThere,
} from "./shells.spec";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useThemeStore.getState().setDesign("nexus-soft");
  localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1024 });
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.341 / F4.346 the sidebar and rail shells (ADR 0118 decision 6, Amendment 3)", () => {
  it("SH1 every design system lists the nexus-soft sidebar's items in its order, per role and scope", () => {
    theOtherShellsListTheSidebarsItemsInOrder(cleanup);
  });

  it.each(["nexus-soft", "enterprise-flat", "swiss-grid", "bento-ops", "control-room-dark"] as const)(
    "S2 %s at 1440 px: every item is a link in one vertical Modules nav, with no sideways scroller",
    (design) => everyItemIsInOneVerticalModulesNav(design),
  );

  it.each(["swiss-grid", "bento-ops", "control-room-dark"] as const)("SH2 %s marks the selected item aria-current", (design) => {
    theSelectedItemIsAriaCurrent(design);
  });

  it.each(["swiss-grid", "control-room-dark"] as const)("SH3 %s shows the wordmark and logout", (design) => {
    theWordmarkAndLogoutAreThere(design);
  });

  it("SH4 every rail item has a visible text label, at 12px or more, and the status strip is there", () => {
    everyRailItemHasAVisibleTextLabel();
  });
});
