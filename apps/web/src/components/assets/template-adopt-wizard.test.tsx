// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  a409ShowsItsRefusalsBesideTheCard,
  aNewSubmitClearsTheEarlierError,
  aPreviewRefusedOnReviewSaysWhy,
  aPreviewRefusedOnReviewSendsNothing,
  after409BackDisablesNext,
  after409BackListsTheServersRefusals,
  aCleanPreviewSubmitsTheAssetIdsToThePickedVersion,
  aMixedDomainBatchPickerHoldsNoVersion,
  aMixedOrganizationBatchOffersNoVersion,
  aSuccessClosesTheWizard,
  aSuccessInvalidatesAssetsPointsCalcPointsDashboardsAndRules,
  inheritedDefaultsShowAsANotice,
  nextIsDisabledWhileARefusalExists,
  theRefusalSentenceNamesTheAssetCodeAndTheKey,
  theRefusedSentenceSitsAboveItsList,
  thePickerListsOnlyPublishedSameOrganizationSameDomainVersions,
  thePreviewIsOfThePickedVersionAndTheSelection,
  thePreviewListsKeptAddedAndConverted,
} from "./template-adopt-wizard.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.312 PR 3 — the adopt wizard", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("the picker lists only published same-organization same-domain versions", async () => {
    await thePickerListsOnlyPublishedSameOrganizationSameDomainVersions();
  });
  it("a mixed-organization batch offers no version and says why", async () => {
    await aMixedOrganizationBatchOffersNoVersion();
  });
  it("a mixed-domain batch's picker holds no version", async () => {
    await aMixedDomainBatchPickerHoldsNoVersion();
  });
  it("the preview lists kept, added and converted", async () => {
    await thePreviewListsKeptAddedAndConverted();
  });
  it("the preview is of the picked version and the selection", async () => {
    await thePreviewIsOfThePickedVersionAndTheSelection();
  });
  it("Next is disabled while a refusal exists", async () => {
    await nextIsDisabledWhileARefusalExists();
  });
  it("the refusal sentence names the asset code and the key", async () => {
    await theRefusalSentenceNamesTheAssetCodeAndTheKey();
  });
  it("F4.315 B1: the refused sentence sits above the refusals it points to", async () => {
    await theRefusedSentenceSitsAboveItsList();
  });
  it("inherited defaults show as a notice", async () => {
    await inheritedDefaultsShowAsANotice();
  });
  it("a clean preview submits the asset ids to the picked version", async () => {
    await aCleanPreviewSubmitsTheAssetIdsToThePickedVersion();
  });
  it("a success closes the wizard", async () => {
    await aSuccessClosesTheWizard();
  });
  it("a success invalidates assets, points, calc points, dashboards and rules", async () => {
    await aSuccessInvalidatesAssetsPointsCalcPointsDashboardsAndRules();
  });
  it("a 409 shows its refusals beside the card", async () => {
    await a409ShowsItsRefusalsBesideTheCard();
  });
  it("after a 409, Back lists the server's refusals", async () => {
    await after409BackListsTheServersRefusals();
  });
  it("after a 409, Back disables Next", async () => {
    await after409BackDisablesNext();
  });
  it("a preview refused while Review is open says why on Review", async () => {
    await aPreviewRefusedOnReviewSaysWhy();
  });
  it("a preview refused while Review is open sends nothing on Submit", async () => {
    await aPreviewRefusedOnReviewSendsNothing();
  });
  it("a new Submit clears the earlier error", async () => {
    await aNewSubmitClearsTheEarlierError();
  });
});
