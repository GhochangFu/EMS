import { describe, it } from "vitest";

import { runDiskBufferModeTests } from "./disk-buffer-modes.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("disk buffer store: file modes", () => {
  it("creates every directory 0o700 and every segment 0o600", async () => {
    await runDiskBufferModeTests();
  });
});
