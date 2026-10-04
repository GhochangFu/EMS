import { describe, it } from "vitest";

import {
  assertABigTemplateResultIsCut,
  assertGetTemplateByCodeReturnsPointsAndVariables,
  assertGetTemplateByStockCodeReturnsTheStockEntry,
  assertGetTemplateUnknownCodeFailsNamingIt,
  assertListStockTemplatesFiltersCodeAndName,
  assertListTemplatesIsBoundedAtOneHundred,
  assertListTemplatesIsPublishedOnlyWithHighestVersion,
  assertToolsAre20,
} from "./onboarding-template-tools.spec";

/** Vitest entry point (ADR 0014). One `it()` per claim. */
describe("onboarding template read tools (F3.22, ADR 0091 decision 3)", () => {
  it("registers 20 tools", async () => {
    await assertToolsAre20();
  });
  it("R1 lists published templates only, at the highest version", async () => {
    await assertListTemplatesIsPublishedOnlyWithHighestVersion();
  });
  it("R2 bounds list_templates at 100 and counts the rest", async () => {
    await assertListTemplatesIsBoundedAtOneHundred();
  });
  it("R3 get_template by code returns points and variables", async () => {
    await assertGetTemplateByCodeReturnsPointsAndVariables();
  });
  it("R4 get_template by stockCode returns the stock entry", async () => {
    await assertGetTemplateByStockCodeReturnsTheStockEntry();
  });
  it("R5 get_template for an unknown code fails naming it", async () => {
    await assertGetTemplateUnknownCodeFailsNamingIt();
  });
  it("R6 list_stock_templates filters code and name", async () => {
    await assertListStockTemplatesFiltersCodeAndName();
  });
  it("R7 cuts a 300-point result", async () => {
    await assertABigTemplateResultIsCut();
  });
});
