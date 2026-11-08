import { describe, it } from "vitest";

import { assertMetaTimezoneReadsOnlyAValidZone, assertUnitOfPrefersTheDeclarationThenTheCatalog } from "./onboarding-commit-values.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("values the commit derives (F4.339, ADR 0117 decisions 10 and 11)", () => {
  it("reads a meta timezone only when it is a valid zone", () => {
    assertMetaTimezoneReadsOnlyAValidZone();
  });

  it("takes a mapping's unit from the declaration, then the catalog", () => {
    assertUnitOfPrefersTheDeclarationThenTheCatalog();
  });
});
