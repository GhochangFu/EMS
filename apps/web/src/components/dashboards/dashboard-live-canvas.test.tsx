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
});
