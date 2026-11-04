// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useAuthStore } from "../../stores/auth-store";
import { resetWizardStore } from "../../stores/wizard-store";
import {
  cleanupBuilderTrendStrip,
  clickingTheButtonOpensTheWizard,
  theSiteStepNamesTheLocation,
  finishMakesNoRequest,
  finishPutsTheStripOnTheCanvas,
  saveSendsTheSelectionInThePut,
  theButtonIsAbsentOnAnOrganizationDashboard,
  theButtonIsDisabledWhileTheScopeIsUnsaved,
  theButtonShowsOnALocationDashboard,
} from "./dashboard-builder-edit-page-trend-strip.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042). */
describe("F4.306 U13 dashboard builder edit page — the trend strip wizard button", () => {
  afterEach(() => {
    cleanup();
    cleanupBuilderTrendStrip();
    vi.restoreAllMocks();
    useAuthStore.setState({ scope: null });
    resetWizardStore();
  });

  it("shows the button on a location-scoped dashboard", () => theButtonShowsOnALocationDashboard());
  it("shows no button on an organization-scoped dashboard", () => theButtonIsAbsentOnAnOrganizationDashboard());
  it("disables the button while the scope has unsaved changes", () => theButtonIsDisabledWhileTheScopeIsUnsaved());
  it("opens the wizard on a click", () => clickingTheButtonOpensTheWizard());
  it("names the location on the wizard's Site step", () => theSiteStepNamesTheLocation());
  it("puts the strip on the canvas at Finish", () => finishPutsTheStripOnTheCanvas());
  it("makes no request at Finish", () => finishMakesNoRequest());
  it("sends the selection in the widgets Save", () => saveSendsTheSelectionInThePut());
});
