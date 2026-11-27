// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, vi } from "vitest";

import {
  aTabKeyShowsOnlyThatTabsWidgets,
  boundWidgetFetchesItsRef,
  cleanupCanvas,
  emptyDashboardShowsNoWidgetsLine,
  noTabKeyShowsEveryWidget,
  oneSocketWithTokenDisconnectsOnUnmount,
  oneWidgetRendersItsTile,
  theCanvasReportsTheNewerCatalogRead,
  theCanvasReportsTheNewerSample,
  theCanvasReportsTheSiteWidgetsRead,
  aTrendStripWidgetDrawsOneStripWithItsTabsGroup,
  aForecastWidgetReadsItsPointTwice,
  anAnomalyWidgetReadsItsAssetOnce,
  aHiddenWidgetIsNotRead,
  aKwOnlyWidgetIsNotDrawnWithoutEnergy,
  anAnomalyWidgetOnKwIsDrawnWithoutEnergy,
  aTabOfHiddenWidgetsSaysWhy,
  anUntabbedDashboardOfHiddenWidgetsSaysWhy,
  everyWidgetIsDrawnWithEnergy,
  anMlFindingsWidgetGetsTheDashboardsScope,
  theWallDropsOnlyTheMlFindingsWidget,
  aWallOfOnlyMlFindingsSaysNoFalseEmptyLine,
  theScopeKeepsEachSetIdUnderItsOwnKey,
} from "./dashboard-live-canvas.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.69 U1 DashboardLiveCanvas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanupCanvas();
    vi.restoreAllMocks();
  });

  it("L1 shows the empty-state line and draws no tile for an empty dashboard", async () => {
    await emptyDashboardShowsNoWidgetsLine();
  });

  it("L2 renders one widget as a tile", async () => {
    await oneWidgetRendersItsTile();
  });

  it("L3 fetches recent telemetry for a bound widget's ref", async () => {
    await boundWidgetFetchesItsRef();
  });

  it("L4 opens one socket with the session token and disconnects on unmount", async () => {
    await oneSocketWithTokenDisconnectsOnUnmount();
  });

  it("L5 renders only the selected tab's widgets when given a tabKey (F3.73 D10)", async () => {
    await aTabKeyShowsOnlyThatTabsWidgets();
  });

  it("L6 renders every widget of a tabbed dashboard when given no tabKey", async () => {
    await noTabKeyShowsEveryWidget();
  });

  it("L7 reports the catalog read as the newest read when it is newer than the sample (F3.77 D9)", async () => {
    await theCanvasReportsTheNewerCatalogRead();
  });

  it("L8 reports the sample as the newest read when it is newer than the catalog read (F3.77 D9)", async () => {
    await theCanvasReportsTheNewerSample();
  });

  it("L9 reports the tab's site-widgets read when there is no sample and no catalog read (F3.77 D9)", async () => {
    await theCanvasReportsTheSiteWidgetsRead();
  });

  it("L10 draws one trend strip for a trend_strip widget, reading its tab's group (F4.305)", async () => {
    await aTrendStripWidgetDrawsOneStripWithItsTabsGroup();
  });

  it("L11 a forecast widget reads its bound point's actuals and forecast, and no recent read (E1.4c)", async () => {
    await aForecastWidgetReadsItsPointTwice();
  });

  it("L12 an anomaly widget reads its bound point's asset for 7 days, and no recent read (E1.2d)", async () => {
    await anAnomalyWidgetReadsItsAssetOnce();
  });

  it("EK1 does not draw a kW-only widget when energy is not shown; mixed and unbound stay (F4.375)", async () => {
    await aKwOnlyWidgetIsNotDrawnWithoutEnergy();
  });

  it("EK1b draws an anomaly widget bound to kw when energy is not shown; a kw chart stays hidden (E1.2d)", async () => {
    await anAnomalyWidgetOnKwIsDrawnWithoutEnergy();
  });

  it("EK2 draws every widget by default (F4.375)", async () => {
    await everyWidgetIsDrawnWithEnergy(undefined);
  });

  it("EK2 draws every widget when energy is shown (F4.375)", async () => {
    await everyWidgetIsDrawnWithEnergy(true);
  });

  it("EK3 does not read a hidden widget's kw ref (F4.375 D9)", async () => {
    await aHiddenWidgetIsNotRead();
  });

  it("EK4 says why a tab of hidden widgets is empty (F4.375 D10)", async () => {
    await aTabOfHiddenWidgetsSaysWhy();
  });

  it("EK5 names the dashboard when it has no tabs (F4.375 D10)", async () => {
    await anUntabbedDashboardOfHiddenWidgetsSaysWhy();
  });

  it("ML1 hands an ml_findings widget its dashboard's scope and draws it with energy not shown (E1.9f)", async () => {
    await anMlFindingsWidgetGetsTheDashboardsScope();
  });

  it("ML2 does not draw an ml_findings widget on the wall; forecast and anomaly still draw (E1.9f Q4)", async () => {
    await theWallDropsOnlyTheMlFindingsWidget(true);
  });

  it("ML2 draws all three off the wall (E1.9f Q4)", async () => {
    await theWallDropsOnlyTheMlFindingsWidget(false);
  });

  it("ML3 a wall of only ml_findings says no false 'no widgets yet' line (E1.9f Q4)", async () => {
    await aWallOfOnlyMlFindingsSaysNoFalseEmptyLine(true);
  });

  it("ML3 the same dashboard draws its ml_findings widget off the wall (E1.9f Q4)", async () => {
    await aWallOfOnlyMlFindingsSaysNoFalseEmptyLine(false);
  });

  it("ML4 an asset-group dashboard hands the widget its assetGroupId (E1.9f)", async () => {
    await theScopeKeepsEachSetIdUnderItsOwnKey("assetGroup");
  });

  it("ML4 an asset dashboard hands the widget its assetId (E1.9f)", async () => {
    await theScopeKeepsEachSetIdUnderItsOwnKey("asset");
  });
});
