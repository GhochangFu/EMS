import { describe, it } from "vitest";

import {
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
