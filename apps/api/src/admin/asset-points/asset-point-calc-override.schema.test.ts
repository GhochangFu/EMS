import { describe, it } from "vitest";

import {
  assertAV2TemplateIsOverridableWithoutRestatingTheDialect,
  assertAnEmptyTemplateNeedsAFullOverride,
  assertAnUnknownStoredDialectIsRefused,
  assertAnUnrelatedSingleColumnOverrideIsAccepted,
  assertBoundsAreEnforcedByTheSchema,
  assertFormulaAloneInheritsTheDialect,
  assertFormulaIsValidatedAgainstDeclaredKeys,
  assertOverridingBothColumnsTogetherIsAccepted,
  assertScheduledWithoutIntervalIsRejected,
  assertTriggerOnlyOverrideIsRejectedNamingTheInheritedInterval,
  assertV1OverrideStillRefusesADerivedSibling,
  assertV2InheritedDialectIsNamedWhenOnlyTheTriggerIsOverridden,
  assertV2OverrideAdmitsADerivedSiblingAndAnAggregate,
  assertV2StreamingIsRefusedOnTheMergedPair,
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

  it("guard 3's v1 half — a bms-calc-v1 override still refuses a derived reference", () => {
    assertV1OverrideStillRefusesADerivedSibling();
  });

  it("ADR 0055 decision 7 — a bms-calc-v2 override admits a derived sibling and an aggregate", () => {
    assertV2OverrideAdmitsADerivedSiblingAndAnAggregate();
  });

  it("ADR 0055 decision 10 — a merged bms-calc-v2 point may not be streaming", () => {
    assertV2StreamingIsRefusedOnTheMergedPair();
  });

  it("names the inherited dialect when only the trigger is overridden", () => {
    assertV2InheritedDialectIsNamedWhenOnlyTheTriggerIsOverridden();
  });

  it("accepts an unrelated override on a bms-calc-v2 template point", () => {
    assertAV2TemplateIsOverridableWithoutRestatingTheDialect();
  });

  it("refuses a stored dialect outside CALC_DIALECTS, naming every runnable one", () => {
    assertAnUnknownStoredDialectIsRefused();
  });
});
