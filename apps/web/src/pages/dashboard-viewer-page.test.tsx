// @vitest-environment jsdom
import { afterEach, describe, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import {
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
});
