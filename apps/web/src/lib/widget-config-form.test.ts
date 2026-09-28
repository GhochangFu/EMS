import { describe, it } from "vitest";

import {
  runBlankConfigRowTests,
  runConfigBuilderTests,
  runFieldBoundConstantsTests,
  runTemplateWidgetTypeDerivationTests,
  runVocabularyDerivationTests,
  runWidgetConfigErrorsTests,
  runBlankConfigRowHoldsNoPresetTests,
  runMimicConfigBuilderTests,
  runMimicConfigValuesTests,
  runMimicPresetRequiredTests,
  runMimicWithPresetIsCleanTests,
} from "./widget-config-form.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("widget config form", () => {
  it("derives every vocabulary constant from @bms/shared and the widget catalog", () => {
    runVocabularyDerivationTests();
  });

  it("keeps TEMPLATE_WIDGET_TYPES and TemplateAuthorableWidgetType saying one thing", () => {
    runTemplateWidgetTypeDerivationTests();
  });

  it("pins the field bound constants this file exports", () => {
    runFieldBoundConstantsTests();
  });

  it("starts a blank config row with a valid gauge range and safe defaults", () => {
    runBlankConfigRowTests();
  });

  it("validates every type's config surface, called directly on {widgetType, config}", () => {
    runWidgetConfigErrorsTests();
  });

  it("builds each type's config, omitting unset optional fields", () => {
    runConfigBuilderTests();
  });

  it("F3.32: a blank config row holds no preset", () => {
    runBlankConfigRowHoldsNoPresetTests();
  });

  it("F3.32: a mimic with no preset reports a preset problem", () => {
    runMimicPresetRequiredTests();
  });

  it("F3.32: a mimic with a preset has no config problem", () => {
    runMimicWithPresetIsCleanTests();
  });

  it("F3.32: a mimic config never carries unit or decimals", () => {
    runMimicConfigBuilderTests();
  });

  it("F3.32: a mimic config writes source preset and the chosen preset", () => {
    runMimicConfigValuesTests();
  });
});
