import { describe, it } from "vitest";

import {
  runSectionTemplateWidgetIdentityTests,
  runTemplateWidgetSourceRulesTests,
} from "./dashboard-templates.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.61 — a template widget binds asset roles or catalog sources, never both", () => {
  it("refuses both kinds, accepts neither or either, and describes all three identity rules", () => {
    runSectionTemplateWidgetIdentityTests();
  });
});

describe("F3.61 Amendment 1 — a template widget's sources fit its shape, its cap and its dataset's columns", () => {
  it("refuses a mis-shaped source, an over-cap source count, and an undeclared or duplicate column", () => {
    runTemplateWidgetSourceRulesTests();
  });
});
