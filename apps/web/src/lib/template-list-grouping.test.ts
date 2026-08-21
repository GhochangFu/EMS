import { describe, it } from "vitest";

import {
  runDoesNotMutateInputTests,
  runGroupsByOrganizationAndCodeTests,
  runGroupsVersionsTests,
  runOrderIsIndependentOfInputTests,
  runStatusFilterTests,
} from "./template-list-grouping.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("template list grouping", () => {
  it("collapses versions into one group, newest first", () => {
    runGroupsVersionsTests();
  });

  it("orders the output independently of the API's row order", () => {
    runOrderIsIndependentOfInputTests();
  });

  it("keeps two organizations' identical codes apart", () => {
    runGroupsByOrganizationAndCodeTests();
  });

  it("filters before grouping and drops emptied groups", () => {
    runStatusFilterTests();
  });

  it("does not reorder the caller's array", () => {
    runDoesNotMutateInputTests();
  });
});
