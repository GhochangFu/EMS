import { describe, it } from "vitest";

import {
  runCompletionKeyTests,
  runDecorationDialectTests,
  runDiagnosticRangeTests,
  runEmptyDerivedFormulaTests,
  runEmptyKpiExpressionTests,
  runFlattenNewlinesTests,
  runKpiScopeCompletionTests,
  runReferenceFormsTests,
  runRoutesToTheRightValidatorTests,
  runScopeCompletionTests,
  runUnvalidatedKpiStillSilentTests,
  runV2CompletionKeyTests,
} from "./formula-editor-rules.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("formula editor rules", () => {
  it("reports an empty derived formula instead of hiding a save-time 400", () => {
    runEmptyDerivedFormulaTests();
  });

  it("reports an empty KPI expression at either dialect", () => {
    runEmptyKpiExpressionTests();
  });

  it("still leaves a stored unvalidated KPI alone", () => {
    runUnvalidatedKpiStillSilentTests();
  });

  it("routes each surface to its own validator", () => {
    runRoutesToTheRightValidatorTests();
  });

  it("offers measured siblings only, minus the point being edited", () => {
    runCompletionKeyTests();
  });

  it("offers every sibling except self under bms-calc-v2", () => {
    runV2CompletionKeyTests();
  });

  it("highlights a v2 formula under v2, and never lexes \"unvalidated\"", () => {
    runDecorationDialectTests();
  });

  it("offers every @ scope on a v2 derived formula and none on a v1 one", () => {
    runScopeCompletionTests();
  });

  it("gates @ scopes on the KPI's dialect, not on the surface", () => {
    runKpiScopeCompletionTests();
  });

  it("teaches exactly two v2 reference forms, and each example parses under v2 only", () => {
    runReferenceFormsTests();
  });

  it("clamps diagnostic ranges and widens the invisible ones", () => {
    runDiagnosticRangeTests();
  });

  it("flattens newlines without changing the length", () => {
    runFlattenNewlinesTests();
  });
});
