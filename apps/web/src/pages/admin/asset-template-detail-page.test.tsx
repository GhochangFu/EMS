// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aRunningBackfillDisablesTheLifecycleActions,
  archiveAnnouncesArchiving,
  editThisVersionKeepsItsNameWhileArchivePends,
  instantiateIsDisabledWhileArchivePends,
  instantiateIsNotBusyWhileArchivePends,
  aTruncatedViewNamesItsOmittedCount,
  draftDoesNotOfferCreateDefaultDashboards,
  locationAdminIsNotOfferedCreateDefaultDashboards,
  publishedVersionOffersCreateDefaultDashboards,
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
