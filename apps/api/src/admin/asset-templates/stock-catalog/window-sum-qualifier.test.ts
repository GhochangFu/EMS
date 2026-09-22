import { describe, it } from "vitest";

import {
  runCalendarWindowRowsExistTests,
  runEverySumRowCarriesTheQualifierTests,
  runNoDeltaRowCarriesTheQualifierTests,
} from "./window-sum-qualifier.spec";

/**
 * Vitest entry point for `window-sum-qualifier.spec.ts` — assertions live in
 * the `.spec` sibling (ADR 0014), and the wrapper is named after it so
 * `tests/repo-invariants.test.ts`'s by-name pairing holds and the spec counts
 * towards coverage.
 */
describe("E4.2 PR 2 sweep — a calendar-window sum says it is an estimate", () => {
  it("the catalog holds the rows this claim is about", () => {
    runCalendarWindowRowsExistTests();
  });

  it("every sum-authored calendar-window sustainability row carries the qualifier", () => {
    runEverySumRowCarriesTheQualifierTests();
  });

  it("no delta-authored row carries it — the control", () => {
    runNoDeltaRowCarriesTheQualifierTests();
  });
});
