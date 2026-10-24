// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aRefusedPreviewShowsTheDescribersSentence,
  aSecondSubmitAfterACommitSendsNothing,
  nextIsDisabledWhenThePreviewAcceptsNoRow,
  nextIsDisabledWithoutAPreview,
  theFileIsNotAWizardValue,
  theWizardCommitsTheChosenFileAndOptions,
} from "./telemetry-import-page.spec";

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

describe("F4.204 telemetry import page — a refusal reads as a sentence", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("F4.204 a refused preview shows the describer's sentence unchanged", async () => {
    await aRefusedPreviewShowsTheDescribersSentence();
  }, CASE_TIMEOUT_MS);

  it("F4.283: the wizard commits the chosen file and the options", async () => {
    await theWizardCommitsTheChosenFileAndOptions();
  }, CASE_TIMEOUT_MS);

  it("F4.283: Next is disabled without a preview", async () => {
    await nextIsDisabledWithoutAPreview();
  }, CASE_TIMEOUT_MS);

  it("F4.283: Next is disabled when the preview accepts no row", async () => {
    await nextIsDisabledWhenThePreviewAcceptsNoRow();
  }, CASE_TIMEOUT_MS);

  it("F4.283: a second Submit after a commit sends nothing", async () => {
    await aSecondSubmitAfterACommitSendsNothing();
  }, CASE_TIMEOUT_MS);

  it("F4.283: the file is not a wizard value", async () => {
    await theFileIsNotAWizardValue();
  }, CASE_TIMEOUT_MS);
});
