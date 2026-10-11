// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { resetWizardStore } from "../../stores/wizard-store";
import {
  aBodylessRouteIsReviewAlone,
  aFillForThisEntryFillsItsStep,
  cancelAsksBeforeLeavingAChangedWizard,
  cancelAsksOnlyWhenChanged,
  nextStaysOnAWrongStep,
  reviewRefusesABodyTheRouteWouldRefuse,
  reviewSubmitsThePlainBody,
  showsTheEntrysStepsThenReview,
} from "./wizard-shell.spec";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetWizardStore();
});

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042). */
describe("F3.85 PR 8 wizard shell — every catalog route is a stepper (ADR 0099 decision 6, ruling Q6)", () => {
  it("shows the entry's steps, then Review", () => showsTheEntrysStepsThenReview());
  it("stays on a step whose fields are wrong", () => nextStaysOnAWrongStep());
  it("submits the plain body from Review, never through the copilot", () => reviewSubmitsThePlainBody());
  it("does not submit a body the route would refuse", () => reviewRefusesABodyTheRouteWouldRefuse());
  it("is the Review step alone for a bodyless route", () => aBodylessRouteIsReviewAlone());
  it("takes a copilot fill for its own entry only", () => aFillForThisEntryFillsItsStep());
  it("leaves a clean wizard at once", () => cancelAsksOnlyWhenChanged());
  it("asks before leaving a changed wizard", () => cancelAsksBeforeLeavingAChangedWizard());
});
