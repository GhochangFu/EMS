import { describe, it } from "vitest";

import { runHostLoggerTests } from "./logger.spec.js";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("host logger", () => {
  it("emits one JSON line per event and survives non-serialisable fields", () => {
    runHostLoggerTests();
  });
});
