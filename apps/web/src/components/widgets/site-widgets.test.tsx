// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aCardOnAHealthyTabReadsNormal,
  aCardOnAnUnlistedTabSaysOutsideScope,
  aCardOnAnUnreadableTabSaysOutsideScope,
  aFailedSiteWidgetDrawsTheErrorLine,
  aRailOnTheSummaryTabFallsBackWhenTheSummaryIsTurnedOff,
  aLoadingSiteWidgetDrawsThePlaceholderNotItsBody,
  cleanupWidgets,
  theCardDrawsNoLinkOffTheSitePage,
  theCardLinksToItsTargetTab,
  theCardShowsItsTabsStatusAndCounts,
  theLegendNamesNormalAndOffline,
  theListLinksEachRowToItsTab,
  theListSaysSoWhenTheDashboardHasNoGroupTab,
  theListShowsOneRowPerGroupTab,
  theListShowsOutsideScopeForATabWithNoStatus,
  theRailDrawsAtMostItsConfiguredRows,
  theRailHidesTheSummaryTabWhenConfiguredOff,
  theRailListsTheActiveAlarmsOfItsTab,
  theRailSaysSoWhenNoAlarmIsActive,
  theRailSummaryTabShowsTheTotal,
  theStripDrawsOnePillPerRole,
  theStripSaysSoWhenNoRoleIsInScope,
} from "./site-widgets.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom docblock
 * is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F3.73 site widgets — presentation", () => {
  afterEach(() => {
    cleanupWidgets();
  });

  it("SW1 the rail lists the active alarms of its tab", () => {
    theRailListsTheActiveAlarmsOfItsTab();
  });
  it("SW2 the rail draws at most its configured rows", () => {
    theRailDrawsAtMostItsConfiguredRows();
  });
  it("SW3 the rail's summary tab shows the total and the most urgent severity first", async () => {
    await theRailSummaryTabShowsTheTotal();
  });
  it("SW4 the rail hides the summary tab when configured off", () => {
    theRailHidesTheSummaryTabWhenConfiguredOff();
  });
  it("SW21 a rail on the summary tab falls back to the alarms when the summary is turned off", async () => {
    await aRailOnTheSummaryTabFallsBackWhenTheSummaryIsTurnedOff();
  });
  it("SW5 the rail says so when no alarm is active", () => {
    theRailSaysSoWhenNoAlarmIsActive();
  });
  it("SW6 the legend names Normal and Offline", async () => {
    await theLegendNamesNormalAndOffline();
  });
  it("SW7 the strip draws one pill per role", () => {
    theStripDrawsOnePillPerRole();
  });
  it("SW8 the strip says so when no role is in scope", () => {
    theStripSaysSoWhenNoRoleIsInScope();
  });
  it("SW9 the card shows its tab's status and counts", () => {
    theCardShowsItsTabsStatusAndCounts();
  });
  it("SW10 the card links to the tab its config names", () => {
    theCardLinksToItsTargetTab();
  });
  it("SW11 the card draws no link off the site page", () => {
    theCardDrawsNoLinkOffTheSitePage();
  });
  it("SW12 a card on a healthy tab reads Normal", () => {
    aCardOnAHealthyTabReadsNormal();
  });
  it("SW13 a card on an unreadable tab says Outside scope", () => {
    aCardOnAnUnreadableTabSaysOutsideScope();
  });
  it("SW14 a card on an unlisted tab says Outside scope", () => {
    aCardOnAnUnlistedTabSaysOutsideScope();
  });
  it("SW15 the list shows one row per group tab", () => {
    theListShowsOneRowPerGroupTab();
  });
  it("SW16 the list shows Outside scope for a tab with no status", () => {
    theListShowsOutsideScopeForATabWithNoStatus();
  });
  it("SW17 the list links each row to its tab", () => {
    theListLinksEachRowToItsTab();
  });
  it("SW18 the list says so when the dashboard has no group tab", () => {
    theListSaysSoWhenTheDashboardHasNoGroupTab();
  });
  it("SW19 a loading site widget draws the placeholder, not its body", () => {
    aLoadingSiteWidgetDrawsThePlaceholderNotItsBody();
  });
  it("SW20 a failed site widget draws the error line", () => {
    aFailedSiteWidgetDrawsTheErrorLine();
  });
});
