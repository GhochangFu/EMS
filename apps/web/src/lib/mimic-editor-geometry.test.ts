import { describe, it } from "vitest";

import * as spec from "./mimic-editor-geometry.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). One `it()` per claim. */
describe("mimic editor geometry (F3.32c U6a)", () => {
  const cases = Object.entries(spec).filter(([name]) => name.startsWith("run"));

  it("has its claims", () => {
    if (cases.length < 8) {
      throw new Error(`expected at least 8 run* claims, found ${cases.length}`);
    }
  });

  for (const [name, fn] of cases) {
    it(name, () => {
      (fn as () => void)();
    });
  }
});
