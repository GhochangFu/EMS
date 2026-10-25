// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { resetWizardStore } from "../../stores/wizard-store";
import {
  theDisableReviewCardIsRed,
  theDisableSubmitSendsThePlainRequest,
  thePublishReviewShowsTheLiveLine,
} from "./rule-lifecycle-wizard.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014); the jsdom docblock is here (ADR 0042). */
describe("F4.278 — the Rule Engine's lifecycle wizards (ADR 0099 Amendment 8 D3)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetWizardStore();
  });

  it("the disable wizard's Review card is red", () => theDisableReviewCardIsRed());
  it("the publish wizard's Review shows the live line", () => thePublishReviewShowsTheLiveLine());
  it("Submit sends the plain PATCH with enabled false and no copilot header", () => theDisableSubmitSendsThePlainRequest());
});
