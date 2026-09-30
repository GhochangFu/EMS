import { describe, it } from "vitest";

import * as spec from "./index.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F3.32e — the mimic symbol library registry (ADR 0084)", () => {
  const cases = Object.entries(spec);

  it("has its claims", () => {
    if (cases.length !== 10) {
      throw new Error(`expected 10 claims, found ${cases.length}`);
    }
  });

  for (const [name, fn] of cases) {
    it(name, () => {
      (fn as () => void)();
    });
  }
});
