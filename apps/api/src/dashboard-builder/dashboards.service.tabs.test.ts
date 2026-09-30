import { describe, it } from "vitest";

import {
  aLegacyWidgetStaysUnchanged,
  aLocationMoveToOrgWideIsA400,
  aTabIdOfAnotherDashboardIsRefusedWithoutEchoingIt,
  aWidgetMovedBetweenTabsIsAnUpdate,
  aWidgetMovedOntoANewTabIsAnUpdate,
  aWidgetOnItsOwnTabIsUnchanged,
  diffTabsSortsKeptNewAndDeleted,
  groupTabOnAnOrgWideDashboardIsRefused,
  mapDashboardWidgetCarriesTabId,
  mimicOnAGroupTabOfASiteDashboardIsAccepted,
  mimicOnTheOverviewTabIsRefused,
} from "./dashboards.service.tabs.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014). One `it()` per claim. */
describe("F3.73 — DashboardsService tabs (no database)", () => {
  it("accepts a mimic on a tab bound to a group of a site dashboard", async () => {
    await mimicOnAGroupTabOfASiteDashboardIsAccepted();
  });

  it("refuses a mimic on the Overview tab with MIMIC_SCOPE_MESSAGE", async () => {
    await mimicOnTheOverviewTabIsRefused();
  });

  it("refuses a group tab on an org-wide dashboard with TAB_GROUP_SCOPE_MESSAGE", async () => {
    await groupTabOnAnOrgWideDashboardIsRefused();
  });

  it("refuses a tab id that is not this dashboard's, without echoing it", async () => {
    await aTabIdOfAnotherDashboardIsRefusedWithoutEchoingIt();
  });

  it("translates the tab location FK on a move to org-wide into a 400", async () => {
    await aLocationMoveToOrgWideIsA400();
  });

  it("diffs a widget moved between tabs as an update", () => {
    aWidgetMovedBetweenTabsIsAnUpdate();
  });

  it("diffs a widget left on its own tab as unchanged", () => {
    aWidgetOnItsOwnTabIsUnchanged();
  });

  it("diffs a widget moved onto a new tab as an update", () => {
    aWidgetMovedOntoANewTabIsAnUpdate();
  });

  it("diffs a legacy widget with no tab as unchanged", () => {
    aLegacyWidgetStaysUnchanged();
  });

  it("diffTabs keeps, inserts, updates and deletes by id", () => {
    diffTabsSortsKeptNewAndDeleted();
  });

  it("mapDashboardWidget carries tabId and parses", () => {
    mapDashboardWidgetCarriesTabId();
  });
});
