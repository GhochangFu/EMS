// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aCopilotFillReachesTheAssetRows,
  aFilledSiteNameReachesTheBody,
  anAssetsFillAfterAnRtuChoiceKeepsTheLocation,
  aTargetFillOfALocationAfterAnRtuChoiceSendsTheLocation,
  aFilledVariableIsSent,
  aMissingVariableRefusesSubmitWithTheRowAndName,
  anRtuChoiceSendsRtuIdAndNoLocationId,
  theInstantiateDialogStaysOpenAndShowsTheSummary,
  theInstantiateReviewShowsTheEntrySummary,
  theInstantiateWizardSendsNoCopilotHeader,
} from "./asset-template-instantiate.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F4.254 PR 3 the asset template instantiate wizard", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps the instantiate wizard open on success, with the summary and Close only", async () => {
    await theInstantiateDialogStaysOpenAndShowsTheSummary();
  });

  it("shows the instantiate entry's summary on the Review", async () => {
    await theInstantiateReviewShowsTheEntrySummary();
  });

  it("sends rtuId and no locationId when an RTU is chosen", async () => {
    await anRtuChoiceSendsRtuIdAndNoLocationId();
  });

  it("puts a copilot fill of the Assets step into the row editor", async () => {
    await aCopilotFillReachesTheAssetRows();
  });

  it("keeps the location and sends the RTU after an Assets fill that follows an RTU choice", async () => {
    await anAssetsFillAfterAnRtuChoiceKeepsTheLocation();
  });

  it("sends the filled location and no RTU after a Target fill that follows an RTU choice", async () => {
    await aTargetFillOfALocationAfterAnRtuChoiceSendsTheLocation();
  });

  it("sends a copilot-filled siteName in the body", async () => {
    await aFilledSiteNameReachesTheBody();
  });

  it("refuses Submit naming the row and the missing variable", async () => {
    await aMissingVariableRefusesSubmitWithTheRowAndName();
  });

  it("sends a filled variable as sourceDataKeyVars", async () => {
    await aFilledVariableIsSent();
  });

  it("sends no X-Copilot-Change header", async () => {
    await theInstantiateWizardSendsNoCopilotHeader();
  });
});
