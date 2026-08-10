import { describe, it } from "vitest";

import { runReportsSerialiseTests } from "./reports.serialise.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("energy report serialise (ADR 0026)", () => {
  it("guards the three untrusted cells without touching numbers or benign data", () => {
    runReportsSerialiseTests();
  });
});
