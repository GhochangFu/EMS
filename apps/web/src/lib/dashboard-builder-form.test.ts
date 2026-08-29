import { describe, it } from "vitest";

import {
  runBlankDashboardWidgetRowTests,
  runBuildPutWidgetsPayloadTests,
  runBuilderHasChangedTests,
  runDashboardBuilderErrorsTests,
  runDashboardRowsFromDtoTests,
} from "./dashboard-builder-form.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("dashboard builder form", () => {
  it("sizes a new widget row from the catalog's default size", () => {
    runBlankDashboardWidgetRowTests();
  });

  it("reads a stored dashboard's widgets back into editable rows", () => {
    runDashboardRowsFromDtoTests();
  });

  it("validates cardinality and grid fit from the shared catalog and constant", () => {
    runDashboardBuilderErrorsTests();
  });

  it("builds the PUT :id/widgets body, dropping the display-only label", () => {
    runBuildPutWidgetsPayloadTests();
  });

  it("tracks unsaved changes against the dashboard's own stored widgets", () => {
    runBuilderHasChangedTests();
  });
});
