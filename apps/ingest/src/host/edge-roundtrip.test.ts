import { describe, it } from "vitest";

import { anOutageSpillsAndReplaysAtTheOriginalRx } from "./edge-roundtrip.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E7.2 — the edge round trip in one process (plan T5.8)", () => {
  it("spills during a 503 outage and replays every sample once at its original rx", async () => {
    await anOutageSpillsAndReplaysAtTheOriginalRx();
  }, 30_000);
});
