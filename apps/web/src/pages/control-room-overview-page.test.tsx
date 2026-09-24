// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useAuthStore } from "../stores/auth-store";
import {
  alarmsRailFetchesNothingWhileTheAssetsArePending,
  alarmsRailQueriesThePageAssetIds,
  alarmsRailSaysLoadingWhileTheAssetsArePending,
  alarmsRailSaysUnavailableWhenTheAssetsFailed,
  alarmsRailShowsTheMessageVerbatim,
  alarmsRailSummaryShowsTheCounts,
  alarmsRailViewAllLinksToTheAlarmsPage,
  itRackLoadSectionSaysItIsOutsideTheScope,
  rackLoadReadsADashOutsideTheItScope,
  rackLoadReadsTheRackSumUnderAGlobalScope,
  rackLoadSaysItIsOutsideTheScope,
  rendersTheSectionHeadings,
  rendersThePageTitle,
  rendersTheSixKpiLabelsInOrder,
  ruleWarningsCountsAMatchedThresholdRule,
  sldStatusReadsOfflineWhenTheMainIncomerIsStale,
  sldStatusReadsOkWhenEveryBreakerIsLive,
  subtitleLeadsWithTheLiveCriticalCount,
  totalCrLoadExcludesAStaleMainIncomer,
  totalCrLoadSumsTheMainBusAndBothRacks,
} from "./control-room-overview-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.28 characterization of /cr-overview", () => {
  beforeEach(() => {
    // The alarm fetch mocks keep their call history across `it()`s otherwise.
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    useAuthStore.setState({ scope: null });
  });

  it("renders the page title", () => {
    rendersThePageTitle();
  });

  it("renders the six KPI labels in order", () => {
    rendersTheSixKpiLabelsInOrder();
  });

  it("sums the main bus and both racks into Total CR Load", () => {
    totalCrLoadSumsTheMainBusAndBothRacks();
  });

  it("counts a matched threshold rule in Rule Warnings", async () => {
    await ruleWarningsCountsAMatchedThresholdRule();
  });

  it("reads SLD Status OK when every breaker is live", () => {
    sldStatusReadsOkWhenEveryBreakerIsLive();
  });

  it("reads SLD Status OFFLINE when the main incomer is stale", () => {
    sldStatusReadsOfflineWhenTheMainIncomerIsStale();
  });

  it("excludes a stale main incomer from Total CR Load", () => {
    totalCrLoadExcludesAStaleMainIncomer();
  });

  it("renders the section headings", () => {
    rendersTheSectionHeadings();
  });

  it("reads the rack sum in Rack Load under a global scope", () => {
    rackLoadReadsTheRackSumUnderAGlobalScope();
  });

  it("reads a dash in Rack Load outside the IT scope", () => {
    rackLoadReadsADashOutsideTheItScope();
  });

  it("says Rack Load is outside the scope in its hint", () => {
    rackLoadSaysItIsOutsideTheScope();
  });

  it("replaces the IT Rack Load section with its scope message", () => {
    itRackLoadSectionSaysItIsOutsideTheScope();
  });

  it("shows a server alarm's message verbatim in the alarms rail", async () => {
    await alarmsRailShowsTheMessageVerbatim();
  });

  it("shows the alarm summary counts most urgent first", async () => {
    await alarmsRailSummaryShowsTheCounts();
  });

  it("links the alarms rail's View All to /alarms", () => {
    alarmsRailViewAllLinksToTheAlarmsPage();
  });

  it("queries the alarms rail with the page's asset ids", async () => {
    await alarmsRailQueriesThePageAssetIds();
  });

  it("says the alarms rail is loading while the page's assets are pending", () => {
    alarmsRailSaysLoadingWhileTheAssetsArePending();
  });

  it("fetches no alarms while the page's assets are pending", async () => {
    await alarmsRailFetchesNothingWhileTheAssetsArePending();
  });

  it("says the alarms rail is unavailable when the page's asset read failed", () => {
    alarmsRailSaysUnavailableWhenTheAssetsFailed();
  });

  it("leads the subtitle with the live critical count", async () => {
    await subtitleLeadsWithTheLiveCriticalCount();
  });
});
