import { describe, it } from "vitest";

import { assertPointKeyCatalogListIsCapped } from "./onboarding-catalog.service.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("onboarding point-key catalog — how many keys one chat turn may list (F4.105)", () => {
  it("caps the catalog list at the shared bound and says how many it left out", () => {
    assertPointKeyCatalogListIsCapped();
  });
});
