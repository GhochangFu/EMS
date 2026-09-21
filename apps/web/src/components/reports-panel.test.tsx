// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aCostRendersInTheReportsPanel,
  aFailedPdfExportRendersItsOwnLine,
  aLocationAdminSavesWithoutAnOrganizationSelect,
  aMeasuredRatioRendersInTheReportsPanel,
  aNullCostRendersTheDashInTheReportsPanel,
  aRefusedSaveRendersTheApiSentence,
  aViewerSeesNoSchedulesHeading,
  aViewerSeesThePdfButtonAndNoSaveOrHistory,
  anAdminMustChooseAnOrganizationBeforeSaving,
  anAdminSaveSendsTheFormatAndTheOrganizationInOrder,
  anAdminSeesTheSchedulesHeading,
  anUnconfiguredPreviewShowsTheDashAndTheReason,
  exportPdfCallsTheApiWithTheRange,
  saveCallsTheApiByPositionAndRendersTheSavedLine,
  theDeferredPillIsGoneAndTheCardNamesThreeFormats,
} from "./reports-panel.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F2.8 reports panel PUE tile", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders a measured ratio to two decimals", async () => {
    await aMeasuredRatioRendersInTheReportsPanel();
  });

  it("renders a dash and the not-configured reason when the API returns null", async () => {
    await anUnconfiguredPreviewShowsTheDashAndTheReason();
  });

  it("E4.1c — renders the cost in the organization's currency", async () => {
    await aCostRendersInTheReportsPanel();
  });

  it("E4.1c — renders the dash, without throwing, when the cost fields are null", async () => {
    await aNullCostRendersTheDashInTheReportsPanel();
  });
});

describe("F3.5a reports panel — PDF export, Save to history, role gate", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("a viewer sees Export PDF and neither Save to history nor History", async () => {
    await aViewerSeesThePdfButtonAndNoSaveOrHistory();
  });

  it("the deferred pill is gone and the card names PDF · XLSX · CSV", async () => {
    await theDeferredPillIsGoneAndTheCardNamesThreeFormats();
  });

  it("Export PDF calls downloadEnergyReportPdf with the range", async () => {
    await exportPdfCallsTheApiWithTheRange();
  });

  it("a failed PDF export renders its own line", async () => {
    await aFailedPdfExportRendersItsOwnLine();
  });

  it("an admin must choose an organization before Save enables", async () => {
    await anAdminMustChooseAnOrganizationBeforeSaving();
  });

  it("a location_admin has no organization select and Save enables once the preview resolved", async () => {
    await aLocationAdminSavesWithoutAnOrganizationSelect();
  });

  it("Save calls saveEnergyReportFile(input, 'pdf', undefined) and renders the saved line", async () => {
    await saveCallsTheApiByPositionAndRendersTheSavedLine();
  });

  it("an admin save sends the format and the organization in order and refetches the list", async () => {
    await anAdminSaveSendsTheFormatAndTheOrganizationInOrder();
  });

  it("a refused save renders the API's sentence", async () => {
    await aRefusedSaveRendersTheApiSentence();
  });

  it("F3.5b — a viewer sees no Schedules heading; Export PDF is the control", async () => {
    await aViewerSeesNoSchedulesHeading();
  });

  it("F3.5b — an admin sees the Schedules heading", async () => {
    await anAdminSeesTheSchedulesHeading();
  });
});
