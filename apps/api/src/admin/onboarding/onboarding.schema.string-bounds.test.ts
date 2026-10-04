import { describe, it } from "vitest";

import { runDraftStringBoundTests } from "./onboarding.schema.string-bounds.spec";

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). */
describe("onboarding.schema — string bounds (F4.104, F3.22)", () => {
  it("bounds every draft string field at its column width, length only (F4.104)", () => {
    runDraftStringBoundTests();
  });
});
