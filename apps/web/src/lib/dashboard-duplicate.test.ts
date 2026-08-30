import { describe, it } from "vitest";

import { runDuplicatePayloadTests, runFreeSlugTests } from "./dashboard-duplicate.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("dashboard duplicate", () => {
  it("finds the first free numbered slug, bounded and length-safe", () => {
    runFreeSlugTests();
  });

  it("builds the create body and widget set, dropping every source widget id", () => {
    runDuplicatePayloadTests();
  });
});
