import { describe, it } from "vitest";

import { runTemplateKpiV2Tests } from "./asset-templates-content-kpi-v2.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("asset-templates content schema — KPIs under bms-calc-v2", () => {
  it("widens the dialect (ADR 0055 decision 2) and exempts cross-asset refs from pointKeys", () => {
    runTemplateKpiV2Tests();
  });
});
