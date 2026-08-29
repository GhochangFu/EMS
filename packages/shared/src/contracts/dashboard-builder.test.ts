import { describe, it } from "vitest";

import {
  runDashboardBuilderTests,
  runWidgetPointCardinalityTests,
} from "./dashboard-builder.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.1a — the dashboard widget vocabulary and config union", () => {
  it("closes the vocabulary, discriminates the config, and narrows through the DTO", () => {
    runDashboardBuilderTests();
  });
});

describe("ADR 0047 Amendment 2 — per-type point cardinality", () => {
  it("covers every widget type and stays inside the global cap", () => {
    runWidgetPointCardinalityTests();
  });
});
