// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { resetWizardStore } from "../../stores/wizard-store";
import {
  addRowStopsAtTwentyFive,
  aTextThresholdNamesTheRowAndItsColumn,
  nextWithAnIncompleteRowStaysAndNamesIt,
  removingARowKeepsTheOthers,
  submitPostsTheRowsToTheBatchRoute,
  theReviewCardIsRedAndCountsTheRows,
  theRulesPanelOpensTheBatchWizard,
  theStepsAreRulesThenReview,
} from "./rule-batch-wizard.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). The
 * `@vitest-environment jsdom` docblock is on THIS file (ADR 0042 decision 2).
 */
describe("F4.289 — the Rule Engine's batch-create wizard (owner ruling P1)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetWizardStore();
  });

  it("has the Rules step, then Review", () => theStepsAreRulesThenReview());
  it("stops adding rows at 25", () => addRowStopsAtTwentyFive(), 30_000);
  it("keeps the other rows when one is removed", () => removingARowKeepsTheOthers());
  it("stays on Rules and names an incomplete row", () => nextWithAnIncompleteRowStaysAndNamesIt());
  it("names a text threshold by its row and column", () => aTextThresholdNamesTheRowAndItsColumn());
  it("posts the rows to POST /rules/batch without the copilot header", () => submitPostsTheRowsToTheBatchRoute());
  it("shows a red Review card that counts the rows", () => theReviewCardIsRedAndCountsTheRows());
  it("opens from the Rule Engine page's New batch button", () => theRulesPanelOpensTheBatchWizard());
});
