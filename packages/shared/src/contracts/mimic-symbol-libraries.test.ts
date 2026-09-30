import { describe, it } from "vitest";

import * as spec from "./mimic-symbol-libraries.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F3.32f — the organization symbol contracts (ADR 0086 decisions 2, 6, 7)", () => {
  const cases = Object.entries(spec).filter(([, value]) => typeof value === "function");

  it("has its claims", () => {
    if (cases.length !== 15) {
      throw new Error(`expected 15 claims, found ${cases.length}`);
    }
  });

  for (const [name, fn] of cases) {
    it(name, () => {
      (fn as () => void)();
    });
  }
});
