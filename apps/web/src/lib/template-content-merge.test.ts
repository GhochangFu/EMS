import { describe, it } from "vitest";

import {
  runCleanContentIsWritableTests,
  runDoesNotInventContentVersionTests,
  runDoesNotMutateStoredTests,
  runDropsUnsafeKeysTests,
  runEachSectionIsIndependentTests,
  runEmptySectionWritesAnArrayTests,
  runPreservesEveryOtherKeyTests,
  runUnwritableKeysAreClassifiedTests,
} from "./template-content-merge.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("template content merge", () => {
  it("preserves every key the edit does not touch", () => {
    runPreservesEveryOtherKeyTests();
  });

  it("keeps the two authored sections independent", () => {
    runEachSectionIsIndependentTests();
  });

  it("writes an empty section as [] rather than deleting it", () => {
    runEmptySectionWritesAnArrayTests();
  });

  it("never invents contentVersion", () => {
    runDoesNotInventContentVersionTests();
  });

  it("does not carry prototype-pollution keys through", () => {
    runDropsUnsafeKeysTests();
  });

  it("does not mutate the stored content or alias the caller's array", () => {
    runDoesNotMutateStoredTests();
  });

  it("reports nothing for content the contract still accepts", () => {
    runCleanContentIsWritableTests();
  });

  it("classifies reserved, unknown and unsafe keys separately", () => {
    runUnwritableKeysAreClassifiedTests();
  });
});
