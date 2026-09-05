import { describe, it } from "vitest";

import { runResolveAggregateTests } from "./calc-aggregate.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("resolveAggregate — ADR 0055 decision 11's coverage rule", () => {
  it("refuses no_members, fails closed on a null ratio, compares fresh/declared against a set ratio, and passes -0 through", () => {
    runResolveAggregateTests();
  });
});
