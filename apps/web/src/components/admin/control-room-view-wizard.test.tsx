// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { resetWizardStore } from "../../stores/wizard-store";
import {
  aDashboardViewSendsItsId,
  aFailedReadOffersClose,
  aLoadingReadOffersClose,
  aDashboardViewWithNoDashboardSendsNothing,
  aFillStepFillsTheView,
  anAdminOverABuiltinGetsAnEnabledField,
  anAdminsBuiltinSendsTheBuiltinBody,
  anUnchangedViewIsNotPut,
  aNonAdminOverABuiltinIsOfferedNoSubmit,
  aRefusedPutShowsItsSentence,
  aRemovedStoredDashboardIsNoLongerAvailable,
  aRescopedStoredDashboardIsNoLongerAvailable,
  aViewChangedBackIsNotPut,
  builtinIsOfferedToTheGlobalAdmin,
  builtinIsOfferedToTheGlobalAdminOnly,
  generatedSendsTheExactBody,
  onlyATouchedPickerIsRequired,
  thePickerListsOnlyEligibleDashboards,
  theStepsAreViewThenReview,
  theStoredDashboardShowsAsNow,
  theWizardSendsNoCopilotHeader,
} from "./control-room-view-wizard.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014); the
 * jsdom docblock is here because this is the file Vitest collects (ADR 0042).
 * `WAIT_BUDGET_MS` lets a failing wait name its own assertion rather than time out.
 */
const WAIT_BUDGET_MS = 20_000;

describe("F3.86 PR 3d — the Control Room view wizard", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetWizardStore();
  });

  it("orders the steps View, then Review", () => theStepsAreViewThenReview(), WAIT_BUDGET_MS);
  it("shows the stored dashboard as Now", () => theStoredDashboardShowsAsNow(), WAIT_BUDGET_MS);
  it("sends exactly { kind: generated } once", () => generatedSendsTheExactBody(), WAIT_BUDGET_MS);
  it("sends no X-Copilot-Change header", () => theWizardSendsNoCopilotHeader(), WAIT_BUDGET_MS);
  it("sends the built-in body for the global admin", () => anAdminsBuiltinSendsTheBuiltinBody(), WAIT_BUDGET_MS);
  it("sends the chosen dashboard's id", () => aDashboardViewSendsItsId(), WAIT_BUDGET_MS);
  it("sends nothing for a dashboard view with no dashboard", () => aDashboardViewWithNoDashboardSendsNothing(), WAIT_BUDGET_MS);
  it("offers a non-admin over a built-in view no Submit (OQ3)", () => aNonAdminOverABuiltinIsOfferedNoSubmit(), WAIT_BUDGET_MS);
  it("gives the global admin over a built-in view an enabled field", () => anAdminOverABuiltinGetsAnEnabledField(), WAIT_BUDGET_MS);
  it("lists only the site's eligible dashboards (W3)", () => thePickerListsOnlyEligibleDashboards(), WAIT_BUDGET_MS);
  it("does not offer builtin to an organization admin (OQ1)", () => builtinIsOfferedToTheGlobalAdminOnly(), WAIT_BUDGET_MS);
  it("offers builtin to the global admin (OQ1)", () => builtinIsOfferedToTheGlobalAdmin(), WAIT_BUDGET_MS);
  it("shows a removed stored dashboard as no longer available", () => aRemovedStoredDashboardIsNoLongerAvailable(), WAIT_BUDGET_MS);
  it("shows a re-scoped stored dashboard as no longer available", () => aRescopedStoredDashboardIsNoLongerAvailable(), WAIT_BUDGET_MS);
  it("requires the dashboard picker only once touched", () => onlyATouchedPickerIsRequired(), WAIT_BUDGET_MS);
  it("shows a refused PUT's sentence and stays open", () => aRefusedPutShowsItsSentence(), WAIT_BUDGET_MS);
  it("W5 does not put an unchanged view", () => anUnchangedViewIsNotPut(), WAIT_BUDGET_MS);
  it("W5b does not put a view changed and changed back", () => aViewChangedBackIsNotPut(), WAIT_BUDGET_MS);
  it("takes a copilot fill for the View step", () => aFillStepFillsTheView(), WAIT_BUDGET_MS);
  it("offers Close when the read fails", () => aFailedReadOffersClose(), WAIT_BUDGET_MS);
  it("offers Close while the read loads", () => aLoadingReadOffersClose(), WAIT_BUDGET_MS);
});
