import { describe, it } from "vitest";

import {
  runGroupTabOffALocationScopeIsRefusedTests,
  runReservedTabKeyIsRefusedTests,
  runMalformedTabKeyIsRefusedTests,
  runDuplicateTabKeyIsRefusedTests,
  runBlankTabLabelIsRefusedTests,
  runTooManyTabsIsRefusedTests,
  runCardTargetingAMissingTabIsRefusedTests,
  runWidgetOnAMissingTabIsRefusedTests,
  runAddingTheFirstTabAdoptsEveryWidgetTests,
  runAddingATabAfterAGapSavesItLastTests,
  runMovingASiteWithSavedGroupTabsIsRefusedTests,
  runRenamingATabKeyCarriesItsWidgetsTests,
  runMovingATabRenumbersTests,
  runRemovingATabRemovesItsWidgetsTests,
  runMimicOfferedOnAGroupTabTests,
} from "./dashboard-builder-tabs.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). */
describe("F3.73 D11 dashboard builder tabs", () => {
  it("a tab keyed assets is refused with the reason", () => {
    runReservedTabKeyIsRefusedTests();
  });

  it("a malformed tab key is refused", () => {
    runMalformedTabKeyIsRefusedTests();
  });

  it("two tabs may not share one key", () => {
    runDuplicateTabKeyIsRefusedTests();
  });

  it("a tab with a blank label is refused", () => {
    runBlankTabLabelIsRefusedTests();
  });

  it("more than the tab cap is refused", () => {
    runTooManyTabsIsRefusedTests();
  });

  it("a card targeting a missing tab is refused", () => {
    runCardTargetingAMissingTabIsRefusedTests();
  });

  it("a widget on a missing tab is refused", () => {
    runWidgetOnAMissingTabIsRefusedTests();
  });

  it("the first tab adopts every widget", () => {
    runAddingTheFirstTabAdoptsEveryWidgetTests();
  });

  it("a tab added after a sortOrder gap saves last", () => {
    runAddingATabAfterAGapSavesItLastTests();
  });

  it("a move off the site is refused while saved tabs bind a group", () => {
    runMovingASiteWithSavedGroupTabsIsRefusedTests();
  });

  it("re-keying a tab carries its widgets and cards; a taken key is refused", () => {
    runRenamingATabKeyCarriesItsWidgetsTests();
  });

  it("moving a tab renumbers the order", () => {
    runMovingATabRenumbersTests();
  });

  it("removing a tab removes its widgets", () => {
    runRemovingATabRemovesItsWidgetsTests();
  });

  it("the plant mimic is offered on a group-bound tab", () => {
    runMimicOfferedOnAGroupTabTests();
  });

  it("a group tab off a location scope is refused", () => {
    runGroupTabOffALocationScopeIsRefusedTests();
  });
});
