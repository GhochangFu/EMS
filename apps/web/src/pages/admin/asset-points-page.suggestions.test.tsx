// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  addListsTheOrganizationsVersion,
  addMarksTheMissingInput,
  takingInTheOverrideWizardFillsTheFormula,
  takingInTheOverrideWizardSetsEvery,
  takingInTheOverrideWizardSetsInputsValidFor,
  takingInTheOverrideWizardSetsRuns,
  takingInTheOverrideWizardSetsTheGrammar,
  takingOnAddFillsTheEditor,
  anAgelessSuggestionOnAddFollowsEvery,
  aSuggestionsOwnAgeEqualToTheDefaultIsKept,
  theOverrideWizardExcludesTheTemplatesOwnVersion,
  theOverrideWizardListsTheOrganizationsVersion,
  theOverrideWizardMarksTheMissingInput,
} from "./asset-points-page.suggestions.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014).
 * `@vitest-environment jsdom` is on this file because Vitest reads it from
 * the file it collects (ADR 0042 decision 2).
 */
describe("F4.314 PR 2 — Suggested formulas on the asset points page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("the override wizard lists the organization's other published version", async () => {
    await theOverrideWizardListsTheOrganizationsVersion();
  });

  it("the override wizard does not offer the template's own version", async () => {
    await theOverrideWizardExcludesTheTemplatesOwnVersion();
  });

  it("the override wizard marks an input the asset does not have", async () => {
    await theOverrideWizardMarksTheMissingInput();
  });

  it("Add calculated point lists the organization's published version", async () => {
    await addListsTheOrganizationsVersion();
  });

  it("Add calculated point marks an input the asset does not have", async () => {
    await addMarksTheMissingInput();
  });

  it("taking a suggestion on Add fills the editor's formula", async () => {
    await takingOnAddFillsTheEditor();
  });

  it("taking a suggestion in the override wizard fills the formula", async () => {
    await takingInTheOverrideWizardFillsTheFormula();
  });

  it("taking a suggestion in the override wizard sets the Grammar", async () => {
    await takingInTheOverrideWizardSetsTheGrammar();
  });

  it("taking a suggestion in the override wizard sets Runs", async () => {
    await takingInTheOverrideWizardSetsRuns();
  });

  it("taking a suggestion in the override wizard sets Every", async () => {
    await takingInTheOverrideWizardSetsEvery();
  });

  it("taking a suggestion in the override wizard sets Inputs valid for", async () => {
    await takingInTheOverrideWizardSetsInputsValidFor();
  });

  it("F4.315: an age-less suggestion taken on Add follows Every", async () => {
    await anAgelessSuggestionOnAddFollowsEvery();
  });

  it("F4.315: a suggestion's own age equal to the default in force is kept", async () => {
    await aSuggestionsOwnAgeEqualToTheDefaultIsKept();
  });
});
