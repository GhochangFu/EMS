import { describe, it } from "vitest";

import { runDiskBufferTests } from "./disk-buffer.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("disk buffer store", () => {
  it("spills whole lines, bounds by age and bytes, and replays oldest-first", async () => {
    await runDiskBufferTests();
  });
});
