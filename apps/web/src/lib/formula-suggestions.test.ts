import { describe, it } from "vitest";

import {
  runAnotherKeyIsNotListedTests,
  runDialectDistinguishesTests,
  runDraftCarriesDialectTests,
  runDraftCarriesFormulaTests,
  runDraftCarriesInputAgeTests,
  runDraftCarriesIntervalTests,
  runDraftCarriesTriggerTests,
  runDraftCrossAssetIsScheduledTests,
  runDuplicatesCollapseTests,
  runExcludedTemplateIsDroppedTests,
  runExcludedTemplatePointDropsItsVersionTests,
  runIdsNeedAnOrganizationTests,
  runIdsReadTheMatchingVersionTests,
  runIdsSkipAnotherDomainTests,
  runIdsSkipAnotherOrganizationTests,
  runIdsSkipTheExcludedTests,
  runIdsSkipUnpublishedTests,
  runMeasuredIsNotListedTests,
  runMissingInputIsNamedTests,
  runNullDialectIsV1Tests,
  runNullKeysMarkNothingTests,
  runRowCarriesDialectTests,
  runOverrideDraftKeepsInheritTests,
  runRowCarriesFormulaTests,
  runRowCarriesInputAgeTests,
  runRowCarriesIntervalTests,
  runRowCarriesTriggerTests,
  runRowCrossAssetIsScheduledTests,
  runRowToV1ClearsTheRatioTests,
  runRunnableFirstTests,
  runStandaloneDraftDefaultsToScheduledTests,
  runUnpublishedVersionIsNotListedTests,
} from "./formula-suggestions.spec";

/** Vitest entry point — see `apps/web/src/lib/admin-access.test.ts` (ADR 0014). */
describe("suggested formulas (F4.314 PR 2)", () => {
  it("names a formula input the asset does not have", () => {
    runMissingInputIsNamedTests();
  });

  it("does not offer a derived point of another key", () => {
    runAnotherKeyIsNotListedTests();
  });

  it("does not offer a measured point of the key", () => {
    runMeasuredIsNotListedTests();
  });

  it("collapses the same formula and dialect into one, labelled by the first source", () => {
    runDuplicatesCollapseTests();
  });

  it("keeps the same text under two dialects as two suggestions", () => {
    runDialectDistinguishesTests();
  });

  it("drops the Calculations tab's own version", () => {
    runExcludedTemplateIsDroppedTests();
  });

  it("drops the version that declares the override's template point", () => {
    runExcludedTemplatePointDropsItsVersionTests();
  });

  it("never offers a draft version's formula", () => {
    runUnpublishedVersionIsNotListedTests();
  });

  it("marks nothing missing with no single asset (null keys)", () => {
    runNullKeysMarkNothingTests();
  });

  it("lists what the asset can run first", () => {
    runRunnableFirstTests();
  });

  it("reads a point with no dialect as bms-calc-v1", () => {
    runNullDialectIsV1Tests();
  });

  it("reads no draft list row", () => {
    runIdsSkipUnpublishedTests();
  });

  it("reads no other organization's list row", () => {
    runIdsSkipAnotherOrganizationTests();
  });

  it("reads no other domain's list row", () => {
    runIdsSkipAnotherDomainTests();
  });

  it("reads not the excluded version", () => {
    runIdsSkipTheExcludedTests();
  });

  it("reads nothing without an organization", () => {
    runIdsNeedAnOrganizationTests();
  });

  it("reads the organization's published version of the domain", () => {
    runIdsReadTheMatchingVersionTests();
  });

  it("taking a suggestion fills the draft's formula", () => {
    runDraftCarriesFormulaTests();
  });

  it("taking a suggestion fills the draft's dialect", () => {
    runDraftCarriesDialectTests();
  });

  it("taking a suggestion fills the draft's trigger", () => {
    runDraftCarriesTriggerTests();
  });

  it("taking a suggestion fills the draft's interval", () => {
    runDraftCarriesIntervalTests();
  });

  it("taking a suggestion fills the draft's max input age", () => {
    runDraftCarriesInputAgeTests();
  });

  it("a cross-asset suggestion lands scheduled on the draft", () => {
    runDraftCrossAssetIsScheduledTests();
  });

  it("a standalone draft takes a source with no trigger as scheduled", () => {
    runStandaloneDraftDefaultsToScheduledTests();
  });

  it("an override draft takes a source with no trigger as inherit", () => {
    runOverrideDraftKeepsInheritTests();
  });

  it("taking a suggestion fills the row's formula", () => {
    runRowCarriesFormulaTests();
  });

  it("taking a suggestion sets the row's dialect through setFormulaDialect", () => {
    runRowCarriesDialectTests();
  });

  it("taking a suggestion fills the row's trigger", () => {
    runRowCarriesTriggerTests();
  });

  it("taking a suggestion fills the row's interval", () => {
    runRowCarriesIntervalTests();
  });

  it("taking a suggestion fills the row's max input age", () => {
    runRowCarriesInputAgeTests();
  });

  it("a cross-asset suggestion lands scheduled on a row already on that dialect", () => {
    runRowCrossAssetIsScheduledTests();
  });

  it("a v1 suggestion on a v2 row clears the coverage ratio", () => {
    runRowToV1ClearsTheRatioTests();
  });
});
