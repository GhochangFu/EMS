import { describe, it } from "vitest";

import { runRaiseRetryTests } from "./raise-retry.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.51 raise retry", () => {
  it("owes a channel the raise only on the evidence of a row, and blocks on the event path's own rules", () => {
    runRaiseRetryTests();
  });
});
