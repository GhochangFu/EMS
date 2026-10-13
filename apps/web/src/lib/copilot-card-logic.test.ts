import { describe, it } from "vitest";

import {
  anOnboardingCommitInvalidatesTheDraftList,
  theReviewStepDoesNotAskForAClientOnlyField,
  aCreateHasNoBeforeValues,
  aFillIsTakenOnlyForItsStepsFields,
  anEditShowsBeforeAndAfter,
  aStepIsCheckedAloneAndTheBodyAtReview,
  everyEntryHasInvalidations,
  everyWizardEndsWithReview,
  leavingADirtyWizardAsks,
  longAndStructuredValuesAreShortened,
  theAssetGroupAndPointKeyEntriesInvalidateTheirPages,
} from "./copilot-card-logic.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.85 PR 8 — Confirm card and wizard logic (ADR 0099 decisions 4, 6)", () => {
  it("invalidates queries for every catalog entry", () => everyEntryHasInvalidations());
  it("an onboarding commit invalidates the dock's draft list (F4.255)", () => anOnboardingCommitInvalidatesTheDraftList());
  it("shows no before values for a create", () => aCreateHasNoBeforeValues());
  it("shows before and after for an edit", () => anEditShowsBeforeAndAfter());
  it("shortens long and structured values", () => longAndStructuredValuesAreShortened());
  it("ends every wizard with Review", () => everyWizardEndsWithReview());
  it("checks a step alone and the body at Review", () => aStepIsCheckedAloneAndTheBodyAtReview());
  it("takes a fill only for its step's fields", () => aFillIsTakenOnlyForItsStepsFields());
  it("asks before leaving a dirty wizard", () => leavingADirtyWizardAsks());
  it("does not ask the Review step for a clientOnly field (F3.86 PR 2)", () => theReviewStepDoesNotAskForAClientOnlyField());
  it("re-reads the asset-group and point-key pages after their changes (F3.86 PR 3c)", () =>
    theAssetGroupAndPointKeyEntriesInvalidateTheirPages());
});
