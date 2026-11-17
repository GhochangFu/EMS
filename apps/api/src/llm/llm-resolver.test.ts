import { describe, it } from "vitest";

import {
  assertACompleteRowBuildsThatProvider,
  assertAnEmptyVisionModelIsNotAMissingVariable,
  assertAnImageTurnBuildsTheRowsVisionModel,
  assertAnImageTurnWithNoVisionModelKeepsTheMainModel,
  assertAnOffRowIsGuidedForAnImageTurnToo,
  assertATextTurnKeepsTheMainModel,
  assertThePlatformSummaryNamesTheVisionModelNeverAKey,
  assertThePlatformVisionModelServesOnlyImageTurns,
  assertAnEmptyLlmProviderIsOff,
  assertAnIncompleteRowNeverUsesThePlatformKey,
  assertAnOffRowIsGuidedMode,
  assertEachProviderNeedsItsKey,
  assertNoRowUsesThePlatformDefault,
  assertOffLogsNoWarning,
  assertOpenRouterNeedsAModelAndTheOthersDefault,
  assertPlatformScopeExcludesAnInactiveOrganization,
  assertPlatformScopeExcludesAnOffRow,
  assertPlatformScopeExcludesAnOwnKeyRow,
  assertPlatformScopeExcludesASwitchedOffOrganization,
  assertPlatformScopeIncludesAnOpenOrganization,
  assertPlatformScopeIsGuidedWithoutThePlatformKey,
  assertTheBootWarningNamesTheVariableAndNoValue,
  assertTheKeyIsNotCached,
  assertFindingsAnOwnRowIgnoresTheFindingsVariables,
  assertFindingsAModelWithoutAProviderIsNoParagraph,
  assertFindingsAModelOver200IsNoParagraph,
  assertFindingsAnInactiveOrganizationIsNoParagraph,
  assertFindingsEmptyUsesThePlatformDefault,
  assertFindingsSetAndCompleteBuildsTheFindingsModel,
  assertFindingsSetWithoutAKeyIsNoParagraph,
  assertFindingsSetWithoutAModelIsNoParagraph,
} from "./llm-resolver.spec";

describe("LLM resolver — the findings paragraph's model (E1.9c, ADR 0135 Amendment 8 decision 4)", () => {
  it("an organization's own row decides; the findings variables never apply to it", async () => {
    await assertFindingsAnOwnRowIgnoresTheFindingsVariables();
  });

  it("no row and the findings variables complete: that provider, model and existing key", async () => {
    await assertFindingsSetAndCompleteBuildsTheFindingsModel();
  });

  it("set without a model: no paragraph and one boot warning naming the variable", async () => {
    await assertFindingsSetWithoutAModelIsNoParagraph();
  });

  it("set without a key: no paragraph and one boot warning naming the key variable", async () => {
    await assertFindingsSetWithoutAKeyIsNoParagraph();
  });

  it("the findings variables empty: the platform default", async () => {
    await assertFindingsEmptyUsesThePlatformDefault();
  });

  it("a findings model without a findings provider: no paragraph and a boot warning naming the provider variable", async () => {
    await assertFindingsAModelWithoutAProviderIsNoParagraph();
  });

  it("a resolved model over 200 characters: no paragraph", async () => {
    await assertFindingsAModelOver200IsNoParagraph();
  });

  it("an inactive organization: no paragraph", async () => {
    await assertFindingsAnInactiveOrganizationIsNoParagraph();
  });
});

/** Vitest entry point — see `admin.schema.test.ts` for the pattern (ADR 0014). One `it()` per claim. */
describe("LLM resolver (F3.21, ADR 0090 Amendment 1 A2/A4)", () => {
  it("treats an empty LLM_PROVIDER as off", async () => {
    await assertAnEmptyLlmProviderIsOff();
  });

  it("needs each provider's own key", async () => {
    await assertEachProviderNeedsItsKey();
  });

  it("needs an OpenRouter model and defaults the other two", async () => {
    await assertOpenRouterNeedsAModelAndTheOthersDefault();
  });

  it("warns once at boot, naming the variable and no value", async () => {
    await assertTheBootWarningNamesTheVariableAndNoValue();
  });

  it("logs nothing when the platform is off", async () => {
    await assertOffLogsNoWarning();
  });

  it("uses the platform default when the organization has no row", async () => {
    await assertNoRowUsesThePlatformDefault();
  });

  it("answers an off row with the guided mode", async () => {
    await assertAnOffRowIsGuidedMode();
  });

  it("builds an organization's provider with its own key", async () => {
    await assertACompleteRowBuildsThatProvider();
  });

  it("never uses the platform key for an organization row", async () => {
    await assertAnIncompleteRowNeverUsesThePlatformKey();
  });

  it("decrypts the key on every turn", async () => {
    await assertTheKeyIsNotCached();
  });
});

describe("LLM resolver — the platform key scope of a cross-organization turn (F3.85, ADR 0099 decision 10)", () => {
  it("allows an organization with no row and its copilot switch on", async () => {
    await assertPlatformScopeIncludesAnOpenOrganization();
  });

  it("excludes an organization whose row is off", async () => {
    await assertPlatformScopeExcludesAnOffRow();
  });

  it("excludes an organization with its own key", async () => {
    await assertPlatformScopeExcludesAnOwnKeyRow();
  });

  it("excludes an organization whose copilot switch is off", async () => {
    await assertPlatformScopeExcludesASwitchedOffOrganization();
  });

  it("excludes an inactive organization", async () => {
    await assertPlatformScopeExcludesAnInactiveOrganization();
  });

  it("is the guided mode when the platform key is off or incomplete", async () => {
    await assertPlatformScopeIsGuidedWithoutThePlatformKey();
  });
});

describe("LLM resolver — the vision model of an image turn (F4.267, ADR 0090 Amendment 3 C2/C3)", () => {
  it("builds the row's vision model on its own key for an image turn", async () => {
    await assertAnImageTurnBuildsTheRowsVisionModel();
  });

  it("keeps the main model for a text turn", async () => {
    await assertATextTurnKeepsTheMainModel();
  });

  it("keeps the main model for an image turn when the row has no vision model", async () => {
    await assertAnImageTurnWithNoVisionModelKeepsTheMainModel();
  });

  it("uses LLM_VISION_MODEL only for a platform image turn, and the main model when it is unset", async () => {
    await assertThePlatformVisionModelServesOnlyImageTurns();
  });

  it("treats an empty LLM_VISION_MODEL as no vision model, not a missing variable", async () => {
    await assertAnEmptyVisionModelIsNotAMissingVariable();
  });

  it("answers an off row with the guided mode on an image turn too", async () => {
    await assertAnOffRowIsGuidedForAnImageTurnToo();
  });

  it("names the platform vision model in the summary, never a key", async () => {
    await assertThePlatformSummaryNamesTheVisionModelNeverAKey();
  });
});
