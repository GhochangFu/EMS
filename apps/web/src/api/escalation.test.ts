import { afterEach, describe, it, vi } from "vitest";

import {
  arrayMessageJoinsIntoOneSentence,
  emptyBodyFallsBackToTheLabelAndStatus,
  nonJsonBodyPassesThroughUnchanged,
  stringMessageReadsAsThatSentence,
} from "./escalation.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6). */
describe("F4.204 escalation client error messages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("joins an array message into one sentence", async () => {
    await arrayMessageJoinsIntoOneSentence();
  });

  it("reads a string message as that sentence", async () => {
    await stringMessageReadsAsThatSentence();
  });

  it("falls back to the label and status on an empty body", async () => {
    await emptyBodyFallsBackToTheLabelAndStatus();
  });

  it("passes a non-JSON body through unchanged", async () => {
    await nonJsonBodyPassesThroughUnchanged();
  });
});
