import { describe, it } from "vitest";

import { runSampleQueueTests } from "./sample-queue.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("bounded sample queue", () => {
  it("drops oldest at capacity and counts every loss", () => {
    runSampleQueueTests();
  });
});
