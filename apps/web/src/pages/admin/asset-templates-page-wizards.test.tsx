// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aCreatedTemplateClosesTheWizard,
  aRefusedCreateShowsTheSentence,
  aRefusalAfterCancellingTheImportShowsOnThePage,
  importSubmitIsRefusedUntilAnOrganizationIsChosen,
  theCreateReviewShowsTheSummaryAndSendsNothing,
  theCreateSubmitSendsTheTrimmedForm,
  theCreateWizardSendsNoCopilotHeader,
  theImportReviewNamesTheCodeAndTheOrganization,
  theImportWizardSendsNoCopilotHeader,
} from "./asset-templates-page-wizards.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F4.254 PR 2 asset templates list page — the create and import wizards", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the create Review's summary and sends nothing before Submit", async () => {
    await theCreateReviewShowsTheSummaryAndSendsNothing();
  });

  it("sends the trimmed form on Submit, a blank description as null", async () => {
    await theCreateSubmitSendsTheTrimmedForm();
  });

  it("closes the create wizard once the template is created", async () => {
    await aCreatedTemplateClosesTheWizard();
  });

  it("shows a refused create's sentence, never the raw body", async () => {
    await aRefusedCreateShowsTheSentence();
  });

  it("sends the create with no X-Copilot-Change header", async () => {
    await theCreateWizardSendsNoCopilotHeader();
  });

  it("refuses the import's Submit until an organization is chosen", async () => {
    await importSubmitIsRefusedUntilAnOrganizationIsChosen();
  });

  it("names the stock code and the organization on the import Review", async () => {
    await theImportReviewNamesTheCodeAndTheOrganization();
  });

  it("sends the import with no X-Copilot-Change header", async () => {
    await theImportWizardSendsNoCopilotHeader();
  });

  it("shows an import refused after Cancel on the page banner, once", async () => {
    await aRefusalAfterCancellingTheImportShowsOnThePage();
  });
});
