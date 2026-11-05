// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aPinnedAssetInTheSelectionDisablesTheButton,
  aPinnedAssetInTheSelectionIsNamed,
  aTemplateLessSelectionOpensTheWizard,
  aSelectionThatStopsQualifyingClosesTheWizardForGood,
  anEmptySelectionDisablesTheButton,
  theButtonCountsTheCheckedRows,
} from "./assets-page.adopt.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.312 PR 3 — the asset list's Adopt a template bulk action", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("the button counts the checked rows", async () => {
    await theButtonCountsTheCheckedRows();
  });
  it("a template-less selection opens the wizard", async () => {
    await aTemplateLessSelectionOpensTheWizard();
  });
  it("a pinned asset in the selection disables the button", async () => {
    await aPinnedAssetInTheSelectionDisablesTheButton();
  });
  it("a pinned asset in the selection is named", async () => {
    await aPinnedAssetInTheSelectionIsNamed();
  });
  it("a selection that stops qualifying closes the wizard for good", async () => {
    await aSelectionThatStopsQualifyingClosesTheWizardForGood();
  });
  it("an empty selection disables the button", async () => {
    await anEmptySelectionDisablesTheButton();
  });
});
