import { describe, it } from "vitest";

import {
  runDuplicateCrossLocationClearsGroupsTests,
  runDuplicateCrossLocationDropsOverviewMimicNamingClearedTabTests,
  runDuplicatePayloadTests,
  runDuplicateSameLocationKeepsGroupsTests,
  runDuplicateSameLocationKeepsOverviewMimicTests,
  runDuplicateTabsCarriedTests,
  runFreeSlugTests,
} from "./dashboard-duplicate.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("dashboard duplicate", () => {
  it("finds the first free numbered slug, bounded and length-safe", () => {
    runFreeSlugTests();
  });

  it("builds the create body and widget set, dropping every source widget id", () => {
    runDuplicatePayloadTests();
  });

  it("F3.73: carries the source tabs without their ids", () => {
    runDuplicateTabsCarriedTests();
  });

  it("F3.73: a same-location copy keeps the tab groups and mimics", () => {
    runDuplicateSameLocationKeepsGroupsTests();
  });

  it("F3.73: a cross-location copy clears the tab groups and drops the tab mimics", () => {
    runDuplicateCrossLocationClearsGroupsTests();
  });

  it("F3.74: a cross-location copy drops and counts an Overview mimic naming a group-cleared tab", () => {
    runDuplicateCrossLocationDropsOverviewMimicNamingClearedTabTests();
  });

  it("F3.74: a same-location copy keeps an Overview mimic naming a group tab", () => {
    runDuplicateSameLocationKeepsOverviewMimicTests();
  });
});
