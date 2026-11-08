import { describe, it } from "vitest";

import { assertTheR6RuleAcceptsRegionNamesOnly } from "./time-zone.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("the R-6 zone rule (moved by F4.339)", () => {
  it("accepts region names and refuses slash-less, lower-case and unknown names", () => {
    assertTheR6RuleAcceptsRegionNamesOnly();
  });
});
