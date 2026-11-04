import { describe, it } from "vitest";

import {
  aCompleteStandalonePutReachesTheStandaloneService,
  aStandaloneDeleteRemovesThePoint,
  aStandaloneGetListsTheStandalonePoints,
  aStandalonePutWithANullFormulaIsABadRequest,
  aTemplateDeleteClearsTheOverride,
  aTemplateGetListsTheOverrides,
  aTemplatePutWithAllNullReachesTheOverride,
} from "./asset-point-calc-override.controller.spec";

/** `F4.311` PR 2 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). No database. */
describe("F4.311 — the calc-points routes dispatch on the asset's kind (ADR 0109 decision 4)", () => {
  it("refuses a standalone PUT with a null formula at the standalone schema", () =>
    aStandalonePutWithANullFormulaIsABadRequest());
  it("passes a template asset's all-null PUT to the override service", () => aTemplatePutWithAllNullReachesTheOverride());
  it("passes a complete standalone PUT to the standalone service", () =>
    aCompleteStandalonePutReachesTheStandaloneService());
  it("lists standalone points on a template-less asset", () => aStandaloneGetListsTheStandalonePoints());
  it("lists overrides on a template asset", () => aTemplateGetListsTheOverrides());
  it("removes a standalone point on DELETE", () => aStandaloneDeleteRemovesThePoint());
  it("clears an override on DELETE", () => aTemplateDeleteClearsTheOverride());
});
