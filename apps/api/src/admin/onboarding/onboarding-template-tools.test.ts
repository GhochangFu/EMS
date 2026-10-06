import { describe, it } from "vitest";

import {
  assertT14AddTemplateAssetsRefusesAKeyOverTheLengthLimit,
  assertT19TheCountsSkipAKeyOverTheLengthLimit,
  assertABigTemplateResultIsCut,
  assertGetTemplateByCodeReturnsPointsAndVariables,
  assertGetTemplateByStockCodeReturnsTheStockEntry,
  assertGetTemplateUnknownCodeFailsNamingIt,
  assertListStockTemplatesFiltersCodeAndName,
  assertListTemplatesIsBoundedAtOneHundred,
  assertListTemplatesIsPublishedOnlyWithHighestVersion,
  assertToolsAre29,
  assertT1AddTemplateAppendsAnAuthoredEntry,
  assertT2AddTemplateRefusesACodeTheDraftHolds,
  assertT3AddTemplateRefusesACodeTheOrganizationHoldsNamingTheVersions,
  assertT4AddTemplateRefusesAnUnknownPointKey,
  assertT4AddTemplateAcceptsADraftAndACatalogPointKey,
  assertT5AddTemplateRefusesABadPatternGrammar,
  assertT6AddTemplateRefusesACredentialLookingLabel,
  assertT6AddTemplateRefusesACredentialLookingPattern,
  assertT6ImportStockTemplateRefusesACredentialLookingPattern,
  assertT7ImportStockTemplateAppendsAStockEntry,
  assertT8ImportStockTemplateRefusesAnUnknownCodeNamingTheAvailableOnes,
  assertT8ImportStockTemplateRefusesACodeTheOrganizationHolds,
  assertT9ImportStockTemplateRefusesAPatternKeyThatIsNoMeasuredPoint,
  assertT9ImportStockTemplateRefusesABadPatternGrammar,
  assertT10RemoveTemplateIsRefusedWhileAnAssetReferencesIt,
  assertT10RemoveTemplateRemovesAnUnreferencedTemplate,
  assertT10RemoveTemplateRefusesAnUnknownCode,
  assertRemovePointKeyIsRefusedWhileADraftTemplateUsesIt,
  assertRemovePointKeyRemovesAKeyTheCatalogHolds,
  assertRemovePointKeyRemovesAKeyNoTemplateUses,
  assertRemovePointKeyRemovesOneCopyOfADuplicateKey,
  assertF4213RemovePointKeyIsRefusedWhileAStockEntryNeedsIt,
  assertF4213RemovePointKeyRemovesAKeyAStockEntryResolvesFromTheCatalog,
  assertF4213AddTemplateNamesEachUnresolvedKeyInTheValidatorsSentence,
  assertF4213ImportStockTemplateRefusesAnInactiveKey,
  assertF4213ImportStockTemplateRefusesAFormulaKeyThatDoesNotResolve,
  assertF4213ImportStockTemplateAcceptsADraftDeclaredKey,
  assertRemovePointKeyRemovesAKeyThatAlreadyDoesNotResolve,
  assertT4AddTemplateRefusesAnInactiveCatalogKey,
  assertT11AddTemplateAssetsAppendsTemplatedAssets,
  assertT12AddTemplateAssetsPinsTheHighestPublishedVersion,
  assertT12AddTemplateAssetsPinsTheNamedVersion,
  assertT13AddTemplateAssetsRefusesAMissingRtu,
  assertT14AddTemplateAssetsRefusesAnUnresolvedVariable,
  assertT14AddTemplateAssetsRefusesARequiredPointWithNoPattern,
  assertT15AddTemplateAssetsRefusesAVariableTheTemplateDoesNotAskFor,
  assertT16AddTemplateAssetsRefusesACredentialLookingValue,
  assertT17ABatchOver200IsASchemaRefusal,
  assertT18RemoveAssetRemovesATemplatedAsset,
  assertT19ProposeCommitNamesThePublishAndTheCounts,
  assertT19TheCountsReadTheTemplatePerAsset,
  assertT20TheSummaryAtTheCapsIsBounded,
  assertT22AStockScenarioFinishesUnderTheCallCap,
  assertT23TheSystemPromptNamesTheTemplateTools,
} from "./onboarding-template-tools.spec";

