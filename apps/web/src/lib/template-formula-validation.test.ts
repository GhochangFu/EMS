import { describe, it } from "vitest";

import {
  runDerivedReferenceTests,
  runDiagnosticPlacementTests,
  runKpiUpgradeTests,
  runReferenceNotDeclaredByTemplateTests,
  runReferenceNotInPointKeysTests,
  runUnbalancedBraceTests,
  runUnknownReferenceTests,
  runUnusedPointKeysTests,
  runUnvalidatedDialectTests,
  runV2AdmitsDerivedReferenceTests,
  runV2KpiPointKeyExemptionTests,
  runV2KpiUpgradeKeepsItsDialectTests,
  runValidDerivedFormulaTests,
} from "./template-formula-validation.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("template formula validation", () => {
  it("accepts a derived formula over measured siblings", () => {
    runValidDerivedFormulaTests();
  });

  it("positions a diagnostic on an undeclared reference", () => {
    runUnknownReferenceTests();
  });

  it("gives self-reference and sibling-reference distinct messages", () => {
    runDerivedReferenceTests();
  });

  it("rejects a pointKeys entry the expression never uses", () => {
    runUnusedPointKeysTests();
  });

  it("rejects a reference missing from pointKeys", () => {
    runReferenceNotInPointKeysTests();
  });

  it("rejects a reference the template does not declare", () => {
    runReferenceNotDeclaredByTemplateTests();
  });

  it("turns a tokenizer throw into an error state without throwing", () => {
    runUnbalancedBraceTests();
  });

  it("places a diagnostic accurately inside a longer expression", () => {
    runDiagnosticPlacementTests();
  });

  it("leaves an unvalidated KPI unvalidated", () => {
    runUnvalidatedDialectTests();
  });

  it("upgrades a KPI dialect on success and writes nothing on failure", () => {
    runKpiUpgradeTests();
  });

  it("admits under bms-calc-v2 the derived references v1 refuses", () => {
    runV2AdmitsDerivedReferenceTests();
  });

  it("exempts a v2 KPI's cross-asset references from pointKeys, both ways", () => {
    runV2KpiPointKeyExemptionTests();
  });

  it("leaves a v2 KPI at v2 when Validate succeeds", () => {
    runV2KpiUpgradeKeepsItsDialectTests();
  });
});
