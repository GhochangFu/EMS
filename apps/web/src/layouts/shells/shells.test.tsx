// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { useThemeStore } from "../../stores/theme-store";
import {
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
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.341 the topbar and rail shells (ADR 0118 decision 6)", () => {
  it("SH1 the topbar and the rail list the sidebar's items in its order, per role and scope", () => {
    theOtherShellsListTheSidebarsItemsInOrder(cleanup);
  });

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
