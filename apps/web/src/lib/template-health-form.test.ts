import { describe, it } from "vitest";

import {
  runAgreesWithTheSchemaTests,
  runChangeDetectionTests,
  runContentHasHealthBandsTests,
  runFormFromStoredTests,
  runMoveTests,
  runOtherVersionsHoldingAssetsTests,
  runPercentRoundTripTests,
  runPercentTextRefusalTests,
  runPresetTests,
  runRemoveTests,
  runSchemaRefusalTests,
  runStoredHealthTests,
  runUndeclaredWeightIsNeverDroppedTests,
  runUntouchedIsCleanTests,
  runWeightOfOneIsNotWrittenTests,
  runWriteKindsTests,
} from "./template-health-form.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.355 PR 2 — the Health tab's form rules (ADR 0038 Amendment 7)", () => {
  it("percent round trip", () => {
    runPercentRoundTripTests();
  });

  it("percent text refusal", () => {
    runPercentTextRefusalTests();
  });

  it("stored health", () => {
    runStoredHealthTests();
  });

  it("content has health bands", () => {
    runContentHasHealthBandsTests();
  });

  it("form from stored", () => {
    runFormFromStoredTests();
  });

  it("undeclared weight is never dropped", () => {
    runUndeclaredWeightIsNeverDroppedTests();
  });

  it("untouched is clean", () => {
    runUntouchedIsCleanTests();
  });

  it("change detection", () => {
    runChangeDetectionTests();
  });

  it("weight of one is not written", () => {
    runWeightOfOneIsNotWrittenTests();
  });

  it("write kinds", () => {
    runWriteKindsTests();
  });

  it("preset", () => {
    runPresetTests();
  });

  it("move", () => {
    runMoveTests();
  });

  it("remove", () => {
    runRemoveTests();
  });

  it("schema refusal", () => {
    runSchemaRefusalTests();
  });

  it("agrees with the schema", () => {
    runAgreesWithTheSchemaTests();
  });

  it("other versions holding assets", () => {
    runOtherVersionsHoldingAssetsTests();
  });
});
