import { describe, it } from "vitest";

import { assertEveryDatabaseRefusalIsTranslated } from "./calc-parameters.translate.spec";

/** `E4.1a` U8 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("E4.1a — calc parameter write-error translation", () => {
  it("translates every database refusal a write can meet after the gates, and nothing else", () => {
    assertEveryDatabaseRefusalIsTranslated();
  });
});
