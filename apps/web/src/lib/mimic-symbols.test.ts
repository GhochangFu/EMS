import { describe, it } from "vitest";

import * as spec from "./mimic-symbols.spec";

/**
 * Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). Every exported
 * `run*` in the spec holds one claim and gets its own `it()`.
 */
describe("mimic symbol labels and groups (F3.32d)", () => {
  const cases = Object.entries(spec).filter(([name]) => name.startsWith("run"));

  it("has its claims", () => {
    if (cases.length !== 6) {
      throw new Error(`expected 6 run* claims, found ${cases.length}`);
    }
  });

  for (const [name, fn] of cases) {
    it(name, () => {
      (fn as () => void)();
    });
  }
});
