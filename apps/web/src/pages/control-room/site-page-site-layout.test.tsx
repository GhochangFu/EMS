// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aMadeCopyRereadsTheResolveRead,
  anAmbiguousAnswerOpensThePicker,
  anOperatorSeesNoButton,
  anOutOfScopeNoticeHasNoButton,
  aRefusalShowsTheApiMessage,
  cleanupSiteLayout,
  dashboardRemovedShowsTheButton,
  noSiteLayoutIsInfoToneAndDashboardRemovedStaysWarning,
  noSiteLayoutShowsItsTextAndTheButton,
  theRetryCarriesTheChosenGroup,
  theRetryWaitsForAChoice,
} from "./site-page-site-layout.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.73 Make site layout on the site page's notice", () => {
  afterEach(() => {
    cleanupSiteLayout();
  });

  it("M1 shows the no_site_layout text and the button for an admin", async () => {
    await noSiteLayoutShowsItsTextAndTheButton();
  });

  it("M2 shows the button on the dashboard_removed notice", async () => {
    await dashboardRemovedShowsTheButton();
  });

  it("M2b tones no_site_layout as info and keeps dashboard_removed warning", async () => {
    await noSiteLayoutIsInfoToneAndDashboardRemovedStaysWarning();
  });

  it("M3 shows no button to an operator", async () => {
    await anOperatorSeesNoButton();
  });

  it("M4 shows no button on the dashboard_out_of_scope notice", async () => {
    await anOutOfScopeNoticeHasNoButton();
  });

  it("M5 POSTs for the site and re-reads the resolve read on a made copy", async () => {
    await aMadeCopyRereadsTheResolveRead();
  });

  it("M6 opens the picker with the 409 body's candidates", async () => {
    await anAmbiguousAnswerOpensThePicker();
  });

  it("M7 keeps the retry disabled until every ambiguous tab has a choice", async () => {
    await theRetryWaitsForAChoice();
  });

  it("M8 retries with the chosen group in tabGroups", async () => {
    await theRetryCarriesTheChosenGroup();
  });

  it("M9 shows the API's sentence on any other refusal", async () => {
    await aRefusalShowsTheApiMessage();
  });
});
