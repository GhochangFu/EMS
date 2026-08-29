import { describe, it } from "vitest";

import {
  runChangeDetectionTests,
  runChartSeriesMappingTests,
  runCompleteRecordTests,
  runConfigTests,
  runFeaturedRequiredTests,
  runGridTests,
  runMalformedStoredEntryTests,
  runMoveArrayItemTests,
  runOptionalConfigOmittedTests,
  runSeedTests,
  runViewNameTests,
  runWidgetCardinalityTests,
  runWidgetCountCapTests,
} from "./template-dashboard-form.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("template dashboard form", () => {
  it("seeds from the stored record and starts a new view/widget empty", () => {
    runSeedTests();
  });

  it("renders a malformed stored entry instead of throwing on it", () => {
    runMalformedStoredEntryTests();
  });

  it("moves a featured point up or down without running off either end", () => {
    runMoveArrayItemTests();
  });

  it("refuses a view with no featured points, and enforces the cap", () => {
    runFeaturedRequiredTests();
  });

  it("requires, caps and de-duplicates a view name, and refuses a pollution key", () => {
    runViewNameTests();
  });

  it("refuses a widget outside its type's point cardinality", () => {
    runWidgetCardinalityTests();
  });

  it("bounds the grid and the 12-column canvas", () => {
    runGridTests();
  });

  it("caps the number of widgets in one view", () => {
    runWidgetCountCapTests();
  });

  it("validates every type's config surface, including the full optional set", () => {
    runConfigTests();
  });

  it("maps the chart series picker's labels to their exact contract values", () => {
    runChartSeriesMappingTests();
  });

  it("always builds the complete dashboards record, never a subset", () => {
    runCompleteRecordTests();
  });

  it("omits an unset optional config field rather than sending it empty", () => {
    runOptionalConfigOmittedTests();
  });

  it("treats a change as what would be sent", () => {
    runChangeDetectionTests();
  });
});
