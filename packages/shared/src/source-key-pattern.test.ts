import { describe, it } from "vitest";

import {
  runPatternConstantTests,
  runPatternTokenTests,
  runPatternVariableTests,
  runPrototypeGuardTests,
  runSubstitutionTests,
} from "./source-key-pattern.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.7 — the source-key `{token}` grammar (ADR 0056 decision 10)", () => {
  it("pins the token regex and the reserved variable", () => {
    runPatternConstantTests();
  });

  it("lists one pattern's distinct tokens in first-appearance order", () => {
    runPatternTokenTests();
  });

  it("lists the variables across many patterns, minus the reserved one", () => {
    runPatternVariableTests();
  });

  it("substitutes known tokens, leaves unknown ones literal and names them", () => {
    runSubstitutionTests();
  });

  it("keeps the instantiate service's prototype guard", () => {
    runPrototypeGuardTests();
  });
});
