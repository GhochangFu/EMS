import { describe, it } from "vitest";

import {
  assertTheHealthCapsAreExported,
  assertTheStandardBandsAreTheFiveLiteralRows,
  assertTheStandardBandsParseWithTheSchema,
} from "./standard-health-bands.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.355 PR 1 — STANDARD_HEALTH_BANDS is the one declaration (ADR 0050 Amendment 4)", () => {
  it("is the five literal rows, in order", () => {
    assertTheStandardBandsAreTheFiveLiteralRows();
  });

  it("parses with templateHealthSchema", () => {
    assertTheStandardBandsParseWithTheSchema();
  });

  it("exports MAX_HEALTH_BANDS and MAX_HEALTH_WEIGHT", () => {
    assertTheHealthCapsAreExported();
  });
});
