import { describe, it } from "vitest";

import { runHealthRollupSqlTests } from "./health-rollup-sql.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6). */
describe("health-rollup-sql", () => {
  it("builds the raw and level roll-up SQL per ADR 0050 + Amendment 1", async () => {
    await runHealthRollupSqlTests();
  });
});
