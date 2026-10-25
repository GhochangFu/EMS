// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { resetWizardStore } from "../../stores/wizard-store";
import {
  aFillStepLandsInTheAssetSelect,
  aRefusedSaveShowsTheServerSentence,
  hidesTheFieldForATimeWindowRule,
  nextWithNoAssetStaysOnTheConditionStep,
  refusesANonNumericClearHold,
  sendsNullForABlankClearHold,
  sendsTheParsedIntegerForANonBlankClearHold,
  showsAStoredValueWhenOpeningARule,
  showsThePlaceholderOnANewDraft,
  theReviewSummaryNamesTheRule,
} from "./rule-wizard.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). The
 * `@vitest-environment jsdom` docblock is on THIS file (ADR 0042 decision 2).
 */
describe("F4.278 — the Rule Engine's rule wizard (ADR 0099 decision 6)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetWizardStore();
  });

  it("shows the clear-hold placeholder on a new threshold draft", () => showsThePlaceholderOnANewDraft());
  it("sends null when the clear hold is left blank", () => sendsNullForABlankClearHold());
  it("sends the parsed integer when a clear hold is entered", () => sendsTheParsedIntegerForANonBlankClearHold());
  it("refuses a non-numeric clear hold at the field", () => refusesANonNumericClearHold());
  it("shows the stored clear hold when opening a rule", () => showsAStoredValueWhenOpeningARule());
  it("hides the clear-hold field for a time-window rule", () => hidesTheFieldForATimeWindowRule());
  it("shows the server's sentence on a refused save", () => aRefusedSaveShowsTheServerSentence());
  it("stays on the Condition step with no asset and shows the problem", () => nextWithNoAssetStaysOnTheConditionStep());
  it("names the rule on the Review card", () => theReviewSummaryNamesTheRule());
  it("lands a copilot fill in the asset select", () => aFillStepLandsInTheAssetSelect());
});
