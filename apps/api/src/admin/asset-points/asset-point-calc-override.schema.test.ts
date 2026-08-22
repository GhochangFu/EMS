import { describe, it } from "vitest";

import {
  assertAnEmptyTemplateNeedsAFullOverride,
  assertAnUnrelatedSingleColumnOverrideIsAccepted,
  assertBoundsAreEnforcedByTheSchema,
  assertFormulaAloneInheritsTheDialect,
  assertFormulaIsValidatedAgainstDeclaredKeys,
  assertOverridingBothColumnsTogetherIsAccepted,
  assertScheduledWithoutIntervalIsRejected,
  assertTriggerOnlyOverrideIsRejectedNamingTheInheritedInterval,
} from "./asset-point-calc-override.schema.spec";

/** `F2.6` U7 — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F2.6 — asset point calc override contract", () => {
  it("enforces the shared bounds, and rejects an omitted field", () => {
    assertBoundsAreEnforcedByTheSchema();
  });

  it("D-1 — rejects a trigger-only override, naming the inherited interval", () => {
    assertTriggerOnlyOverrideIsRejectedNamingTheInheritedInterval();
  });

  it("D-1 mirror — rejects scheduled with no interval", () => {
    assertScheduledWithoutIntervalIsRejected();
  });

  it("accepts trigger and interval overridden together", () => {
    assertOverridingBothColumnsTogetherIsAccepted();
  });

  it("accepts a single-column override that does not break the merge", () => {
    assertAnUnrelatedSingleColumnOverrideIsAccepted();
  });

  it("validates the formula against the point keys the pinned version declares", () => {
    assertFormulaIsValidatedAgainstDeclaredKeys();
  });

  it("lets a formula override inherit the dialect", () => {
    assertFormulaAloneInheritsTheDialect();
  });

  it("requires a full override when the template sets nothing", () => {
    assertAnEmptyTemplateNeedsAFullOverride();
  });
});
