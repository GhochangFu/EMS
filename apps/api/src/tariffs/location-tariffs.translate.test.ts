import { describe, it } from "vitest";

import { assertEveryMappingWriteRefusalIsTranslated } from "./location-tariffs.translate.spec";

/** `F4.365` U5 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.365 — location tariff write-error translation", () => {
  it("translates every database refusal a mapping write can meet after the gates, and nothing else", () => {
    assertEveryMappingWriteRefusalIsTranslated();
  });
});