/** Vitest entry point (ADR 0014). One `it()` per claim. */
describe("onboarding template read tools (F3.22, ADR 0091 decision 3)", () => {
  it("T21 registers 29 tools", async () => {
    await assertToolsAre29();
  });
  it("R1 lists published templates only, at the highest version", async () => {
    await assertListTemplatesIsPublishedOnlyWithHighestVersion();
  });
  it("R2 bounds list_templates at 100 and counts the rest", async () => {
    await assertListTemplatesIsBoundedAtOneHundred();
  });
  it("R3 get_template by code returns points and variables", async () => {
    await assertGetTemplateByCodeReturnsPointsAndVariables();
  });
  it("R4 get_template by stockCode returns the stock entry", async () => {
    await assertGetTemplateByStockCodeReturnsTheStockEntry();
  });
  it("R5 get_template for an unknown code fails naming it", async () => {
    await assertGetTemplateUnknownCodeFailsNamingIt();
  });
  it("R6 list_stock_templates filters code and name", async () => {
    await assertListStockTemplatesFiltersCodeAndName();
  });
  it("R7 cuts a 300-point result", async () => {
    await assertABigTemplateResultIsCut();
  });
});

describe("onboarding template write tools and the proposal (F3.22, ADR 0091 decisions 3, 6–9)", () => {
  it("T1 add template appends an authored entry", async () => {
    await assertT1AddTemplateAppendsAnAuthoredEntry();
  });
  it("T2 add template refuses a code the draft holds", async () => {
    await assertT2AddTemplateRefusesACodeTheDraftHolds();
  });
  it("T3 add template refuses a code the organization holds naming the versions", async () => {
    await assertT3AddTemplateRefusesACodeTheOrganizationHoldsNamingTheVersions();
  });
  it("T4 add template refuses an unknown point key", async () => {
    await assertT4AddTemplateRefusesAnUnknownPointKey();
  });
  it("T4 add template accepts a draft and a catalog point key", async () => {
    await assertT4AddTemplateAcceptsADraftAndACatalogPointKey();
  });
  it("T5 add template refuses a bad pattern grammar", async () => {
    await assertT5AddTemplateRefusesABadPatternGrammar();
  });
  it("T6 add template refuses a credential looking label", async () => {
    await assertT6AddTemplateRefusesACredentialLookingLabel();
  });
  it("T6 add template refuses a credential looking pattern", async () => {
    await assertT6AddTemplateRefusesACredentialLookingPattern();
  });
  it("T6 import stock template refuses a credential looking pattern", async () => {
    await assertT6ImportStockTemplateRefusesACredentialLookingPattern();
  });
  it("T7 import stock template appends a stock entry", async () => {
    await assertT7ImportStockTemplateAppendsAStockEntry();
  });
  it("T8 import stock template refuses an unknown code naming the available ones", async () => {
    await assertT8ImportStockTemplateRefusesAnUnknownCodeNamingTheAvailableOnes();
  });
  it("T8 import stock template refuses a code the organization holds", async () => {
    await assertT8ImportStockTemplateRefusesACodeTheOrganizationHolds();
  });
  it("T9 import stock template refuses a pattern key that is no measured point", async () => {
    await assertT9ImportStockTemplateRefusesAPatternKeyThatIsNoMeasuredPoint();
  });
  it("T9 import stock template refuses a bad pattern grammar", async () => {
    await assertT9ImportStockTemplateRefusesABadPatternGrammar();
  });
  it("T10 remove template is refused while an asset references it", async () => {
    await assertT10RemoveTemplateIsRefusedWhileAnAssetReferencesIt();
  });
  it("T10 remove template removes an unreferenced template", async () => {
    await assertT10RemoveTemplateRemovesAnUnreferencedTemplate();
  });
  it("T10 remove template refuses an unknown code", async () => {
    await assertT10RemoveTemplateRefusesAnUnknownCode();
  });
  it("F4.195 remove point key is refused while a draft template uses it", async () => {
    await assertRemovePointKeyIsRefusedWhileADraftTemplateUsesIt();
  });
  it("F4.195 remove point key removes a key the catalog holds", async () => {
    await assertRemovePointKeyRemovesAKeyTheCatalogHolds();
  });
  it("F4.195 remove point key removes a key no template uses", async () => {
    await assertRemovePointKeyRemovesAKeyNoTemplateUses();
  });
  it("F4.195 remove point key removes one copy of a duplicate key", async () => {
    await assertRemovePointKeyRemovesOneCopyOfADuplicateKey();
  });
  it("F4.213 remove point key is refused while a stock entry needs it", async () => {
    await assertF4213RemovePointKeyIsRefusedWhileAStockEntryNeedsIt();
  });
  it("F4.213 remove point key removes a key a stock entry resolves from the catalog", async () => {
    await assertF4213RemovePointKeyRemovesAKeyAStockEntryResolvesFromTheCatalog();
  });
  it("F4.213 add template names each unresolved key in the validator's sentence", async () => {
    await assertF4213AddTemplateNamesEachUnresolvedKeyInTheValidatorsSentence();
  });
  it("F4.213 import stock template refuses an inactive point key", async () => {
    await assertF4213ImportStockTemplateRefusesAnInactiveKey();
  });
  it("F4.213 import stock template refuses a formula key that does not resolve", async () => {
    await assertF4213ImportStockTemplateRefusesAFormulaKeyThatDoesNotResolve();
  });
  it("F4.213 import stock template accepts a draft declared key", async () => {
    await assertF4213ImportStockTemplateAcceptsADraftDeclaredKey();
  });
  it("F4.196 remove point key removes a key that already does not resolve", async () => {
    await assertRemovePointKeyRemovesAKeyThatAlreadyDoesNotResolve();
  });
  it("F4.196 add template refuses a key the catalog holds inactive", async () => {
    await assertT4AddTemplateRefusesAnInactiveCatalogKey();
  });
  it("T11 add template assets appends templated assets", async () => {
    await assertT11AddTemplateAssetsAppendsTemplatedAssets();
  });
  it("T12 add template assets pins the highest published version", async () => {
    await assertT12AddTemplateAssetsPinsTheHighestPublishedVersion();
  });
  it("T12 add template assets pins the named version", async () => {
    await assertT12AddTemplateAssetsPinsTheNamedVersion();
  });
  it("T13 add template assets refuses a missing rtu", async () => {
    await assertT13AddTemplateAssetsRefusesAMissingRtu();
  });
  it("T14 add template assets refuses an unresolved variable", async () => {
    await assertT14AddTemplateAssetsRefusesAnUnresolvedVariable();
  });
  it("T14 add template assets refuses a required point with no pattern", async () => {
    await assertT14AddTemplateAssetsRefusesARequiredPointWithNoPattern();
  });
  it("T15 add template assets refuses a variable the template does not ask for", async () => {
    await assertT15AddTemplateAssetsRefusesAVariableTheTemplateDoesNotAskFor();
  });
  it("T16 add template assets refuses a credential looking value", async () => {
    await assertT16AddTemplateAssetsRefusesACredentialLookingValue();
  });
  it("T17 a batch over 200 is a schema refusal", async () => {
    await assertT17ABatchOver200IsASchemaRefusal();
  });
  it("T18 remove asset removes a templated asset", async () => {
    await assertT18RemoveAssetRemovesATemplatedAsset();
  });
  it("T19 propose commit names the publish and the counts", async () => {
    await assertT19ProposeCommitNamesThePublishAndTheCounts();
  });
  it("T19 the counts read the template per asset", () => {
    assertT19TheCountsReadTheTemplatePerAsset();
  });
  it("T19 the counts skip a key over the length limit", () => {
    assertT19TheCountsSkipAKeyOverTheLengthLimit();
  });
  it("T14 add template assets refuses a key over the length limit", async () => {
    await assertT14AddTemplateAssetsRefusesAKeyOverTheLengthLimit();
  });
  it("T20 the summary at the caps is bounded", () => {
    assertT20TheSummaryAtTheCapsIsBounded();
  });
  it("T22 a stock scenario finishes under the call cap", async () => {
    await assertT22AStockScenarioFinishesUnderTheCallCap();
  });
  it("T23 the system prompt names the template tools", () => {
    assertT23TheSystemPromptNamesTheTemplateTools();
  });
});
