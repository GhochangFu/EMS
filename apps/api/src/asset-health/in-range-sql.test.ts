import { describe, it } from "vitest";

import { runInRangeSqlTests } from "./in-range-sql.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("in-range-sql", () => {
  it("closes the operator vocabulary and matches compare() without a database", async () => {
    await runInRangeSqlTests();
  });
});
