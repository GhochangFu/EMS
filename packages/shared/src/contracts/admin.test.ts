import { describe, it } from "vitest";

import {
  runAdminLocationDtoAcceptsPumpStationTest,
  runAdminLocationDtoParentIdTests,
  runAdminLocationDtoRequiresTypeLabelTest,
  runAssetInstantiationResultDashboardFieldsTests,
  runAssetInstantiationResultSeededRulesTests,
  runSeededRuleDriftVerdictTests,
  runSeededRuleValuesPhilosophyRowTests,
} from "./admin.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("E2.4 — the instantiate result reports seeded rules (ADR 0058 decisions 6, 8, 10)", () => {
  it("rejects an instantiate result missing ruleCount, or an asset entry missing seededRules", () => {
    runAssetInstantiationResultSeededRulesTests();
  });

  it("rejects an unknown drift verdict", () => {
    runSeededRuleDriftVerdictTests();
  });

  it("accepts a philosophy row's all-null operator/threshold baseline", () => {
    runSeededRuleValuesPhilosophyRowTests();
  });
});

describe("F3.2 — dashboardCount and per-asset dashboards report (ADR 0067 decision 5)", () => {
  it("rejects a result missing dashboardCount, or an asset entry missing dashboards", () => {
    runAssetInstantiationResultDashboardFieldsTests();
  });
});

describe("F4.157 — adminLocationDtoSchema.type widens off the closed enum (ADR 0077 D1)", () => {
  it("C2 — parses an admin location row with type: pump_station", () => {
    runAdminLocationDtoAcceptsPumpStationTest();
  });
});

describe("F4.162 — adminLocationDtoSchema.typeLabel (ADR 0077 Amendment 1, OQ2)", () => {
  it("C10 — refuses a row without typeLabel", () => {
    runAdminLocationDtoRequiresTypeLabelTest();
  });
});

describe("F2.10 — adminLocationDtoSchema.parentId (ADR 0098)", () => {
  it("accepts null and a string parentId, and refuses a row without it", () => {
    runAdminLocationDtoParentIdTests();
  });
});
