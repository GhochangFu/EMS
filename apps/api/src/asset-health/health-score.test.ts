import { describe, it } from "vitest";

import { runHealthScoreTests } from "./health-score.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, §4.6). */
describe("health-score", () => {
  it("scores tags and assets per ADR 0050 + Amendment 1's rules", async () => {
    await runHealthScoreTests();
  });
});
