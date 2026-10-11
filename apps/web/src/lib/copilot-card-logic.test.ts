import { describe, it } from "vitest";

import {
  aCreateHasNoBeforeValues,
  aFillIsTakenOnlyForItsStepsFields,
  anEditShowsBeforeAndAfter,
  aStepIsCheckedAloneAndTheBodyAtReview,
  everyEntryHasInvalidations,
  everyWizardEndsWithReview,
  leavingADirtyWizardAsks,
  longAndStructuredValuesAreShortened,
} from "./copilot-card-logic.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.85 PR 8 — Confirm card and wizard logic (ADR 0099 decisions 4, 6)", () => {
  it("invalidates queries for every catalog entry", () => everyEntryHasInvalidations());
  it("shows no before values for a create", () => aCreateHasNoBeforeValues());
  it("shows before and after for an edit", () => anEditShowsBeforeAndAfter());
  it("shortens long and structured values", () => longAndStructuredValuesAreShortened());
  it("ends every wizard with Review", () => everyWizardEndsWithReview());
  it("checks a step alone and the body at Review", () => aStepIsCheckedAloneAndTheBodyAtReview());
  it("takes a fill only for its step's fields", () => aFillIsTakenOnlyForItsStepsFields());
  it("asks before leaving a dirty wizard", () => leavingADirtyWizardAsks());
});
