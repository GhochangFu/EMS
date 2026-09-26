import { describe, it } from "vitest";

import { runRowWithCodeParsesTest, runRowWithoutCodeIsRefusedTest } from "./dashboard.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.70 — code on the location KPI row (ADR 0076 decision 9, D7)", () => {
  it("K1 — refuses a row without code", () => {
    runRowWithoutCodeIsRefusedTest();
  });

  it("K2 — accepts the same row with code: RSMOC-WC", () => {
    runRowWithCodeParsesTest();
  });
});
