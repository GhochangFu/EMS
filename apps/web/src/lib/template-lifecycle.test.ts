import { describe, it } from "vitest";

import {
  runCapabilityTableTests,
  runEveryStatusIsCoveredTests,
  runFormulaReadOnlyInvariantTests,
  runStatusToneTests,
} from "./template-lifecycle.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("template lifecycle", () => {
  it("answers every status the contract declares", () => {
    runEveryStatusIsCoveredTests();
  });

  it("offers exactly the actions the API permits at each status", () => {
    runCapabilityTableTests();
  });

  it("never allows an editable formula field on a non-editable version", () => {
    runFormulaReadOnlyInvariantTests();
  });

  it("gives every status a distinct pill tone", () => {
    runStatusToneTests();
  });
});
