// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { aRefusedPreviewShowsTheDescribersSentence } from "./telemetry-import-page.spec";

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
});
