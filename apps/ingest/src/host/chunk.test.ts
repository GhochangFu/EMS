import { describe, it } from "vitest";

import { runChunkReadingsTests } from "./chunk.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("host NOTIFY chunker", () => {
  it("splits identically to the legacy index.js implementation", () => {
    runChunkReadingsTests();
  });
});
