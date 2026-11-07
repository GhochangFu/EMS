// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aBadRequestShowsTheListsSentence,
  aDraftChartRowCarriesThePointIds,
  aNinthAssetPointIsRefused,
  aPartFailedFinishNamesTheWrittenTabAndNeverDuplicates,
  hiddenAssetsAreCountedAndRefused,
  twoTabsGetTwoCharts,
  chartAppendsOneChartPerTab,
  chartNeedsAFunctionBeforeNext,
  aConflictShowsTheFullSentence,
  aForbiddenShowsTheRefusedSentence,
  aNotFoundShowsTheRefusedSentence,
  aRetickedSegmentGetsItsDefaultAgain,
  aSecondVisitKeepsTheEditsAndDefaultsTheNewSegment,
  aServerErrorShowsTheFallbackSentence,
  appendFinishPostsOneBodyInTabOrder,
  cleanupTrendStripWizard,
  draftFinishAppliesRowsAndRequestsNothing,
  theColourSelectWritesTheRole,
  theStyleSelectWritesTheStyle,
  theDefaultOptionDeletesTheKey,
  theFinishButtonIsBusyWhilePending,
  thePointsStepPreselectsThreePerSegment,
  thePreviewReadsTheStripWithTheSelection,
  theSegmentsStepListsTheDtoLabels,
  theSiteStepNamesTheSite,
  theTabsStepDisablesTheFullTab,
  theTabsStepMarksTheTabWithAStrip,
  theThirtyFirstBoxIsDisabled,
} from "./trend-strip-wizard.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and the jsdom
 * docblock is here because this is the file Vitest collects (ADR 0042 decision 2).
 */
describe("F4.306 U12 TrendStripWizard", () => {
  afterEach(() => {
    cleanupTrendStripWizard();
  });

  it("names the dashboard's site on the Site step", async () => {
    await theSiteStepNamesTheSite();
  });

  it("marks the tab that holds a strip on the Tabs step", async () => {
    await theTabsStepMarksTheTabWithAStrip();
  });

  it("disables the tab at the widget cap and no other", async () => {
    await theTabsStepDisablesTheFullTab();
  });

  it("lists the site's segments by the DTO's labels", async () => {
    await theSegmentsStepListsTheDtoLabels();
  });

  it("preselects the first 3 points of each chosen segment", async () => {
    await thePointsStepPreselectsThreePerSegment();
  });

  it("keeps the point and colour edits on a second visit and defaults the new segment", async () => {
    await aSecondVisitKeepsTheEditsAndDefaultsTheNewSegment();
  });

  it("defaults a segment again after it is unticked and ticked on one visit", async () => {
    await aRetickedSegmentGetsItsDefaultAgain();
  });

  it("disables an unchecked box at 30 points and keeps a checked one enabled", async () => {
    await theThirtyFirstBoxIsDisabled();
  });

  it("writes the chosen colour role to colors[key]", async () => {
    await theColourSelectWritesTheRole();
  });

  it("F4.323 PR 3: the style select writes styles[key], and Line stores none", async () => {
    await theStyleSelectWritesTheStyle();
  });

  it("deletes the colour key on Default", async () => {
    await theDefaultOptionDeletesTheKey();
  });

  it("previews the strip over the chosen tab's group with the selection", async () => {
    await thePreviewReadsTheStripWithTheSelection();
  });

  it("applies the draft rows on Finish in the builder and makes no request", async () => {
    await draftFinishAppliesRowsAndRequestsNothing();
  });

  it("posts one append body with one strip per chosen tab in tab order, then calls onDone", async () => {
    await appendFinishPostsOneBodyInTabOrder();
  });

  it("shows the full-tab sentence on a 409", async () => {
    await aConflictShowsTheFullSentence();
  });

  it("shows the lists-changed sentence on a 400", async () => {
    await aBadRequestShowsTheListsSentence();
  });

  it("shows the refused sentence on a 403", async () => {
    await aForbiddenShowsTheRefusedSentence();
  });

  it("shows the refused sentence on a 404", async () => {
    await aNotFoundShowsTheRefusedSentence();
  });

  it("shows the fallback sentence on a 500", async () => {
    await aServerErrorShowsTheFallbackSentence();
  });

  it("marks Finish aria-busy and disabled while the append is pending", async () => {
    await theFinishButtonIsBusyWhilePending();
  });

  it("F4.324: Chart needs a function before Next", async () => {
    await chartNeedsAFunctionBeforeNext();
  });
  it("F4.324: append writes one chart per tab with the kind and the range's window", async () => {
    await chartAppendsOneChartPerTab();
  });
  it("F4.324: a ninth asset point is refused with the count and nothing is written", async () => {
    await aNinthAssetPointIsRefused();
  });
  it("F4.324: the draft chart row carries each point's id", async () => {
    await aDraftChartRowCarriesThePointIds();
  });
  it("F4.324: two tabs get two charts, each with its own tab key", async () => {
    await twoTabsGetTwoCharts();
  });
  it("F4.324: a part-failed Finish names the written tab and never duplicates it", async () => {
    await aPartFailedFinishNamesTheWrittenTabAndNeverDuplicates();
  });
  it("F4.324: assets the strip read hid are counted and refused", async () => {
    await hiddenAssetsAreCountedAndRefused();
  });
});
