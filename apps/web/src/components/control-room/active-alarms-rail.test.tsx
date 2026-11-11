// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";

import {
  aDeviceAlarmNamesItsRtuOrTheIngestHost,
  emptyIdsFetchNoActiveList,
  emptyIdsFetchNoSummary,
  failedAssetReadDoesNotSayLoading,
  failedAssetReadSaysUnavailable,
  fetchesTheActiveListForTheGivenIds,
  fetchesTheActiveListForTheOrganization,
  fetchesTheSummaryForTheOrganization,
  socketEventRefetchesTheOrganizationsActiveList,
  theOrganizationRailRendersItsRows,
  pausedActiveTabSaysLoadingNotNone,
  pausedSummaryTabSaysLoadingNotNone,
  pillToneComesFromTheVocabulary,
  rendersEightRowsAndNoNinth,
  rendersTheEmptyStateForNoActiveAlarms,
  resolvingIdsSayLoadingNotNone,
  socketEventRefetchesTheActiveList,
  socketEventRefetchesTheSummary,
  summaryTabListsCountsMostUrgentFirst,
  summaryTabShowsTheTotal,
  theAssetCellFallsBackToTheLocation,
  theAssetCellNamesTheRtu,
  theAssetCellsWherePartWraps,
  theRowHasTwoColumns,
  theAlarmCellHoldsLabelMessageAndPill,
  theCodeStaysOnOneLine,
  viewAllLinksToTheAlarmsPage,
} from "./active-alarms-rail.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.28 active alarms rail", () => {
  beforeEach(() => {
    // `restoreAllMocks` does not clear a `vi.fn`'s call history in Vitest 4;
    // the call-count claims below need every `it()` to start from zero.
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    onlineManager.setOnline(true);
  });

  it("renders eight rows and no ninth", async () => {
    await rendersEightRowsAndNoNinth();
  });

  it("takes the pill tone from the severity vocabulary", async () => {
    await pillToneComesFromTheVocabulary();
  });

  it("lists the summary counts most urgent first", async () => {
    await summaryTabListsCountsMostUrgentFirst();
  });

  it("shows the summary total", async () => {
    await summaryTabShowsTheTotal();
  });

  it("fetches the active list for the given ids", async () => {
    await fetchesTheActiveListForTheGivenIds();
  });

  it("refetches the active list on a socket event", async () => {
    await socketEventRefetchesTheActiveList();
  });

  it("refetches the summary on a socket event", async () => {
    await socketEventRefetchesTheSummary();
  });

  it("fetches no active list without ids", async () => {
    await emptyIdsFetchNoActiveList();
  });

  it("fetches no summary without ids", async () => {
    await emptyIdsFetchNoSummary();
  });

  it("renders the empty state when no alarm is active", async () => {
    await rendersTheEmptyStateForNoActiveAlarms();
  });

  it("says loading, not none, while the page's assets resolve", async () => {
    await resolvingIdsSayLoadingNotNone();
  });

  it("says unavailable when the page's asset read failed", () => {
    failedAssetReadSaysUnavailable();
  });

  it("does not say loading when the page's asset read failed", () => {
    failedAssetReadDoesNotSayLoading();
  });

  it("says loading, not none, on the Active tab while the read is paused", () => {
    pausedActiveTabSaysLoadingNotNone();
  });

  it("says loading, not none, on the Summary tab while the read is paused", async () => {
    await pausedSummaryTabSaysLoadingNotNone();
  });

  it("links View All to /alarms", () => {
    viewAllLinksToTheAlarmsPage();
  });

  it("F3.66 fetches the active list for the organization, with no ids", async () => {
    await fetchesTheActiveListForTheOrganization();
  });

  it("F3.66 fetches the summary for the organization, with no ids", async () => {
    await fetchesTheSummaryForTheOrganization();
  });

  it("F3.66 renders the organization's rows, not the no-ids note", async () => {
    await theOrganizationRailRendersItsRows();
  });

  it("F3.66 refetches the organization's active list on a socket event", async () => {
    await socketEventRefetchesTheOrganizationsActiveList();
  });

  it("F4.316 the Asset cell reads code · RTU", async () => {
    await theAssetCellNamesTheRtu();
  });

  it("F4.316 the Asset cell falls back to the location with no RTU", async () => {
    await theAssetCellFallsBackToTheLocation();
  });

  it("F4.316 the Asset cell's where part wraps, never truncates", async () => {
    await theAssetCellsWherePartWraps();
  });

  it("draws two columns, Time and Alarm, so the pill stays inside the rail", async () => {
    await theRowHasTwoColumns();
  });

  it("puts the label, message and pill in the Alarm cell", async () => {
    await theAlarmCellHoldsLabelMessageAndPill();
  });

  it("keeps the asset code on one line", async () => {
    await theCodeStaysOnOneLine();
  });

  it("F3.16 names a device alarm's RTU or the ingest host; a rule alarm renders as before", async () => {
    await aDeviceAlarmNamesItsRtuOrTheIngestHost();
  });
});
