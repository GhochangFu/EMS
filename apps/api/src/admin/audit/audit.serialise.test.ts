import { describe, it } from "vitest";

import { runAuditSerialiseTests } from "./audit.serialise.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("audit serialise", () => {
  it("escapes CSV correctly and neutralises spreadsheet formulas", () => {
    runAuditSerialiseTests();
  });
});
