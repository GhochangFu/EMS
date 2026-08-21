import { describe, it } from "vitest";

import { runCalcDslBarrelTests } from "./index.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("bms-calc-v1 barrel exports", () => {
  it("re-exports tokenize, CalcTokenizeError, Token and TokenKind for F2.5's editor", () => {
    runCalcDslBarrelTests();
  });
});
