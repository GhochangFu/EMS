import { describe, it } from "vitest";

import * as spec from "./asset-templates-adopt-plan.spec";

/** `F4.312` — Vitest entry point. Assertions live in the sibling `.spec` (ADR 0014). */
describe("F4.312 — the adoption planner (ADR 0109 Amendment 1)", () => {
  describe("the asset label (F4.316, ADR 0111)", () => {
    it("carries the RTU and location names on the plan dto", () => spec.thePlanCarriesTheRtuAndLocationNames());
    it("carries null for an RTU-less asset and keeps its location", () =>
      spec.anRtuLessAssetCarriesNullAndItsLocation());
  });

  describe("whole-asset refusals", () => {
    it("refuses an asset already pinned to a template", () => spec.aPinnedAssetIsRefused());
    it("plans no points for a pinned asset", () => spec.aPinnedAssetGetsNoPointPlan());
    it("marks a pinned asset not eligible for the gates", () => spec.aPinnedAssetIsNotEligible());
    it("refuses an asset of another organization (A1)", () =>
      spec.anAssetOfAnotherOrganizationIsRefused());
    it("refuses an asset of another domain (A1)", () => spec.anAssetOfAnotherDomainIsRefused());
    it("words the pinned refusal with the shared sentence (F4.315)", () => spec.thePinnedSentenceIsTheSharedOne());
    it("words the organization refusal with the shared sentence (F4.315)", () =>
      spec.theOrganizationSentenceIsTheSharedOne());
    it("words the domain refusal with the shared sentence (F4.315)", () => spec.theDomainSentenceIsTheSharedOne());
  });

  describe("declared measured points", () => {
    it("refuses a computed row on a measured key (ruling 5)", () =>
      spec.aComputedRowOnAMeasuredKeyIsRefused());
    it("keeps a measured row on a measured key", () => spec.aMeasuredRowOnAMeasuredKeyIsKept());
    it("does not add a kept row again", () => spec.aKeptRowIsNotAdded());
    it("refuses a kept row in another unit (A8)", () => spec.aKeptRowInAnotherUnitIsRefused());
    it("does not refuse a blank row unit (ruling 3)", () => spec.aBlankRowUnitIsNotAMismatch());
    it("compares against the catalog unit when the template sets none", () =>
      spec.theCatalogUnitStandsInForATemplateWithNone());
    it("does not refuse an equal unit", () => spec.anEqualUnitIsNotAMismatch());
    it("adds a missing measured point with the resolved key and unit (A3)", () =>
      spec.aMissingMeasuredPointIsAdded());
    it("resolves an addition from the asset's stored variables", () =>
      spec.anAdditionResolvesFromTheStoredVariables());
    it("refuses an unresolvable required point", () => spec.anUnresolvableRequiredPointIsRefused());
    it("skips an unresolvable optional point", () => spec.anUnresolvableOptionalPointIsSkipped());
    it("refuses a source key over 128 characters", () => spec.anOverLongSourceKeyIsRefused());
    it("refuses a source key an existing row holds", () =>
      spec.aSourceKeyHeldByAnExistingRowIsRefused());
    it("refuses two additions on one source key", () => spec.twoAdditionsOnOneSourceKeyAreRefused());
  });

  describe("declared derived points", () => {
    it("converts a computed row on a derived key (ruling 8)", () =>
      spec.aComputedRowOnADerivedKeyIsConverted());
    it("refuses a converted row in another unit (A8)", () =>
      spec.aConvertedRowInAnotherUnitIsRefused());
    it("refuses a mapping on a derived key", () => spec.aMappingOnADerivedKeyIsRefused());
    it("writes nothing for a derived point the asset lacks", () =>
      spec.aMissingDerivedPointWritesNothing());
  });

  describe("undeclared rows", () => {
    it("refuses an undeclared standalone calculated point (A4)", () =>
      spec.anUndeclaredStandalonePointIsRefused());
    it("keeps an undeclared mapping (A2)", () => spec.anUndeclaredMappingIsKept());
  });

  describe("review fixes", () => {
    it("treats a whitespace row unit as blank (ruling 3)", () => spec.aWhitespaceRowUnitIsBlank());
    it("treats an empty version unit as blank (ruling 3)", () => spec.anEmptyVersionUnitIsBlank());
    it("lists the metadata a kept row inherits", () => spec.aKeptRowListsTheMetadataItInherits());
    it("does not list a field the row sets", () => spec.aFieldTheRowSetsIsNotInherited());
    it("lists the calc columns a converted row inherits", () =>
      spec.aConvertedRowListsTheCalcColumnsItInherits());
    it("gives the adopt remedy for an unresolvable source key", () =>
      spec.anUnresolvableRefusalGivesTheAdoptRemedy());
  });

  describe("refusal shape", () => {
    it("carries the asset id, code and point key as fields", () =>
      spec.aRefusalCarriesTheAssetFields());
    it("names the asset code and the point key in every point refusal", () =>
      spec.everyPointRefusalNamesTheAssetCodeAndThePointKey());
  });
});
