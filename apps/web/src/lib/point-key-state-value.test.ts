import { describe, it } from "vitest";

import * as spec from "./point-key-state-value.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). `node` environment. */
describe("F4.309 state-label value parser", () => {
  const cases = Object.entries(spec);

  it("has its claims", () => {
    if (cases.length < 2) {
      throw new Error(`expected at least 2 claims, found ${cases.length}`);
    }
  });

  for (const [name, fn] of cases) {
    it(name, () => {
      (fn as () => void)();
    });
  }
});
