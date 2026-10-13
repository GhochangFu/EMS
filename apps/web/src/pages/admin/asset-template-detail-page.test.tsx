// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aRefusedPublishShowsTheSentenceOnTheCard,
  aRefusedPublishShowsTheSentenceOnce,
  aRefusedArchiveShowsTheSentenceOnce,
  aSubmittedDraftClosesItsReview,
  aSubmittedArchiveClosesItsReview,
  aRefusalAfterCancellingShowsOnThePageBanner,
  theDraftWizardSendsNoCopilotHeader,
  archiveOpensTheReviewAndSendsNothing,
  archiveSubmitSendsTheArchive,
  draftOpensTheReviewAndSendsNothing,
  draftSubmitSendsTheDraft,
  reviveIsTheDraftWizardOnAnArchivedVersion,
  theArchiveReviewIsRed,
  theArchiveWizardSendsNoCopilotHeader,
  aRunningBackfillDisablesTheLifecycleActions,
  archiveAnnouncesArchiving,
  editThisVersionKeepsItsNameWhileArchivePends,
  instantiateIsDisabledWhileArchivePends,
  instantiateIsNotBusyWhileArchivePends,
  aTruncatedViewNamesItsOmittedCount,
  draftDoesNotOfferCreateDefaultDashboards,
  locationAdminIsNotOfferedCreateDefaultDashboards,
  publishedVersionOffersCreateDefaultDashboards,
  publishOpensTheReviewAndSendsNothing,
  publishSubmitSendsThePublish,
  thePublishWizardSendsNoCopilotHeader,
  theBackfillReportNamesASlugConflictRow,
  theBackfillReportRendersASummaryAndARowPerAsset,
  theBackfillSummaryNamesTheSlugCollision,
  theInstantiateDialogStaysOpenAndShowsTheSummary,
} from "./asset-template-detail-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.2 asset template detail page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("offers Create default dashboards on a published version", async () => {
    await publishedVersionOffersCreateDefaultDashboards();
  });

  it("does not offer it on a draft", async () => {
    await draftDoesNotOfferCreateDefaultDashboards();
  });

  it("does not offer it to a location admin, who may not author", async () => {
    await locationAdminIsNotOfferedCreateDefaultDashboards();
  });

  it("renders the backfill summary and one row per asset", async () => {
    await theBackfillReportRendersASummaryAndARowPerAsset();
  });

  it("renders a slug-conflict outcome as Slug taken", async () => {
    await theBackfillReportNamesASlugConflictRow();
  });

  it("names the slug collision in the summary sentence", async () => {
    await theBackfillSummaryNamesTheSlugCollision();
  });

  it("names a truncated view's omitted count, and says nothing on an intact one", async () => {
    await aTruncatedViewNamesItsOmittedCount();
  });

  it("disables the lifecycle actions while the backfill runs", async () => {
    await aRunningBackfillDisablesTheLifecycleActions();
  });

  it("keeps the instantiate dialog open on success, with the summary and Close", async () => {
    await theInstantiateDialogStaysOpenAndShowsTheSummary();
  });

  it("B6 Archive announces Archiving… with aria-busy while archiveM is pending", async () => {
    await archiveAnnouncesArchiving();
  });

  it("B6 Edit this version keeps its name and is not busy while Archive pends", async () => {
    await editThisVersionKeepsItsNameWhileArchivePends();
  });

  it("B6 Instantiate is not busy while Archive pends", async () => {
    await instantiateIsNotBusyWhileArchivePends();
  });

  it("B6 Instantiate stays disabled while Archive pends", async () => {
    await instantiateIsDisabledWhileArchivePends();
  });
});

describe("F3.85 PR 11a Publish is the assetTemplate.publish wizard (ADR 0099 decision 6)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens the Review on Publish and sends nothing yet", async () => {
    await publishOpensTheReviewAndSendsNothing();
  });

  it("sends the publish for this template on Submit", async () => {
    await publishSubmitSendsThePublish();
  });

  it("sends the publish with no X-Copilot-Change header", async () => {
    await thePublishWizardSendsNoCopilotHeader();
  });

  it("shows a refused Publish's sentence on the wizard card (post-merge finding N3)", async () => {
    await aRefusedPublishShowsTheSentenceOnTheCard();
  });

  it("shows a refused Publish's sentence once, not again in the page banner (N3)", async () => {
    await aRefusedPublishShowsTheSentenceOnce();
  });
});

describe("F4.254 PR 2 Archive and the new draft are Review-only wizards (ADR 0099 decision 6)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens the Review on Archive and sends nothing yet", async () => {
    await archiveOpensTheReviewAndSendsNothing();
  });

  it("sends the archive for this template on Submit", async () => {
    await archiveSubmitSendsTheArchive();
  });

  it("shows the archive Review red (deactivate)", async () => {
    await theArchiveReviewIsRed();
  });

  it("sends the archive with no X-Copilot-Change header", async () => {
    await theArchiveWizardSendsNoCopilotHeader();
  });

  it("shows a refused Archive's sentence once, on the card", async () => {
    await aRefusedArchiveShowsTheSentenceOnce();
  });

  it("opens the Review on Edit this version and sends nothing yet", async () => {
    await draftOpensTheReviewAndSendsNothing();
  });

  it("sends the draft for this template on Submit", async () => {
    await draftSubmitSendsTheDraft();
  });

  it("closes the draft Review once the new draft is open", async () => {
    await aSubmittedDraftClosesItsReview();
  });

  it("closes the archive Review once the archive went through", async () => {
    await aSubmittedArchiveClosesItsReview();
  });

  it("shows a refusal that arrives after Cancel on the page banner, once", async () => {
    await aRefusalAfterCancellingShowsOnThePageBanner();
  });

  it("sends the draft with no X-Copilot-Change header", async () => {
    await theDraftWizardSendsNoCopilotHeader();
  });

  it("names the draft Review Revive as a new draft on an archived version", async () => {
    await reviveIsTheDraftWizardOnAnArchivedVersion();
  });
});
