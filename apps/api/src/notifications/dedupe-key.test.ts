import { describe, it } from "vitest";

import { runDedupeKeyTests } from "./dedupe-key.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.10 dedupe key", () => {
  it("keeps the raise key, suffixes an escalation step or a clear, and stays within the column", () => {
    runDedupeKeyTests();
  });
});
