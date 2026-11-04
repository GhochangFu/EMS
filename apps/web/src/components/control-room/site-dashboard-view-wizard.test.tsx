// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  cleanupSiteViewWizard,
  clickingTheButtonOpensTheWizard,
  theSiteStepNamesTheSite,
  finishClosesTheWizard,
  finishPostsOnce,
  finishRefetchesTheDashboard,
  theButtonIsAbsentForAnOperator,
  theButtonIsAbsentOnTheWall,
  theButtonIsAbsentWithNoRole,
  theButtonIsAbsentWithoutASite,
  theButtonShowsForAnAdmin,
} from "./site-dashboard-view-wizard.spec";

/** Vitest entry point — assertions live in the sibling `.spec` (ADR 0014, ADR 0042 decision 2). */
describe("F4.306 U13 SiteDashboardView — the trend strip setup button", () => {
  afterEach(() => {
    cleanupSiteViewWizard();
  });

  it("shows the button for an admin on a dashboard with a site", () => theButtonShowsForAnAdmin());
  it("shows no button for an operator", () => theButtonIsAbsentForAnOperator());
  it("shows no button when no role is handed in", () => theButtonIsAbsentWithNoRole());
  it("shows no button on a dashboard without a site", () => theButtonIsAbsentWithoutASite());
  it("shows no button on the wall", () => theButtonIsAbsentOnTheWall());
  it("opens the wizard on a click", () => clickingTheButtonOpensTheWizard());
  it("names the site on the wizard's Site step", () => theSiteStepNamesTheSite());
  it("posts once at Finish", () => finishPostsOnce());
  it("reads the dashboard again after Finish", () => finishRefetchesTheDashboard());
  it("closes the wizard after Finish", () => finishClosesTheWizard());
});
