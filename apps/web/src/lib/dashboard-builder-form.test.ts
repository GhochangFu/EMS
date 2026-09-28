import { describe, it } from "vitest";

import {
  runBlankDashboardWidgetRowTests,
  runBuildPutWidgetsPayloadTests,
  runBuilderHasChangedTests,
  runDashboardBuilderErrorsTests,
  runDashboardBuilderProblemSubjectTests,
  runDashboardRowsFromDtoTests,
  runRemovingASourceClearsColumnsTests,
  runTableColumnRoundTripTests,
  runUnselectedDashboardBuilderProblemsTests,
  runOfferableOnAGroupTests,
  runNotOfferableWithoutAGroupTests,
  runOtherTypesStayOfferedTests,
  runBlankMimicRowTests,
  runMimicHasNoBindingProblemTests,
  runUnboundTileStillHasBindingProblemTests,
  runMimicPayloadHasNoUnitTests,
  runMimicRowKeepsPresetTests,
  runMimicRoundTripTests,
  runMimicUneditedIsNoChangeTests,
  runMimicOffAGroupHasTheScopeProblemTests,
  runMimicOnAGroupHasNoScopeProblemTests,
  runNonMimicHasNoScopeProblemTests,
  runSummaryKeepsTheSelectedWidgetsScopeProblemTests,
} from "./dashboard-builder-form.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("dashboard builder form", () => {
  it("sizes a new widget row from the catalog's default size", () => {
    runBlankDashboardWidgetRowTests();
  });

  it("reads a stored dashboard's widgets back into editable rows", () => {
    runDashboardRowsFromDtoTests();
  });

  it("preserves a table's column projection across an edit-and-resave", () => {
    runTableColumnRoundTripTests();
  });

  it("clears the column projection when its dataset binding is removed", () => {
    runRemovingASourceClearsColumnsTests();
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

  it("surfaces every problem WidgetInspector's current selection does not render", () => {
    runUnselectedDashboardBuilderProblemsTests();
  });

  it("names a problem's subject — Dashboard, or the widget's own title/catalog label", () => {
    runDashboardBuilderProblemSubjectTests();
  });

  it("F3.32: an asset-group dashboard offers the plant mimic", () => {
    runOfferableOnAGroupTests();
  });

  it("F3.32: an organization, location or asset dashboard does not offer the plant mimic", () => {
    runNotOfferableWithoutAGroupTests();
  });

  it("F3.32: the other five types stay offered on every scope kind", () => {
    runOtherTypesStayOfferedTests();
  });

  it("F3.32b: a new mimic row is 12x10 with the water_train preset", () => {
    runBlankMimicRowTests();
  });

  it("F3.32: a mimic binds nothing and has no binding problem", () => {
    runMimicHasNoBindingProblemTests();
  });

  it("F3.32: an unbound value tile still has the binding problem", () => {
    runUnboundTileStillHasBindingProblemTests();
  });

  it("F3.32: a mimic payload carries no unit or decimals", () => {
    runMimicPayloadHasNoUnitTests();
  });

  it("F3.32: a stored mimic reads back its preset", () => {
    runMimicRowKeepsPresetTests();
  });

  it("F3.32: a stored mimic re-saves its own config", () => {
    runMimicRoundTripTests();
  });

  it("F3.32: an unedited mimic is not a change", () => {
    runMimicUneditedIsNoChangeTests();
  });

  it("F3.32: a mimic off a group scope reports the scope problem, one per mimic", () => {
    runMimicOffAGroupHasTheScopeProblemTests();
  });

  it("F3.32: a mimic on a group scope has no scope problem", () => {
    runMimicOnAGroupHasNoScopeProblemTests();
  });

  it("F3.32: a widget that is not a mimic has no scope problem", () => {
    runNonMimicHasNoScopeProblemTests();
  });

  it("F3.32: the summary keeps the selected widget's scope problem", () => {
    runSummaryKeepsTheSelectedWidgetsScopeProblemTests();
  });
});
