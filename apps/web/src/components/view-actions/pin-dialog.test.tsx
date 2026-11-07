// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { afterEach, describe, it, vi } from "vitest";

import {
  aConflictIsTheFullTabSentence,
  aPinnedDialogDisablesTheSubmit,
  aSpanOfOneYearPins,
  aSpanPastOneYearCannotBePinned,
  anotherTabAfterAPinEnablesTheSubmit,
  aCustomRangeNamesTheWindow,
  aCustomRangePinsItsSpan,
  aForbiddenIsTheRefusedSentence,
  aNotFoundIsTheRefusedSentence,
  aPartMinuteSpanRoundsUp,
  aChosenKindIsSent,
  aKindThatStopsFittingDisablesPinWithItsReason,
  aHeatmapIsDisabledWithItsReasonOnAShortView,
  aHeatmapIsEnabledOnSevenDaysOfOnePoint,
  aPresetPinsItsOwnLength,
  theDefaultKindSendsNoSeries,
  aPresetShowsNoWindowSentence,
  aSegmentSendsAvg,
  aSegmentSendsOnlyTheDrawnEntries,
  aSegmentTodayPinsThePeriodSpan,
  aTabbedDashboardShowsItsTabs,
  anUntabbedDashboardIsSentNoTabKey,
  anUntabbedDashboardShowsNoTabSelect,
  anyOtherFailureIsPinFailed,
  historySendsItsFunction,
  historySendsTheChosenPoints,
  successLinksToTheDashboard,
  theButtonIsAbsentForAnOperator,
  theButtonShowsForAnAssetGroupAdmin,
  theChartsDefaultSizeIsSent,
  theChosenTabIsSent,
  theDefaultTitleIsSent,
  theDialogListsTheDashboards,
  theErrorMessageIsNeverRendered,
  theSubmitIsBusyWhilePending,
} from "./pin-dialog.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.303 U15 Pin", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("D1: the button shows for asset_group_admin", () => {
    theButtonShowsForAnAssetGroupAdmin();
  });
  it("D1: the button is absent for operator", () => {
    theButtonIsAbsentForAnOperator();
  });
  it("D2: the dialog lists the caller's dashboards", async () => {
    await theDialogListsTheDashboards();
  });
  it("D3: a tabbed dashboard shows its tabs", async () => {
    await aTabbedDashboardShowsItsTabs();
  });
  it("D3: an untabbed dashboard shows no tab select", async () => {
    await anUntabbedDashboardShowsNoTabSelect();
  });
  it("D3: the chosen tab's key is sent", async () => {
    await theChosenTabIsSent();
  });
  it("D3: an untabbed dashboard is sent no tabKey", async () => {
    await anUntabbedDashboardIsSentNoTabKey();
  });
  it("D4: a preset pins its own length", async () => {
    await aPresetPinsItsOwnLength();
  });
  it("F4.324: the default kind sends no series", async () => {
    await theDefaultKindSendsNoSeries();
  });
  it("F4.324: a chosen kind is sent as config.series", async () => {
    await aChosenKindIsSent();
  });
  it("F4.324: a heatmap is disabled with its reason on a 24 h view", async () => {
    await aHeatmapIsDisabledWithItsReasonOnAShortView();
  });
  it("F4.324: a heatmap is enabled on 7 days of one point", async () => {
    await aHeatmapIsEnabledOnSevenDaysOfOnePoint();
  });
  it("F4.324: a kind that stops fitting stays chosen, shows its reason and disables Pin", async () => {
    await aKindThatStopsFittingDisablesPinWithItsReason();
  });
  it("D4: a preset shows no window sentence", async () => {
    await aPresetShowsNoWindowSentence();
  });
  it("D4: a custom range of 36 h 30 min pins 2190 minutes", async () => {
    await aCustomRangePinsItsSpan();
  });
  it("D4: a custom range names the trailing window", async () => {
    await aCustomRangeNamesTheWindow();
  });
  it("D4: a part-minute span rounds up", async () => {
    await aPartMinuteSpanRoundsUp();
  });
  it("D4: a segment's today pins the span of its period", async () => {
    await aSegmentTodayPinsThePeriodSpan();
  });
  it("D5: history sends its chosen points", async () => {
    await historySendsTheChosenPoints();
  });
  it("D5: history sends its function", async () => {
    await historySendsItsFunction();
  });
  it("D6: a segment sends only its drawn entries", async () => {
    await aSegmentSendsOnlyTheDrawnEntries();
  });
  it("D6: a segment sends avg", async () => {
    await aSegmentSendsAvg();
  });
  it("D7: the chart's default size is sent", async () => {
    await theChartsDefaultSizeIsSent();
  });
  it("the default title is sent", async () => {
    await theDefaultTitleIsSent();
  });
  it("the submit is aria-busy while pending", async () => {
    await theSubmitIsBusyWhilePending();
  });
  it("D8: a 409 is the full-tab sentence", async () => {
    await aConflictIsTheFullTabSentence();
  });
  it("D8: a 404 is the refused sentence", async () => {
    await aNotFoundIsTheRefusedSentence();
  });
  it("D8: a 403 is the refused sentence", async () => {
    await aForbiddenIsTheRefusedSentence();
  });
  it("D8: any other failure is Pin failed.", async () => {
    await anyOtherFailureIsPinFailed();
  });
  it("D8: the error message is never rendered", async () => {
    await theErrorMessageIsNeverRendered();
  });
  it("D9: success links to the dashboard", async () => {
    await successLinksToTheDashboard();
  });
  it("review: a pinned dialog disables the submit", async () => {
    await aPinnedDialogDisablesTheSubmit();
  });
  it("review: another tab after a pin enables the submit", async () => {
    await anotherTabAfterAPinEnablesTheSubmit();
  });
  it("review: a span of one year pins", () => {
    aSpanOfOneYearPins();
  });
  it("review: a span past one year cannot be pinned", () => {
    aSpanPastOneYearCannotBePinned();
  });
});
