import { describe, it } from "vitest";

import { runSectionTemplateWidgetIdentityTests } from "./dashboard-templates.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.61 — a template widget binds asset roles or catalog sources, never both", () => {
  it("refuses both kinds, accepts neither or either, and describes all three identity rules", () => {
    runSectionTemplateWidgetIdentityTests();
  });
});
