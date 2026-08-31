import { describe, it } from "vitest";

import {
  runBlankConfigRowTests,
  runConfigBuilderTests,
  runFieldBoundConstantsTests,
  runTemplateWidgetTypeDerivationTests,
  runVocabularyDerivationTests,
  runWidgetConfigErrorsTests,
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
});
