import { describe, it } from "vitest";

import {
  runDashboardBuilderTests,
  runDashboardGridTests,
  runDashboardWidgetPointDtoTests,
  runWidgetPointCardinalityTests,
} from "./dashboard-builder.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.1a — the dashboard widget vocabulary and config union", () => {
  it("closes the vocabulary, discriminates the config, and narrows through the DTO", () => {
    runDashboardBuilderTests();
  });
});

describe("F3.1d Unit 2 — DASHBOARD_GRID wired into dashboardWidgetIdentitySchema", () => {
  it("reads the single-source grid bounds rather than a private 11/12/24", () => {
    runDashboardGridTests();
  });
});

describe("ADR 0047 Amendment 2 — per-type point cardinality", () => {
  it("covers every widget type and stays inside the global cap", () => {
    runWidgetPointCardinalityTests();
  });
});

describe("F3.1b — the widened point-binding DTO", () => {
  it("carries assetId/pointKey/unit, so a caller can build a pointRef", () => {
    runDashboardWidgetPointDtoTests();
  });
});
