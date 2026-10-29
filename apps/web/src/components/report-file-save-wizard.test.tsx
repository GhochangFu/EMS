// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import { resetWizardStore } from "../stores/wizard-store";
import {
  aCancelDropsTheFilledLocationIds,
  aFilledLocationIdsReachesTheSave,
  aLocationAdminSavesWithoutAnOrganizationSelect,
  anAdminMustChooseAnOrganizationBeforeSaving,
  anAdminSaveSendsTheChosenOrganization,
  aRefusedSaveRendersTheApiSentence,
  aSaveDropsTheFilledLocationIds,
  aSavedFileRendersTheSavedLine,
  submitPostsTheRangeAndTheFormatByKey,
  theReviewSaysTheFileRendersOnConfirm,
} from "./report-file-save-wizard.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014); the jsdom docblock is here (ADR 0042). */
describe("F4.280 — the Save-to-history wizard (ADR 0099 decision 6, Q8)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    resetWizardStore();
  });

  it("an admin must choose an organization before a save is sent", () => anAdminMustChooseAnOrganizationBeforeSaving());
  it("an admin save sends the chosen organization and format", () => anAdminSaveSendsTheChosenOrganization());
  it("a location_admin has no organization select", () => aLocationAdminSavesWithoutAnOrganizationSelect());
  it("Submit posts the range and the format by key", () => submitPostsTheRangeAndTheFormatByKey());
  it("a saved file renders the saved line", () => aSavedFileRendersTheSavedLine());
  it("a refused save renders the API's sentence", () => aRefusedSaveRendersTheApiSentence());
  it("the Review says the file renders on confirm", () => theReviewSaysTheFileRendersOnConfirm());
  it("F4.290: a filled locationIds reaches the save", () => aFilledLocationIdsReachesTheSave());
  it("F4.290: a Cancel drops the filled locationIds", () => aCancelDropsTheFilledLocationIds());
  it("F4.290: a save drops the filled locationIds", () => aSaveDropsTheFilledLocationIds());
});
