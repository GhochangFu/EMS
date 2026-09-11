import { describe, it } from "vitest";

import { RULE_SWEEP_CASES } from "./rule-sweep.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * One `it()` per case: `assert` throws, so a bundled block would only ever
 * report its first failing claim.
 */
describe("F3.11 — runRuleSweep applies the streaming engine's write policy", () => {
  for (const c of RULE_SWEEP_CASES) {
    it(c.name, async () => {
      await c.run();
    });
  }
});
