// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, it, vi } from "vitest";

import {
  aFailedSummaryLeavesTheTableWorking,
  aSingleOrganizationIsLockedAndNotSent,
  aUrlLocationIsSentOnFirstLoad,
  anAssetGroupInTheUrlIsSentToNeither,
  anOrganizationIsInTheUrlAndBothReads,
  onlyOrganizationAndLocationPickers,
  pendingOptionsWithAScopeReadLoading,
  theCardsSitAboveTheTable,
  aFailedReadShowsTheError,
  aPendingReadIsLoadingNotEmpty,
  aTruncatedListSaysSo,
  aWholeListSaysNothingOfTruncation,
  anEmptyListSaysWhy,
  eachRowsHourIsInItsOwnZone,
  rowsRenderInTheGivenOrder,
  scoreDetectorAndPoints,
  statusIsAnAdvisoryPill,
  theLinkOpensTheHistoryAroundTheHour,
  theListIsReadEveryFifteenMinutes,
  thePageSaysAdvisory,
  theScoreIsTruncatedAndGuarded,
} from "./anomalies-page.spec";

/**
 * Vitest entry point (ADR 0014, ADR 0042 decision 2) — assertions live in the sibling `.spec`.
 * `TZ` is pinned to a zone no fixture uses, so an hour formatted in the browser's zone fails.
 */
beforeAll(() => {
  vi.stubEnv("TZ", "America/St_Johns");
});
afterAll(() => {
  vi.unstubAllEnvs();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("E1.2c — the Anomalies page", () => {
  it("renders rows in the given order", () => rowsRenderInTheGivenOrder());
  it("formats each row's hour in its own site zone", () => eachRowsHourIsInItsOwnZone());
  it("shows the score to three decimals, the detector label and the points joined", () => scoreDetectorAndPoints());
  it("shows an Advisory pill in the info tone", () => statusIsAnAdvisoryPill());
  it("links each row to the asset's history around that hour with its points", () =>
    theLinkOpensTheHistoryAroundTheHour());
  it("says why an empty list is empty", () => anEmptyListSaysWhy());
  it("says when the list is truncated", () => aTruncatedListSaysSo());
  it("says nothing of truncation when the list is whole", () => aWholeListSaysNothingOfTruncation());
  it("truncates a score to three decimals and shows a dash for a drifted one", () => theScoreIsTruncatedAndGuarded());
  it("says advisory, and no alarm language", () => thePageSaysAdvisory());
  it("says loading, not empty, while the read is pending", () => aPendingReadIsLoadingNotEmpty());
  it("reads the list again every 15 minutes", () => theListIsReadEveryFifteenMinutes());
  it("shows one fixed sentence when the read fails", () => aFailedReadShowsTheError());
  it("E1.9b: draws only the Organization and Location pickers", () => onlyOrganizationAndLocationPickers());
  it("E1.9b: an organization choice is in the URL and both reads", () => anOrganizationIsInTheUrlAndBothReads());
  it("E1.9b: a URL location is sent on the first read", () => aUrlLocationIsSentOnFirstLoad());
  it("E1.9b: an asset group in the URL is sent to neither read", () => anAssetGroupInTheUrlIsSentToNeither());
  it("E1.9b: a single organization is locked and not sent", () => aSingleOrganizationIsLockedAndNotSent());
  it("E1.9b: pending options with a scope read loading, not empty", () => pendingOptionsWithAScopeReadLoading());
  it("E1.9b: the findings cards sit above the table", () => theCardsSitAboveTheTable());
  it("E1.9b: a failed summary read leaves the table working", () => aFailedSummaryLeavesTheTableWorking());
});
