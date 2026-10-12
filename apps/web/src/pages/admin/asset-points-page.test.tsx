// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aD1DraftIsNamedAndNotSent,
  aRefusedFormulaShowsTheServerSentence,
  cancelWhileTheSaveIsInFlightKeepsTheWizard,
  clearIsDisabledWhileTheSaveIsInFlight,
  clearOverrideStaysBesideTheWizard,
  submitSendsNothingWhileAClearIsInFlight,
  theOverrideStepsAreFormulaScheduleReview,
  theOverrideSubmitsTheDraftAsTheBody,
  theOverrideWizardSendsNoCopilotHeader,
  aFailedRtuFetchLabelsTheStoredRtuUnknown,
  aRefusedCreateShowsTheSentence,
  aStoredRtuOutsideTheListKeepsItsOption,
  addPicksAnRtuOfTheAssetsLocation,
  addWithNoLocationDisablesTheRtuSelect,
  anEditSendsOnlyTheChangedField,
  anUntouchedEditSendsNothing,
  pickingAnAssetFollowsItsLocationAndResetsTheRtu,
  choosingUnwiredSendsNull,
  theEditRtuSelectShowsTheStoredRtu,
  theListShowsTheInheritedEffectiveRange,
  theListShowsTheInheritedEffectiveScaleAndQuality,
} from "./asset-points-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * The `@vitest-environment jsdom` docblock is on THIS file because Vitest
 * reads it from the file it collects (ADR 0042 decision 2).
 */
/**
 * Per-case timeout, as `escalation-profiles-page.test.tsx` sets it. Measured
 * at 2–3 s alone on a dev machine; the margin is for a loaded parallel run,
 * where a `userEvent` walk through the page can pass Vitest's 5 s default.
 */
const CASE_TIMEOUT_MS = 15_000;

describe("asset points page — refusals, effective metadata, the Add/Edit dialog", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("F3.86 picking an asset on the unrouted Add fetches its location's RTUs and clears the RTU choice", async () => {
    await pickingAnAssetFollowsItsLocationAndResetsTheRtu();
  }, CASE_TIMEOUT_MS);

  it("F4.204 a refused add-mapping save shows the sentence, not the envelope", async () => {
    await aRefusedCreateShowsTheSentence();
  }, CASE_TIMEOUT_MS);

  it("F2.25 the Range cell shows the template's bound, marked inherited; an own bound is not", async () => {
    await theListShowsTheInheritedEffectiveRange();
  }, CASE_TIMEOUT_MS);

  it("F2.25 the Scale and Quality cells show the template's values, marked inherited; own values win", async () => {
    await theListShowsTheInheritedEffectiveScaleAndQuality();
  }, CASE_TIMEOUT_MS);

  it("F2.31 an edit sends only the field that changed", async () => {
    await anEditSendsOnlyTheChangedField();
  }, CASE_TIMEOUT_MS);

  it("F2.31 an untouched edit closes the dialog without a request", async () => {
    await anUntouchedEditSendsNothing();
  }, CASE_TIMEOUT_MS);

  it("F2.27 (1) Edit lists the location's RTUs, shows the stored one, and sends no untouched rtuId", async () => {
    await theEditRtuSelectShowsTheStoredRtu();
  }, CASE_TIMEOUT_MS);

  it("F2.27 (2) choosing Unwired on Edit sends rtuId: null", async () => {
    await choosingUnwiredSendsNull();
  }, CASE_TIMEOUT_MS);

  it("F2.27 (3) a stored RTU outside the location list keeps its option and its value", async () => {
    await aStoredRtuOutsideTheListKeepsItsOption();
  }, CASE_TIMEOUT_MS);

  it("F2.27 (3b) a failed RTU fetch labels the stored RTU unknown and keeps its value", async () => {
    await aFailedRtuFetchLabelsTheStoredRtuUnknown();
  }, CASE_TIMEOUT_MS);

  it("F2.27 (4) Add omits a blank RTU and sends a chosen one of the asset's location", async () => {
    await addPicksAnRtuOfTheAssetsLocation();
  }, CASE_TIMEOUT_MS);

  it("F2.27 (5) Add with no location known disables the RTU select and says why", async () => {
    await addWithNoLocationDisablesTheRtuSelect();
  }, CASE_TIMEOUT_MS);
});

describe("F3.85 PR 11b asset points — the calc override is the calcOverride.set wizard", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("the steps are Formula, Schedule, Review", async () => {
    await theOverrideStepsAreFormulaScheduleReview();
  }, CASE_TIMEOUT_MS);

  it("Submit sends the draft as the PUT body, empty columns as null", async () => {
    await theOverrideSubmitsTheDraftAsTheBody();
  }, CASE_TIMEOUT_MS);

  it("a refused formula's 400 sentence renders on the Review card", async () => {
    await aRefusedFormulaShowsTheServerSentence();
  }, CASE_TIMEOUT_MS);

  it("a D-1 draft is named on Review and Submit sends nothing", async () => {
    await aD1DraftIsNamedAndNotSent();
  }, CASE_TIMEOUT_MS);

  it("the wizard alone sends its PUT without X-Copilot-Change", async () => {
    await theOverrideWizardSendsNoCopilotHeader();
  }, CASE_TIMEOUT_MS);

  it("Clear override stays beside the wizard and sends the DELETE", async () => {
    await clearOverrideStaysBesideTheWizard();
  }, CASE_TIMEOUT_MS);

  it("review code:F1 Submit sends nothing while a Clear is in flight", async () => {
    await submitSendsNothingWhileAClearIsInFlight();
  }, CASE_TIMEOUT_MS);

  it("review code:F2 Cancel during a pending save keeps the wizard, so a later 400 still renders", async () => {
    await cancelWhileTheSaveIsInFlightKeepsTheWizard();
  }, CASE_TIMEOUT_MS);

  it("review code:F3 Clear is disabled while the save is in flight", async () => {
    await clearIsDisabledWhileTheSaveIsInFlight();
  }, CASE_TIMEOUT_MS);
});
