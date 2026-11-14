// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { resetCopilotStore } from "../../stores/copilot-store";

import {
  aDialogInsideTheDockDoesNotYield,
  everyCoveringShapeYieldsToAnyModal,
  theFloatingWindowKeepsItsLayer,
  theLauncherYieldsToAPageDialog,
  theSheetYieldsToAPageDialog,
} from "./copilot-dock-yield.spec";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetCopilotStore();
});

/** `F4.362` leftover 4 — Vitest entry point; assertions live in the sibling `.spec` (§4.6). */
describe("F4.362 — the dock yields to an open page dialog", () => {
  it("the sheet yields to a page dialog and returns when it closes", theSheetYieldsToAPageDialog);
  it("the maximized and docked shapes yield to any modal", everyCoveringShapeYieldsToAnyModal);
  it("the floating window keeps its layer beside a wizard", theFloatingWindowKeepsItsLayer);
  it("the closed dock's launcher yields to a page dialog", theLauncherYieldsToAPageDialog);
  it("a dialog inside the dock does not make it yield", aDialogInsideTheDockDoesNotYield);
});
