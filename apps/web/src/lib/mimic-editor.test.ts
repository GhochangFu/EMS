import { describe, it } from "vitest";

import * as spec from "./mimic-editor.spec";

/**
 * Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). Every exported
 * `run*` in the spec holds one claim and gets its own `it()`, so a failure names its claim and
 * never hides the ones after it.
 */
describe("mimic editor reducer (F3.32c U6a)", () => {
  const cases = Object.entries(spec).filter(([name]) => name.startsWith("run"));

  it("has its claims", () => {
    if (cases.length < 100) {
      throw new Error(`expected at least 100 run* claims, found ${cases.length}`);
    }
  });

  for (const [name, fn] of cases) {
    it(name, () => {
      (fn as () => void)();
    });
  }
});
