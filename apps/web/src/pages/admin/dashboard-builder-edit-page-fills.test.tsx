// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useAuthStore } from "../../stores/auth-store";
import { resetWizardStore } from "../../stores/wizard-store";
import {
  aLayoutFillIsWhatTheWidgetsSubmitSends,
  aLayoutFillReplacesTheCanvasRows,
  aLayoutFillTheRouteWouldRefuseShowsTheProblem,
  aSavedSlugFillMovesToTheNewEditPath,
  aSavedSlugFillReplacesTheHistoryEntry,
  aSaveWithoutASlugFillSendsNoSlugKey,
  aSlugFillIsSentInTheSave,
  aSlugFillShowsOnBasics,
} from "./dashboard-builder-edit-page-fills.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042). */
describe("F4.245 dashboard builder edit page — layout and slug fills (owner rulings 2 and 3)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAuthStore.setState({ scope: null });
    resetWizardStore();
  });

  it("puts a layout fill on the canvas", () => aLayoutFillReplacesTheCanvasRows());
  it("sends the filled layout in the widgets Submit", () => aLayoutFillIsWhatTheWidgetsSubmitSends());
  it("shows the problem of a layout fill the route would refuse", () => aLayoutFillTheRouteWouldRefuseShowsTheProblem());
  it("shows a slug fill read-only on Basics", () => aSlugFillShowsOnBasics());
  it("sends a slug fill in the save", () => aSlugFillIsSentInTheSave());
  it("moves to the new edit path after a renaming save", () => aSavedSlugFillMovesToTheNewEditPath());
  it("replaces the history entry when a slug save moves the address", () => aSavedSlugFillReplacesTheHistoryEntry());
  it("sends no slug key in a save without a slug fill", () => aSaveWithoutASlugFillSendsNoSlugKey());
});
