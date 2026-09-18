import { describe, it } from "vitest";

import { runUpdateBodyTemplateSourceRulesTests } from "./dashboard-templates.schema.spec";

/** `F3.61` Task 2 — Vitest entry point. Assertions live in the sibling `.spec`
 * (ADR 0014). */
describe("F3.61 — the template PATCH body refuses a both-kinds widget and a mis-shaped source", () => {
  it("reaches sectionTemplateContentSchema's two superRefine nodes through .strict() and .optional()", () => {
    runUpdateBodyTemplateSourceRulesTests();
  });
});
