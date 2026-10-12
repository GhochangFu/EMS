// @vitest-environment jsdom
import { afterEach, describe, it } from "vitest";

import {
  aFillStepFillsTheTemplate,
  aMadeCopyRereadsTheResolveRead,
  anAmbiguousAnswerOpensThePicker,
  anAmbiguousAnswerReopensGroups,
  anOperatorSeesNoButton,
  anOutOfScopeNoticeHasNoButton,
  aRefusalShowsTheApiMessage,
  aSubmitWithoutAChoiceSendsNothing,
  cleanupSiteLayout,
  dashboardRemovedShowsTheButton,
  noSiteLayoutIsInfoToneAndDashboardRemovedStaysWarning,
  noSiteLayoutShowsItsTextAndTheButton,
  theButtonOpensTheWizardOnGroups,
  theRetryCarriesTheChosenGroup,
} from "./site-page-site-layout.spec";

/**
 * Vitest entry point — assertions live in the sibling `.spec` (ADR 0014), and
 * the jsdom docblock is here because this is the file Vitest collects
 * (ADR 0042 decision 2).
 */
describe("F3.73 / F3.86 PR 3d Make site layout on the site page's notice", () => {
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

  it("W1 opens the wizard on its Groups step", async () => {
    await theButtonOpensTheWizardOnGroups();
  });

  it("M5 POSTs {} for the site, shows the copy, and re-reads the resolve read on Close", async () => {
    await aMadeCopyRereadsTheResolveRead();
  });

  it("M6 opens the picker with the 409 body's candidates", async () => {
    await anAmbiguousAnswerOpensThePicker();
  });

  it("W3 takes a copilot fill for the template", async () => {
    await aFillStepFillsTheTemplate();
  }, 20_000);

  it("W2 re-opens the Groups step on an ambiguous answer", async () => {
    await anAmbiguousAnswerReopensGroups();
  });

  // A longer budget than the 5 s wait inside, so a red names its assertion, not "Test timed out".
  it("M7 sends nothing until every ambiguous tab has a choice", async () => {
    await aSubmitWithoutAChoiceSendsNothing();
  }, 20_000);

  it("M8 retries with the chosen group in tabGroups", async () => {
    await theRetryCarriesTheChosenGroup();
  });

  it("M9 shows the API's sentence on any other refusal", async () => {
    await aRefusalShowsTheApiMessage();
  });
});
