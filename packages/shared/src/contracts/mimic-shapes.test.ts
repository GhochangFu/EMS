import { describe, it } from "vitest";

import * as spec from "./mimic-shapes.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F3.32f — the mimic shape grammar (ADR 0086 decision 9)", () => {
  const cases = Object.entries(spec);

  it("has its claims", () => {
    if (cases.length !== 24) {
      throw new Error(`expected 24 claims, found ${cases.length}`);
    }
  });

  for (const [name, fn] of cases) {
    it(name, () => {
      (fn as () => void)();
    });
  }
});
