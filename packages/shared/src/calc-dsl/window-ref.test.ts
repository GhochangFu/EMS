import { describe, it } from "vitest";

import { runWindowKeyTests, runWindowLiteralTests } from "./window-ref.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("bms-calc-v3 window literals and keys (E4.1b)", () => {
  it("reads a rolling literal into minutes and a calendar word into its period, and names the zero and the cap", () => {
    runWindowLiteralTests();
  });

  it("builds one canonical key per window read, with a rolling window normalised to minutes", () => {
    runWindowKeyTests();
  });
});
