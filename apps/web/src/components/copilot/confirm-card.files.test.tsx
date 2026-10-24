// @vitest-environment jsdom
import { focusManager } from "@tanstack/react-query";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { resetCopilotStore } from "../../stores/copilot-store";
import { resetWizardStore } from "../../stores/wizard-store";
import {
  aFileSentWithTheTurnEnablesConfirm,
  aKeptFileEnablesConfirm,
  aMatchingPickHandsUpTheFile,
  aMismatchingPickShowsTheSentence,
  anUnhashablePickIsHandedUp,
  anUnhashablePickSaysItIsUnchecked,
  theImportCardNamesTheMappings,
  theImportCardShowsTheCounts,
  withoutAKeptFileConfirmIsDisabled,
} from "./confirm-card.files.spec";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetCopilotStore();
  resetWizardStore();
  focusManager.setFocused(undefined);
  window.localStorage.clear();
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042). */
describe("F4.283 — the file-upload Confirm card (ADR 0099 Amendment 8 Q18, Q19)", () => {
  it("without a kept file asks for it again and disables Confirm", () => withoutAKeptFileConfirmIsDisabled(), 15_000);
  it("a kept file enables Confirm", () => aKeptFileEnablesConfirm(), 15_000);
  it("a file sent with the turn enables Confirm", () => aFileSentWithTheTurnEnablesConfirm(), 15_000);
  it("the import card shows the route's counts", () => theImportCardShowsTheCounts(), 15_000);
  it("the import card names the mappings to create", () => theImportCardNamesTheMappings(), 15_000);
  it("a mismatching pick shows the hash sentence", () => aMismatchingPickShowsTheSentence(), 15_000);
  it("a matching pick hands up the file", () => aMatchingPickHandsUpTheFile(), 15_000);
  it("a pick this browser cannot hash is handed up", () => anUnhashablePickIsHandedUp(), 15_000);
  it("a pick this browser cannot hash says it is unchecked", () => anUnhashablePickSaysItIsUnchecked(), 15_000);
});
