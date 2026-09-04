import { describe, it } from "vitest";

import {
  runDoesNotMutateInputTests,
  runEmptyEntriesYieldNoGroupsTests,
  runNeverEmitsEmptyGroupTests,
  runOrdersBySortOrderAndOmitsEmptyDomainTests,
  runPreservesCatalogOrderWithinGroupTests,
  runUndefinedVocabularyOrdersByCodeTests,
  runUnknownDomainSortsLastByCodeTests,
} from "./stock-catalog-groups.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("stock catalog domain grouping", () => {
  it("groups by domain present, ordered by the vocabulary's sortOrder, and omits empty domains", () => {
    runOrdersBySortOrderAndOmitsEmptyDomainTests();
  });

  it("keeps catalog order for entries within a group", () => {
    runPreservesCatalogOrderWithinGroupTests();
  });

  it("still groups an unknown domain, reading its bare code, sorted after every known domain", () => {
    runUnknownDomainSortsLastByCodeTests();
  });

  it("orders by code and labels by code when the vocabulary has not loaded", () => {
    runUndefinedVocabularyOrdersByCodeTests();
  });

  it("yields no groups for an empty entry array", () => {
    runEmptyEntriesYieldNoGroupsTests();
  });

  it("does not mutate or reorder the caller's array", () => {
    runDoesNotMutateInputTests();
  });

  it("never emits a group with zero entries", () => {
    runNeverEmitsEmptyGroupTests();
  });
});
