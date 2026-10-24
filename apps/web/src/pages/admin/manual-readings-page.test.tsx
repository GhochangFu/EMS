// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { resetWizardStore } from "../../stores/wizard-store";
import {
  aFillSendsTheFilledAsset,
  aFillSetsTheTimestamp,
  aRefusedSubmitShowsTheSentence,
  anInvalidFormShowsTheFixSentenceWithoutACall,
  theWizardSubmitsTheSameRequest,
} from "./manual-readings-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * The `@vitest-environment jsdom` docblock is on THIS file because Vitest
 * reads it from the file it collects (ADR 0042 decision 2).
 */
/**
 * Per-case timeout, as `escalation-profiles-page.test.tsx` sets it. Measured
 * at 2–3 s alone on a dev machine; the margin is for a loaded parallel run,
 * where a `userEvent` walk through the page can pass Vitest's 5 s default.
 */
const CASE_TIMEOUT_MS = 15_000;

describe("F4.204 manual readings page — a refusal reads as a sentence", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetWizardStore();
  });

  it("F4.204 a refused submit shows the sentence, not the envelope", async () => {
    await aRefusedSubmitShowsTheSentence();
  }, CASE_TIMEOUT_MS);

  it("F4.204 control: an invalid form stays on its step and calls no API", async () => {
    await anInvalidFormShowsTheFixSentenceWithoutACall();
  }, CASE_TIMEOUT_MS);

  it("F4.283: the wizard submits the same request as the old form", async () => {
    await theWizardSubmitsTheSameRequest();
  }, CASE_TIMEOUT_MS);
  it("F4.283: a copilot fill sets the timestamp", async () => {
    await aFillSetsTheTimestamp();
  }, CASE_TIMEOUT_MS);

  it("F4.283: a copilot fill sends the filled asset", async () => {
    await aFillSendsTheFilledAsset();
  }, CASE_TIMEOUT_MS);
});
