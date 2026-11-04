// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  addOffersNoKeyTheAssetAlreadyHas,
  cancelAfterAFormulaOnlyEditOnAddAsks,
  cancelAfterAFormulaOnlyEditOnEditAsks,
  cancelOnAnUntouchedEditLeavesAtOnce,
  addOpensTheWizardOnlyOnceAKeyIsChosen,
  anUnknownReferenceIsListedBeforeSubmit,
  editOffersDeleteThatCallsOnDelete,
  inStandaloneModeNoFieldHasATemplatePlaceholder,
  inStandaloneModeNoOptionHasAnEmptyValue,
  submitSendsTheBackfillChosen,
  thePreviewUpdatesOnAKeystroke,
} from "./calc-point-panel.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F4.311 PR 6a — the standalone calculated point's panel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("in standalone mode no Grammar or Runs option has value=\"\"", () => {
    inStandaloneModeNoOptionHasAnEmptyValue();
  });

  it("in standalone mode no field carries a template placeholder", () => {
    inStandaloneModeNoFieldHasATemplatePlaceholder();
  });

  it("the live preview updates on a keystroke", async () => {
    await thePreviewUpdatesOnAKeystroke();
  });

  it("Add opens the calcPoint.set wizard only once a catalog key is chosen", async () => {
    await addOpensTheWizardOnlyOnceAKeyIsChosen();
  });

  it("Add offers no key the asset already has", async () => {
    await addOffersNoKeyTheAssetAlreadyHas();
  });

  it("an unknown reference is listed in the server's sentence before Submit", async () => {
    await anUnknownReferenceIsListedBeforeSubmit();
  });

  it("Submit sends the body with the backfill chosen", async () => {
    await submitSendsTheBackfillChosen();
  });

  it("Edit offers Delete, which hands the delete to the page", async () => {
    await editOffersDeleteThatCallsOnDelete();
  });

  it("Cancel after a formula-only edit on Edit asks before leaving", async () => {
    await cancelAfterAFormulaOnlyEditOnEditAsks();
  });

  it("Cancel after a formula-only edit on Add asks before leaving", async () => {
    await cancelAfterAFormulaOnlyEditOnAddAsks();
  });

  it("Cancel on an untouched Edit leaves at once", async () => {
    await cancelOnAnUntouchedEditLeavesAtOnce();
  });
});
