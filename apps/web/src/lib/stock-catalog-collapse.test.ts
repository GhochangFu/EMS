import { describe, it } from "vitest";

import {
  runMalformedContentFailsOpenOrFiltersTests,
  runNothingStoredYieldsEmptyTests,
  runStoredCodesReadBackInOrderTests,
  runThrowingGetItemFailsOpenTests,
  runThrowingThunkFailsOpenTests,
  runWriteSortsAndWritesOneEntryTests,
  runWriteSwallowsThrowingAccessorAndSetItemTests,
} from "./stock-catalog-collapse.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("stock catalog collapse storage", () => {
  it("reads [] when nothing is stored", () => {
    runNothingStoredYieldsEmptyTests();
  });

  it("reads stored codes back in order", () => {
    runStoredCodesReadBackInOrderTests();
  });

  it("fails open when the storage thunk throws on access", () => {
    runThrowingThunkFailsOpenTests();
  });

  it("fails open when getItem itself throws", () => {
    runThrowingGetItemFailsOpenTests();
  });

  it("fails open on malformed JSON, a non-array, and filters a mixed array to strings", () => {
    runMalformedContentFailsOpenOrFiltersTests();
  });

  it("writes one sorted entry under the one key", () => {
    runWriteSortsAndWritesOneEntryTests();
  });

  it("swallows a throwing accessor and a throwing setItem on write", () => {
    runWriteSwallowsThrowingAccessorAndSetItemTests();
  });
});
