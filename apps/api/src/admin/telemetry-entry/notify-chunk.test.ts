import { describe, it } from "vitest";

import { runNotifyChunkTests } from "./notify-chunk.spec";

/**
 * Vitest entry point. Assertions live in the sibling `.spec.ts` module
 * (ADR 0014). No database dependency — `chunkForNotify` is a pure function.
 */
describe("chunkForNotify", () => {
  it("splits, preserves, and never drops readings across the byte cap", () => {
    runNotifyChunkTests();
  });
});
