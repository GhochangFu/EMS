// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { resetWizardStore } from "../../stores/wizard-store";
import {
  clickingOpensTheWizardInline,
  createdShowsTheSentenceAndClosesTheWizard,
  theButtonIsAbsentForAnAssetGroupAdmin,
  theButtonIsAbsentWithoutAPrefill,
  theButtonShowsForALocationAdmin,
} from "./schedule-button.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.303 U16 Schedule", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    resetWizardStore();
  });

  it("the button shows for a location admin", () => theButtonShowsForALocationAdmin());
  it("the button is absent for an asset-group admin", () => theButtonIsAbsentForAnAssetGroupAdmin());
  it("the button is absent without a prefill", () => theButtonIsAbsentWithoutAPrefill());
  it("clicking opens the wizard inline, prefilled", () => clickingOpensTheWizardInline());
  it("created shows the sentence and closes the wizard", () => createdShowsTheSentenceAndClosesTheWizard());
});
