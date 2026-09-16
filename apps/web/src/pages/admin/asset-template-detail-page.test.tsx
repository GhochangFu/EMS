// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aTruncatedViewNamesItsOmittedCount,
  draftDoesNotOfferCreateDefaultDashboards,
  locationAdminIsNotOfferedCreateDefaultDashboards,
  publishedVersionOffersCreateDefaultDashboards,
  theBackfillReportRendersASummaryAndARowPerAsset,
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

  it("names a truncated view's omitted count, and says nothing on an intact one", async () => {
    await aTruncatedViewNamesItsOmittedCount();
  });

  it("keeps the instantiate dialog open on success, with the summary and Close", async () => {
    await theInstantiateDialogStaysOpenAndShowsTheSummary();
  });
});
