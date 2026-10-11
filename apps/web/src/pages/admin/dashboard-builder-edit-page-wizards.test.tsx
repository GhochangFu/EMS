// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useAuthStore } from "../../stores/auth-store";
import { resetWizardStore } from "../../stores/wizard-store";
import {
  aFillWaitingForTheLoadIsNotOverwrittenByTheSeed,
  aLocationFillOnAGroupDashboardChoosesTheLocation,
  aMoveOffTheGroupIsJudgedAgainstTheSavedMimic,
  aMoveOffTheGroupWithTheSavedMimicSendsNoPatch,
  cancellingClickOnlyWidgetWorkAsksFirst,
  discardingClickOnlyWidgetWorkClearsIt,
  theDetailsReviewShowsTheStoredNameBesideTheNewOne,
  theWidgetsWizardRefusesWhileTheScopeIsUnsaved,
  theWidgetsWizardSendsNoPutWhileTheScopeIsUnsaved,
} from "./dashboard-builder-edit-page-wizards.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F3.85 PR 9 dashboard builder edit page — wizards", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAuthStore.setState({ scope: null });
    // A copilot fill a case left waiting must not reach the next case's wizard.
    resetWizardStore();
  });

  it("the details Review shows the stored name beside the new one (F3.85 PR 9)", async () => {
    await theDetailsReviewShowsTheStoredNameBesideTheNewOne();
  });

  it("a dashboard.update fill that waited for the load is applied after the seed (F3.85 PR 9 review C2)", async () => {
    await aFillWaitingForTheLoadIsNotOverwrittenByTheSeed();
  });

  it("a Scope fill naming a location on a group dashboard chooses the location (review C3)", async () => {
    await aLocationFillOnAGroupDashboardChoosesTheLocation();
  });

  it("a move off the group is judged against the SAVED mimic, and Review says why (review C1a)", async () => {
    await aMoveOffTheGroupIsJudgedAgainstTheSavedMimic();
  });

  it("a move off the group with the saved mimic sends no PATCH (review C1a)", async () => {
    await aMoveOffTheGroupWithTheSavedMimicSendsNoPatch();
  });

  it("the widgets wizard refuses while the scope is unsaved, and Review says why (review C1b, SEC-1)", async () => {
    await theWidgetsWizardRefusesWhileTheScopeIsUnsaved();
  });

  it("the widgets wizard sends no PUT while the scope is unsaved (review C1b, SEC-1)", async () => {
    await theWidgetsWizardSendsNoPutWhileTheScopeIsUnsaved();
  });

  it("cancelling click-only widget work asks first (review C4)", async () => {
    await cancellingClickOnlyWidgetWorkAsksFirst();
  });

  it("Discard and leave clears the click-only widget work (review C4)", async () => {
    await discardingClickOnlyWidgetWorkClearsIt();
  });
});
