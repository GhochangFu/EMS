import { describe, it } from "vitest";

import { runDiskBufferBacklogTests } from "./disk-buffer-backlog.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("disk buffer store: backlog listing (ADR 0115 Amendment 1)", () => {
  it("lists every endpoint holding samples, including those found by the start-up scan", async () => {
    await runDiskBufferBacklogTests();
  });
});
