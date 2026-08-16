import { describe, it } from "vitest";

import { runRuleCategoryAuthoringTests } from "./rule-category-authoring.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("rule-category-authoring", () => {
  it("locks a category the builder cannot author, and omits it from the payload", () => {
    runRuleCategoryAuthoringTests();
  });
});
