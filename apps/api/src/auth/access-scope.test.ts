import { describe, it } from "vitest";

import { runAccessScopeTests } from "./access-scope.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("access-scope", () => {
  it("gives operator and viewer a grant-backed read scope", () => {
    runAccessScopeTests();
  });
});
