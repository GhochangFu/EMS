import { describe, it } from "vitest";

import { runSupervisorBufferTests } from "./supervisor-buffer.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("endpoint supervisor: the disk tier", () => {
  it("spills on a failed write, holds the database off, and replays on the §5 backoff", async () => {
    await runSupervisorBufferTests();
  });
});
