import { describe, it } from "vitest";

import {
  runDashboardKpisEnergyShownTest,
  runLocationKpiSummaryRequiresTypeLabelTest,
  runMapSiteDtoRequiresKindLabelTest,
  runRowWithCodeParsesTest,
  runRowWithoutCodeIsRefusedTest,
} from "./dashboard.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.70 — code on the location KPI row (ADR 0076 decision 9, D7)", () => {
  it("K1 — refuses a row without code", () => {
    runRowWithoutCodeIsRefusedTest();
  });

  it("K2 — accepts the same row with code: RSMOC-WC", () => {
    runRowWithCodeParsesTest();
  });
});

describe("F4.157 — mapSiteDtoSchema gains kindLabel (ADR 0077 D8)", () => {
  it("C3 — refuses a site without kindLabel, parses one with it", () => {
    runMapSiteDtoRequiresKindLabelTest();
  });
});

describe("F4.157 U8 — locationKpiSummarySchema gains typeLabel (OQ4)", () => {
  it("K2 — refuses a row without typeLabel, parses one with it", () => {
    runLocationKpiSummaryRequiresTypeLabelTest();
  });
});

describe("F4.375 — the estate KPI payload says whether energy is shown (ADR 0133 Amendment 2)", () => {
  it("U2 — energyShown is a required boolean; totalKw is nullable, never undefined", () => {
    runDashboardKpisEnergyShownTest();
  });
});
