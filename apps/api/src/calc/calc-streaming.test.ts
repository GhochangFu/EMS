import { describe, it } from "vitest";

import { runCalcStreamingTests } from "./calc-streaming.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("calc streaming host — evaluateStreamingBatch", () => {
  it("filters to inputs, isolates by asset, skips on stale, and survives one formula's failure", async () => {
    await runCalcStreamingTests();
  });
});
