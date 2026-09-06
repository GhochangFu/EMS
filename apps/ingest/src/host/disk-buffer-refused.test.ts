import { describe, it } from "vitest";

import { runDiskBufferRefusedTests } from "./disk-buffer-refused.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("disk buffer store: a refused record and the append that reaches it", () => {
  it("offers a flagged segment again once an append proves the file is reachable", async () => {
    await runDiskBufferRefusedTests();
  });
});
