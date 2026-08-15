import { describe, it } from "vitest";

import { runValueProvenanceTests } from "./value-provenance.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("value-provenance", () => {
  it("separates live readings from static and simulated values", () => {
    runValueProvenanceTests();
  });
});
