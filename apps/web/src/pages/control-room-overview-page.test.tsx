// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { useAuthStore } from "../stores/auth-store";
import {
  aMissingPriorAmongLiveInputsGivesNoDelta,
  aNullPriorKeepsTheTotalCrLoadHint,
  alarmsRailFetchesNothingWhileTheAssetsArePending,
  alarmsRailQueriesThePageAssetIds,
  alarmsRailSaysLoadingWhileTheAssetsArePending,
  alarmsRailSaysUnavailableWhenTheAssetsFailed,
  alarmsRailShowsTheMessageVerbatim,
  alarmsRailSummaryShowsTheCounts,
  alarmsRailViewAllLinksToTheAlarmsPage,
  itRackLoadSectionSaysItIsOutsideTheScope,
  rackLoadReadsADashOutsideTheItScope,
  rackLoadWearsTheBoltIcon,
  rackLoadReadsTheRackSumUnderAGlobalScope,
  rackLoadSaysItIsOutsideTheScope,
  rendersTheSectionHeadings,
  rendersThePageTitle,
  rendersTheSixKpiLabelsInOrder,
  rackLoadRendersItsOwnDelta,
  rendersAllSevenFooterItems,
  rendersTheFourKeyParameterGaugeTitles,
  keyParametersUpsGaugesAreOutsideAScopeWithoutUpsBattery,
  keyParametersPowerFactorIsOutsideAScopeWithoutElectrical,
  ruleWarningsCountsAMatchedThresholdRule,
  ruleWarningsWearsTheAlertIcon,
  sldStatusHasNoDelta,
  sldStatusReadsOfflineWhenTheMainIncomerIsStale,
  sldStatusReadsOkWhenEveryBreakerIsLive,
  subtitleLeadsWithTheLiveCriticalCount,
  theDefaultViewIsTheDiagram,
  theListTabHidesTheDiagramSvg,
  theListTabShowsTwelveBreakerRows,
  theListViewShowsAStaleBreakerOffline,
  theListViewWarnsOnAnSldOnlyPointKey,
  SLD_ONLY_POINT_KEYS,
  theClassStripShowsTheRoleSummary,
  theClassStripQueriesThePageAssetIds,
  theClassStripSaysLoadingWhileTheAssetsArePending,
  theOtherThreeTilesWearNoIcon,
  theStateLegendRendersNormalTheVocabularyAndOffline,
  theViewModeDoesNotSurviveARemount,
  thePriorReadAsksForExactlyFiveRefs,
  totalCrLoadExcludesAStaleMainIncomer,
  totalCrLoadRendersARiseAgainstALowerPrior,
  totalCrLoadSumsTheMainBusAndBothRacks,
  totalCrLoadWearsTheBoltIcon,
  q1OpenFullSldTargetsTheSldTab,
  q2QuickDrilldownHvacTargetsTheHvacTab,
  q3NoLinkTargetsALegacyPath,
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
    // Nothing here writes it; a persisted view mode must not leak across it()s.
    localStorage.clear();
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

  it("renders a Total CR Load rise against a prior 10 % lower", async () => {
    await totalCrLoadRendersARiseAgainstALowerPrior();
  });

  it("keeps the Total CR Load hint when its prior is null", async () => {
    await aNullPriorKeepsTheTotalCrLoadHint();
  });

  it("renders Rack Load's own delta, not Total CR Load's", async () => {
    await rackLoadRendersItsOwnDelta();
  });

  it("renders no delta on SLD Status", async () => {
    await sldStatusHasNoDelta();
  });

  it("asks the prior read for exactly five refs", async () => {
    await thePriorReadAsksForExactlyFiveRefs();
  });

  it("renders no Total CR Load delta when one live input has no prior", async () => {
    await aMissingPriorAmongLiveInputsGivesNoDelta();
  });

  it("puts the alert icon on Rule Warnings", () => {
    ruleWarningsWearsTheAlertIcon();
  });

  it("puts the bolt icon on Total CR Load", () => {
    totalCrLoadWearsTheBoltIcon();
  });

  it("puts the bolt icon on Rack Load", () => {
    rackLoadWearsTheBoltIcon();
  });

  it("puts no icon on SLD Status, UPS Backup or Environment", () => {
    theOtherThreeTilesWearNoIcon();
  });

  it("shows the diagram by default", () => {
    theDefaultViewIsTheDiagram();
  });

  it("shows twelve breaker rows on the List tab", async () => {
    await theListTabShowsTwelveBreakerRows();
  });

  it("hides the diagram svg on the List tab", async () => {
    await theListTabHidesTheDiagramSvg();
  });

  it("does not keep the view mode across a remount", async () => {
    await theViewModeDoesNotSurviveARemount();
  });

  it("shows a stale breaker as OFFLINE in the List view", async () => {
    await theListViewShowsAStaleBreakerOffline();
  });

  it.each(SLD_ONLY_POINT_KEYS.map((row) => row.pointKey))(
    "warns in the List view on %s, a point key only /cr-sld read before",
    async (pointKey) => {
      await theListViewWarnsOnAnSldOnlyPointKey(pointKey);
    },
  );

  it("renders the state legend with Normal, the vocabulary and Offline", async () => {
    await theStateLegendRendersNormalTheVocabularyAndOffline();
  });

  it("renders the four Key Parameters gauge titles", () => {
    rendersTheFourKeyParameterGaugeTitles();
  });

  it("says the UPS and battery gauges are outside a scope without UPS/battery", () => {
    keyParametersUpsGaugesAreOutsideAScopeWithoutUpsBattery();
  });

  it("says the power factor gauge is outside a scope without electrical", () => {
    keyParametersPowerFactorIsOutsideAScopeWithoutElectrical();
  });

  it("renders all seven capability footer items", () => {
    rendersAllSevenFooterItems();
  });

  it("mounts the class strip with the role summary", async () => {
    await theClassStripShowsTheRoleSummary();
  });

  it("asks the class strip read for the page's asset ids", async () => {
    await theClassStripQueriesThePageAssetIds();
  });

  it("the class strip says loading while the context's assets are pending", () => {
    theClassStripSaysLoadingWhileTheAssetsArePending();
  });

  it("F3.70 Q1: Open Full SLD targets the site's sld tab", () => {
    q1OpenFullSldTargetsTheSldTab();
  });

  it("F3.70 Q2: Quick Drilldown HVAC System targets the site's hvac tab", () => {
    q2QuickDrilldownHvacTargetsTheHvacTab();
  });

  it("F3.70 Q3: no link targets a /cr-* path under the site route", () => {
    q3NoLinkTargetsALegacyPath();
  });
});
