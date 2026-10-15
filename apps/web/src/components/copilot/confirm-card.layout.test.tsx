// @vitest-environment jsdom
import { focusManager } from "@tanstack/react-query";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { resetCopilotStore } from "../../stores/copilot-store";
import { resetWizardStore } from "../../stores/wizard-store";
import {
  aLayoutCardDrawsTheBody,
  aLayoutCardWarnsOfAnUnreachedSwitchingUnit,
  aLayoutCardWarnsOfASwitchingUnitWithNoRole,
  aLayoutCardWarnsOfNoSource,
  aReplaceCardAtTheLiveVersionHasNoNote,
  aReplaceCardDiffsAgainstTheBaselineNotTheLayoutNow,
  aReplaceCardSaysConfirmWillGive409WhenTheVersionMoved,
} from "./confirm-card.layout.spec";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetCopilotStore();
  resetWizardStore();
  focusManager.setFocused(undefined);
  window.localStorage.clear();
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042). */
describe("F3.87 PR 5 — the layout Confirm card (Amendment 3 A2, rulings Q1, Q5)", () => {
  it("draws the proposed layout and keeps Confirm enabled", () => aLayoutCardDrawsTheBody(), 15_000);
  it("warns of a layout with no source", () => aLayoutCardWarnsOfNoSource(), 15_000);
  it("warns of a switching unit with no role", () => aLayoutCardWarnsOfASwitchingUnitWithNoRole(), 15_000);
  it("warns of a switching unit no source reaches", () => aLayoutCardWarnsOfAnUnreachedSwitchingUnit(), 15_000);
  it("diffs a replace against the baseline, not the layout now", () => aReplaceCardDiffsAgainstTheBaselineNotTheLayoutNow(), 15_000);
  it("says Confirm will give 409 when the live version moved", () => aReplaceCardSaysConfirmWillGive409WhenTheVersionMoved(), 15_000);
  it("shows no version note at the live version", () => aReplaceCardAtTheLiveVersionHasNoNote(), 15_000);
});
