// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
  aFirstLoadWritesNoTabParam,
  aTabInTheUrlIsSelectedOnLoad,
  aTabbedViewerHasAnH2ForTheSelectedTab,
  anUnknownTabKeyOpensTheFirstTab,
  anUntabbedViewerHasAnH2,
  backReturnsToThePreviousTab,
  anArrowKeyMoveReplacesTheHistoryEntry,
  aModuleCardInTheViewerOpensItsTab,
  selectingATabWritesItKeepingOrganizationId,
  aLocationAdminStillSeesTheEditLink,
  aTabbedDashboardRendersOnlyTheSelectedTabsWidgets,
  aTabbedDashboardShowsTheStripWithTheFirstTabSelected,
  aWidgetRendersViaTheLiveCanvas,
  anUntabbedDashboardShowsNoStrip,
  assetGroupAdminSeesTheEditLink,
  switchingTabsSwapsTheWidgets,
} from "./dashboard-viewer-page.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.1d dashboard viewer page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows an asset_group_admin the Edit dashboard link", async () => {
    await assetGroupAdminSeesTheEditLink();
  });

  it("still shows a location_admin the Edit dashboard link", async () => {
    await aLocationAdminStillSeesTheEditLink();
  });

  it("DV1 renders a widget via DashboardLiveCanvas", async () => {
    await aWidgetRendersViaTheLiveCanvas();
  });

  it("F3.73 D11 shows the tab strip with the first tab by sortOrder selected", async () => {
    await aTabbedDashboardShowsTheStripWithTheFirstTabSelected();
  });

  it("F3.73 D11 renders only the selected tab's widgets", async () => {
    await aTabbedDashboardRendersOnlyTheSelectedTabsWidgets();
  });

  it("F3.73 D11 swaps the widgets when another tab is selected", async () => {
    await switchingTabsSwapsTheWidgets();
  });

  it("F3.73 D11 shows no strip on a dashboard with no tabs", async () => {
    await anUntabbedDashboardShowsNoStrip();
  });

  it("F3.73 critique: a ?tab= key in the URL is selected on load", async () => {
    await aTabInTheUrlIsSelectedOnLoad();
  });

  it("F3.73 critique: an unknown ?tab= key opens the first tab", async () => {
    await anUnknownTabKeyOpensTheFirstTab();
  });

  it("F3.73 critique: the first load writes no ?tab=", async () => {
    await aFirstLoadWritesNoTabParam();
  });

  it("F3.73 critique: selecting a tab writes ?tab= and keeps organizationId", async () => {
    await selectingATabWritesItKeepingOrganizationId();
  });

  it("F3.73 critique: Back returns to the previous tab", async () => {
    await backReturnsToThePreviousTab();
  });

  it("F3.73 critique: an arrow-key move replaces the history entry", async () => {
    await anArrowKeyMoveReplacesTheHistoryEntry();
  });

  it("F3.73 critique: a module card in the viewer opens its tab", async () => {
    await aModuleCardInTheViewerOpensItsTab();
  });

  it("F3.73 critique: a tabbed viewer has an h2 for the selected tab", async () => {
    await aTabbedViewerHasAnH2ForTheSelectedTab();
  });

  it("F3.73 critique: an untabbed viewer has an h2", async () => {
    await anUntabbedViewerHasAnH2();
  });
});
