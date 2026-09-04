import { describe, it } from "vitest";

import {
  runQualifiedRefRangeTests,
  runSafeTokenizeDialectTests,
  runStringAndScopeRangeTests,
  runV1RefRangeTests,
} from "./calc-token-ranges.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("calc token ranges", () => {
  it("keeps a v1 ref's range, braces included", () => {
    runV1RefRangeTests();
  });

  it("spans a qualified ref over its braces and asset-code prefix", () => {
    runQualifiedRefRangeTests();
  });

  it("spans a string over its quotes and a scope over its text", () => {
    runStringAndScopeRangeTests();
  });

  it("threads the dialect through safeTokenize and defaults to v1", () => {
    runSafeTokenizeDialectTests();
  });
});
