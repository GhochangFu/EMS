import { describe, it } from "vitest";

import { runCellTests, runEffectiveValueTests, runNoTemplateTests } from "./asset-point-effective.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.25 — the effective point metadata (ADR 0056 Amendment 3 part A)", () => {
  it("coalesces the asset's own value over the template's, and marks only what came from the template", () => {
    runEffectiveValueTests();
  });

  it("reads the own five, none inherited, when there is no template", () => {
    runNoTemplateTests();
  });

  it("renders the three cells from the effective value and reads the marker as none, part or all", () => {
    runCellTests();
  });
});
