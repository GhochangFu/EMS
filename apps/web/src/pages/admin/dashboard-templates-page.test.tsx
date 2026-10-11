// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aFailedStockFetchDoesNotCountZeroDefaults,
  anotherEntryKeepsItsNameWhileOneImports,
  createWizardAloneSendsNoCopilotHeader,
  createWizardSendsNothingBeforeSubmit,
  createWizardSendsTheTrimmedBody,
  createWizardStepsAreBasicsContentReview,
  importCallsTheApiWithTheChosenOrganization,
  importOpensAWizardBeforeTheRequest,
  importWizardAloneSendsNoCopilotHeader,
  aValueChangeClearsTheCreateRefusal,
  reviewNamesTheClearedCodeAfterARefusal,
  aValueChangeClearsTheImportRefusal,
  reviewNamesTheClearedOrganizationAfterARefusal,
  createContentStepDescribesAFilledContent,
  createBasicsShowsAFilledTarget,
  createSummaryNamesAnUnlistedOrganizationById,
  importingAnnouncesImportingThisEntry,
  importingRemovesThatEntrysIdleName,
  rendersTemplatesAndStockCatalog,
  sectionFilterComesFromTheVocabularyFetch,
  siteTemplateRowShowsASiteBadge,
  stockRowLinksToTheViewer,
} from "./dashboard-templates-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F3.36 dashboard templates list page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders the template list and the stock catalog with an Import action each", async () => {
    await rendersTemplatesAndStockCatalog();
  });

  it("a site template's row shows a Site badge (F3.73)", async () => {
    await siteTemplateRowShowsASiteBadge();
  });

  it("builds the section filter from the vocabulary fetch, never a hardcoded list", async () => {
    await sectionFilterComesFromTheVocabularyFetch();
  });

  it("imports a stock entry into the chosen organization", async () => {
    await importCallsTheApiWithTheChosenOrganization();
  });

  it("links the stock row to the read-only viewer", async () => {
    await stockRowLinksToTheViewer();
  });

  it("does not count zero defaults when the stock fetch fails", async () => {
    await aFailedStockFetchDoesNotCountZeroDefaults();
  });

  it("B5 importing announces Importing {name}… as the aria-label, with aria-busy", async () => {
    await importingAnnouncesImportingThisEntry();
  });

  it("B5 importing removes that entry's idle Import {name} name", async () => {
    await importingRemovesThatEntrysIdleName();
  });

  it("B5 another stock entry keeps Import {name} and is not busy while one imports", async () => {
    await anotherEntryKeepsItsNameWhileOneImports();
  });
});

describe("F3.85 PR 10a dashboard template wizards on the list page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("the create wizard's steps are Basics, Content, then Review", async () => {
    await createWizardStepsAreBasicsContentReview();
  });

  it("the create wizard's Submit sends the trimmed body with a null blank description", async () => {
    await createWizardSendsTheTrimmedBody();
  });

  it("the create wizard sends nothing before Review's Submit", async () => {
    await createWizardSendsNothingBeforeSubmit();
  });

  it("the create wizard alone sends the request with no X-Copilot-Change header", async () => {
    await createWizardAloneSendsNoCopilotHeader();
  });

  it("Import opens the importStock wizard (Organization, Review) before any request", async () => {
    await importOpensAWizardBeforeTheRequest();
  });

  it("the import wizard alone sends {organizationId} with no X-Copilot-Change header", async () => {
    await importWizardAloneSendsNoCopilotHeader();
  });

  it("a value change after a refused create clears the old error from Review", async () => {
    await aValueChangeClearsTheCreateRefusal();
  });

  it("Review after a refused create names the cleared Code", async () => {
    await reviewNamesTheClearedCodeAfterARefusal();
  });

  it("a value change after a refused import clears the old error from Review", async () => {
    await aValueChangeClearsTheImportRefusal();
  });

  it("Review after a refused import names the cleared organization", async () => {
    await reviewNamesTheClearedOrganizationAfterARefusal();
  });

  it("the create Content step describes a content the copilot filled", async () => {
    await createContentStepDescribesAFilledContent();
  });

  it("the create Basics step shows a target the copilot filled", async () => {
    await createBasicsShowsAFilledTarget();
  });

  it("the create Review names an organization missing from the list by its id", async () => {
    await createSummaryNamesAnUnlistedOrganizationById();
  });
});
