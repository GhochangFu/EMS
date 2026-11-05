import { describe, it } from "vitest";

import * as spec from "./mimic-editor.unsaved.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F4.308 hasUnsavedEdits", () => {
  const cases = Object.entries(spec);

  it("has its claims", () => {
    if (cases.length < 5) {
      throw new Error(`expected at least 5 claims, found ${cases.length}`);
    }
  });

  for (const [name, fn] of cases) {
    it(name, () => {
      (fn as () => void)();
    });
  }
});
