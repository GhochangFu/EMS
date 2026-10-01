// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aCardOnAHealthyTabReadsNormal,
  aLongLegendTitleTruncatesAndKeepsThePills,
  anInfoAlarmBesideAnOfflineMemberReadsOffline,
  anInfoAlarmWithNoOfflineMemberReadsItsLabel,
  anUnlistedSeverityBesideAnOfflineMemberKeepsItsCode,
  aWarningAlarmBesideAnOfflineMemberReadsWarning,
  aCardOnATabWithOfflineMembersNeverReadsNormal,
  aListRowWithOfflineMembersNeverReadsNormal,
  anOfflineCardsPillCarriesTheWarningTone,
  theCountsSaySingularForOneAlarm,
  theCountsSaySingularForOneAsset,
  aCardOnAnUnlistedTabSaysOutsideScope,
  aCardOnAnUnreadableTabSaysOutsideScope,
  aFailedSiteWidgetDrawsTheErrorLine,
  aRailOnTheSummaryTabFallsBackWhenTheSummaryIsTurnedOff,
  aLoadingSiteWidgetDrawsThePlaceholderNotItsBody,
  cleanupWidgets,
  theCardDrawsNoLinkOffTheSitePage,
  theCardLinksToItsTargetTab,
  theCardShowsItsTabsStatusAndCounts,
  theLegendDrawsNoHeadingButItsTitleInline,
  theLegendNamesNormalAndOffline,
  theLegendTitleAndPillsShareOneRow,
  theListHasNoLinkWithoutATabHref,
  theListIsNamedByTheWidgetTitle,
  theListLinksEachRowToItsTab,
  theListNameIsNotALink,
  theListSaysSoWhenTheDashboardHasNoGroupTab,
  theListShowsOneRowPerGroupTab,
  theListShowsOutsideScopeForATabWithNoStatus,
  aRenamedRailKeepsItsHeadingAndALoadingRailKeepsItsTitle,
  theRailDoesNotRepeatItsTabAsAHeading,
  theRailDrawsAtMostItsConfiguredRows,
  theRailHidesTheSummaryTabWhenConfiguredOff,
  theRailListsTheActiveAlarmsOfItsTab,
  theRailSaysSoWhenNoAlarmIsActive,
  theRailSummaryTabShowsTheTotal,
  theStripDrawsOnePillPerRole,
  theStripSaysSoWhenNoRoleIsInScope,
  theAccessibleNameNamesTheStatusAndTheCount,
  theAccessibleNameOfAnUnreadableTabSaysOutsideScope,
  theLabelReadsNormalWithNoAlarmAndNoOfflineMember,
  theLabelReadsOfflineWhenAnOfflineMemberSetsTheTone,
  theLabelReadsTheWorstSeveritysVocabularyLabel,
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
  it("SW1b the rail does not repeat its tab as a heading", () => {
    theRailDoesNotRepeatItsTabAsAHeading();
  });
  it("SW1c a renamed or loading rail keeps its title", () => {
    aRenamedRailKeepsItsHeadingAndALoadingRailKeepsItsTitle();
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
  it("SW32 the legend draws no heading, but its title inline (F3.77 D2)", async () => {
    await theLegendDrawsNoHeadingButItsTitleInline();
  });
  it("SW31 the legend's title and pills share one clipped row (F3.77 D2)", async () => {
    await theLegendTitleAndPillsShareOneRow();
  });
  it("SW33 a long legend title truncates and keeps the pills (F3.77 review)", async () => {
    await aLongLegendTitleTruncatesAndKeepsThePills();
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
  it("SW17 the list links each row to its tab through an Open link", () => {
    theListLinksEachRowToItsTab();
  });
  it("SW50 the list name is text, not a link", () => {
    theListNameIsNotALink();
  });
  it("SW51 the list draws no link without a tab href", () => {
    theListHasNoLinkWithoutATabHref();
  });
  it("SW52 the list is named by the widget title", () => {
    theListIsNamedByTheWidgetTitle();
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
  it("SW22 a card on a tab with offline members reads Offline, never Normal", () => {
    aCardOnATabWithOfflineMembersNeverReadsNormal();
  });
  it("SW23 an offline card's pill carries the warning tone", () => {
    anOfflineCardsPillCarriesTheWarningTone();
  });
  it("SW24 a list row with offline members reads Offline, never Normal", () => {
    aListRowWithOfflineMembersNeverReadsNormal();
  });
  it('SW25 the counts say "1 alarm" for one alarm', () => {
    theCountsSaySingularForOneAlarm();
  });
  it('SW26 the counts say "1 asset" for one asset', () => {
    theCountsSaySingularForOneAsset();
  });
  it("SW27 an info alarm beside an offline member reads Offline, not Info", () => {
    anInfoAlarmBesideAnOfflineMemberReadsOffline();
  });
  it("SW28 an info alarm with no offline member reads its label", () => {
    anInfoAlarmWithNoOfflineMemberReadsItsLabel();
  });
  it("SW29 a warning alarm beside an offline member reads Warning", () => {
    aWarningAlarmBesideAnOfflineMemberReadsWarning();
  });
  it("SW30 an unlisted severity beside an offline member keeps its code", () => {
    anUnlistedSeverityBesideAnOfflineMemberKeepsItsCode();
  });
  it("SW36 tabStatusLabel reads Offline when an offline member sets the tone", () => {
    theLabelReadsOfflineWhenAnOfflineMemberSetsTheTone();
  });
  it("SW37 tabStatusLabel reads the worst severity's vocabulary label", () => {
    theLabelReadsTheWorstSeveritysVocabularyLabel();
  });
  it("SW38 tabStatusLabel reads Normal with no alarm and no offline member", () => {
    theLabelReadsNormalWithNoAlarmAndNoOfflineMember();
  });
  it("SW39 tabAccessibleName names the status and the alarm count", () => {
    theAccessibleNameNamesTheStatusAndTheCount();
  });
  it("SW40 tabAccessibleName of an unreadable tab says Outside scope", () => {
    theAccessibleNameOfAnUnreadableTabSaysOutsideScope();
  });
});
